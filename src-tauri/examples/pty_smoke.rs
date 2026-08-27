// Standalone smoke test for the exact portable-pty mechanism pty.rs uses
// -- runs OUTSIDE the Tauri GUI shell entirely, so it can be verified
// for real without simulating clicks in the actual app window. Not
// wired into any build step; a throwaway verification aid, run by hand
// via `cargo run --example pty_smoke`.
//
// This specific version is a real regression check for the "%1 is not
// a valid Win32 application" bug found while dogfooding the real app:
// spawns the real npm-shimmed `deliveryos` CLI (an extensionless
// POSIX shell-script shim on Windows -- npm also writes
// `deliveryos.cmd`/`deliveryos.ps1` alongside it) via the same
// `cmd.exe /C` routing pty.rs's own `build_command` now uses, each
// argument added individually via `.arg()` (matching `build_command`
// exactly, not one pre-joined string).

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Read;

fn main() {
  let pty_system = native_pty_system();
  let pair = pty_system
    .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
    .expect("openpty");

  let mut cmd = CommandBuilder::new("cmd");
  cmd.arg("/C");
  cmd.arg("deliveryos");
  cmd.arg("--version");
  let mut child = pair.slave.spawn_command(cmd).expect("spawn_command");
  drop(pair.slave);

  let mut reader = pair.master.try_clone_reader().expect("try_clone_reader");

  // Read on a background thread with a real timeout on the JOIN, not on
  // each individual blocking read() call -- a read() that's genuinely
  // still waiting for more output isn't itself an error, only a total
  // process runtime this long would be.
  let read_thread = std::thread::spawn(move || {
    let mut buf = [0u8; 4096];
    let mut collected = String::new();
    loop {
      match reader.read(&mut buf) {
        Ok(0) => break,
        Ok(n) => collected.push_str(&String::from_utf8_lossy(&buf[..n])),
        Err(_) => break,
      }
    }
    collected
  });

  let exit_status = child.wait();
  // Give the reader a moment to drain whatever's left after the child's
  // own exit (ConPTY can flush its last chunk slightly after the child
  // process itself has already exited).
  std::thread::sleep(std::time::Duration::from_millis(500));
  let collected = read_thread.join().unwrap_or_default();

  println!("exit status: {exit_status:?}");

  println!("--- raw output ---\n{collected}\n--- end ---");

  // deliveryos's own `.version('0.1.0')` (src/cli/program.ts) -- a real,
  // known string to check for, not just "did anything print."
  let ok = collected.contains("0.1.0");
  if ok {
    println!("PASS: deliveryos resolved and ran through cmd.exe /C, real version printed");
  } else {
    println!("FAIL: expected version string not found -- the Win32-application bug may still be present");
    std::process::exit(1);
  }
}
