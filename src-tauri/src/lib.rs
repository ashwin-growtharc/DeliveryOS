use std::fs::OpenOptions;
use std::io::Write as _;
use std::time::Instant;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// Fixed, out-of-band log path used to durably record cold-start latency
/// measurements. Written unconditionally on every `run_list` invocation so
/// that measurements can be collected across many separate, genuinely cold
/// process launches without needing to read anything from the GUI.
fn coldstart_log_path() -> std::path::PathBuf {
  std::env::temp_dir().join("deliveryos-spike-coldstart.log")
}

/// Appends a single `COLDSTART_MS=<value>` line to the cold-start log file.
/// Uses append+create so every launch adds a new line rather than clobbering
/// prior runs. Logging failures are swallowed (best-effort) so they never
/// affect the command's own success/failure or the measurement itself.
fn log_coldstart_ms(latency_ms: f64) {
  let path = coldstart_log_path();
  match OpenOptions::new().append(true).create(true).open(&path) {
    Ok(mut file) => {
      if let Err(e) = writeln!(file, "COLDSTART_MS={latency_ms:.3}") {
        eprintln!("[run_list] failed to write coldstart log line: {e}");
      }
    }
    Err(e) => {
      eprintln!(
        "[run_list] failed to open coldstart log at {}: {e}",
        path.display()
      );
    }
  }
}

/// Phase 3 spike command: spawns the already-built Node SEA sidecar
/// (`build/deliveryos-engine-x86_64-pc-windows-msvc.exe`, registered as the
/// `deliveryos-engine` sidecar in `tauri.conf.json`'s `bundle.externalBin`),
/// sends it a single `catalog.list` JSON-RPC request over stdin, and
/// returns the first line the sidecar writes back on stdout.
///
/// Latency is measured from immediately before `spawn()` to the moment the
/// first stdout line arrives, and is logged to stderr (visible in the
/// `cargo tauri dev` console) as well as appended to the string returned to
/// the frontend, so it's retrievable from either place.
#[tauri::command]
async fn run_list(app: tauri::AppHandle) -> Result<String, String> {
  let start = Instant::now();

  let sidecar_command = app
    .shell()
    .sidecar("deliveryos-engine")
    .map_err(|e| format!("failed to resolve sidecar: {e}"))?;

  let (mut rx, mut child) = sidecar_command
    .spawn()
    .map_err(|e| format!("failed to spawn sidecar: {e}"))?;

  let request = b"{\"id\":\"1\",\"command\":\"catalog.list\",\"args\":{}}\n";
  child
    .write(request)
    .map_err(|e| format!("failed to write to sidecar stdin: {e}"))?;

  while let Some(event) = rx.recv().await {
    match event {
      CommandEvent::Stdout(line) => {
        let elapsed = start.elapsed();
        let response = String::from_utf8_lossy(&line).trim_end().to_string();
        let latency_ms = elapsed.as_secs_f64() * 1000.0;
        eprintln!("[run_list] sidecar spawn-to-first-response latency: {latency_ms:.3} ms");
        log_coldstart_ms(latency_ms);
        let _ = child.kill();
        return Ok(format!("{response}\n[latency_ms={latency_ms:.3}]"));
      }
      CommandEvent::Stderr(line) => {
        eprintln!(
          "[run_list][sidecar stderr] {}",
          String::from_utf8_lossy(&line)
        );
      }
      CommandEvent::Error(err) => {
        return Err(format!("sidecar reported an error: {err}"));
      }
      CommandEvent::Terminated(payload) => {
        return Err(format!(
          "sidecar terminated before responding: {payload:?}"
        ));
      }
      _ => {}
    }
  }

  Err("sidecar closed stdout without ever responding".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![run_list])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
