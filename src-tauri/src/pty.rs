use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{Emitter, State};

/// A real, running PTY session -- at most one at a time (see this
/// module's own doc comment on `PtyState`). Holds exactly what's needed
/// to write keystrokes, resize, and kill it later; the READ side is
/// owned exclusively by the background thread `pty_spawn` starts, not
/// stored here at all (a `Read` half can't be safely shared/cloned for
/// concurrent access the way `master`/the writer can).
struct PtySession {
  master: Box<dyn MasterPty + Send>,
  writer: Box<dyn Write + Send>,
  child: Box<dyn Child + Send + Sync>,
}

/// Managed Tauri state holding the one live PTY session, if any.
///
/// Deliberately `Option<PtySession>`, not a keyed registry of many
/// sessions -- v1 scope is exactly one "Wire with Claude" session
/// running at a time (see the approved plan's own "explicitly kept
/// simple" section). `pty_spawn` kills whatever's already running
/// before starting a new one, so this invariant holds by construction
/// rather than needing to be checked at every call site.
pub struct PtyState(Mutex<Option<PtySession>>);

impl Default for PtyState {
  fn default() -> Self {
    PtyState(Mutex::new(None))
  }
}

fn kill_session_locked(guard: &mut Option<PtySession>) {
  if let Some(mut session) = guard.take() {
    let _ = session.child.kill();
  }
}

/// Kills whatever PTY session is currently running, if any -- the one
/// function called from BOTH `pty_kill` (an explicit user action) and
/// `lib.rs`'s app-quit cleanup (`RunEvent::ExitRequested`), so closing
/// the app can never leave a real `claude`/`deliveryos` process
/// orphaned behind it.
pub fn kill_running_session(state: &PtyState) {
  let mut guard = state.0.lock().unwrap();
  kill_session_locked(&mut guard);
}

/// Starts a real PTY running `command` with `args` in `cwd`, sized to
/// the frontend's own current terminal dimensions. Kills any existing
/// session first (see `PtyState`'s own doc comment on the one-at-a-time
/// invariant). Spawns a background OS thread that loops reading the raw
/// PTY output and emitting each chunk as a base64-encoded `pty-output`
/// event -- deliberately a `std::thread`, not an async task: the
/// underlying `Read` this loop blocks on is a real blocking OS handle,
/// not something with an async-aware implementation to await instead.
///
/// This command knows NOTHING about DeliveryOS, Claude, wiring, or
/// artifacts -- it runs whatever `command`/`args` the frontend passes,
/// exactly like a plain embedded terminal would. The frontend is the one
/// that decides to run `deliveryos wire-with-claude <id>` here, reusing
/// that already-shipped CLI command's own logic rather than this module
/// reimplementing any of it.

/// Builds the real command to spawn -- on Windows, routed through
/// `cmd.exe /C` rather than invoked directly. A real, confirmed bug
/// found while dogfooding this: `portable_pty::CommandBuilder` calls
/// `CreateProcessW` directly, which has none of `cmd.exe`'s own
/// `PATHEXT`-based resolution -- an npm-installed CLI like `deliveryos`
/// resolves on Windows to an extensionless POSIX shell-script shim
/// (npm also writes `deliveryos.cmd`/`deliveryos.ps1` alongside it), and
/// `CreateProcessW` can't execute that file at all ("%1 is not a valid
/// Win32 application", confirmed against the real error). This is the
/// exact same class of problem `runClaudeSubprocess.ts` already solved
/// for `claude` via Node's `shell: true` -- `cmd /C <command> <args...>`
/// asks `cmd.exe` to resolve and run it exactly as if typed at a real
/// prompt, the same PATHEXT resolution a person's own terminal already
/// does. Every argument still goes through `CommandBuilder::arg()`
/// individually (not string-joined), so `portable_pty`'s own Windows
/// command-line quoting still applies per-argument -- unlike Node's
/// `shell: true` (a naive space-join with no quoting at all, which is
/// what made `launchInteractiveClaudeSession.ts`'s own argv need manual
/// `JSON.stringify` quoting), this doesn't reopen that problem.
#[cfg(windows)]
fn build_command(command: &str, args: &[String]) -> CommandBuilder {
  let mut cmd = CommandBuilder::new("cmd");
  cmd.arg("/C");
  cmd.arg(command);
  for arg in args {
    cmd.arg(arg);
  }
  cmd
}

#[cfg(not(windows))]
fn build_command(command: &str, args: &[String]) -> CommandBuilder {
  let mut cmd = CommandBuilder::new(command);
  cmd.args(args);
  cmd
}

#[tauri::command]
pub fn pty_spawn(
  app: tauri::AppHandle,
  state: State<PtyState>,
  cwd: String,
  command: String,
  args: Vec<String>,
  rows: u16,
  cols: u16,
) -> Result<(), String> {
  {
    let mut guard = state.0.lock().unwrap();
    kill_session_locked(&mut guard);
  }

  let pty_system = native_pty_system();
  let pair = pty_system
    .openpty(PtySize {
      rows,
      cols,
      pixel_width: 0,
      pixel_height: 0,
    })
    .map_err(|e| format!("failed to open a pseudo-terminal: {e}"))?;

  let mut cmd = build_command(&command, &args);
  cmd.cwd(&cwd);

  let child = pair
    .slave
    .spawn_command(cmd)
    .map_err(|e| format!("failed to spawn \"{command}\" in a pseudo-terminal: {e}"))?;
  // Drop the slave handle in THIS process once the child owns its own
  // copy -- on Unix this is what lets the reader below observe real EOF
  // when the child exits (a lingering slave handle here would keep the
  // PTY's write end open indefinitely). Harmless no-op on Windows.
  drop(pair.slave);

  let mut reader = pair
    .master
    .try_clone_reader()
    .map_err(|e| format!("failed to open the pseudo-terminal's read side: {e}"))?;
  let writer = pair
    .master
    .take_writer()
    .map_err(|e| format!("failed to open the pseudo-terminal's write side: {e}"))?;

  {
    let mut guard = state.0.lock().unwrap();
    *guard = Some(PtySession {
      master: pair.master,
      writer,
      child,
    });
  }

  std::thread::spawn(move || {
    let mut buf = [0u8; 8192];
    loop {
      match reader.read(&mut buf) {
        Ok(0) => break,
        Ok(n) => {
          let encoded = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
          let _ = app.emit("pty-output", encoded);
        }
        Err(_) => break,
      }
    }
    let _ = app.emit("pty-exit", ());
  });

  Ok(())
}

/// Writes raw, base64-decoded keystroke/paste bytes to the currently
/// running session's PTY. A no-op error (not a panic) when nothing is
/// running -- the frontend's own terminal UI shouldn't exist without a
/// live session, but this stays defensive rather than assuming that.
#[tauri::command]
pub fn pty_write(state: State<PtyState>, data: String) -> Result<(), String> {
  let bytes = base64::engine::general_purpose::STANDARD
    .decode(&data)
    .map_err(|e| format!("failed to decode input: {e}"))?;
  let mut guard = state.0.lock().unwrap();
  let session = guard.as_mut().ok_or("no pty session is currently running")?;
  session
    .writer
    .write_all(&bytes)
    .map_err(|e| format!("failed to write to the pseudo-terminal: {e}"))
}

/// Resizes the currently running session's PTY -- called on every real
/// container-resize the frontend observes, so a TUI-heavy session (like
/// Claude Code's own interactive UI) always sees correct rows/cols
/// rather than a stale size from whenever the panel first opened.
#[tauri::command]
pub fn pty_resize(state: State<PtyState>, rows: u16, cols: u16) -> Result<(), String> {
  let guard = state.0.lock().unwrap();
  let session = guard.as_ref().ok_or("no pty session is currently running")?;
  session
    .master
    .resize(PtySize {
      rows,
      cols,
      pixel_width: 0,
      pixel_height: 0,
    })
    .map_err(|e| format!("failed to resize the pseudo-terminal: {e}"))
}

/// Kills the currently running session, if any -- the explicit
/// "close the panel" / "Discard" path. A no-op (not an error) when
/// nothing is running, since the frontend may call this defensively on
/// panel close regardless of whether the session already exited on its
/// own.
#[tauri::command]
pub fn pty_kill(state: State<PtyState>) -> Result<(), String> {
  let mut guard = state.0.lock().unwrap();
  kill_session_locked(&mut guard);
  Ok(())
}
