use serde::Deserialize;
use tauri::Emitter;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// Shape of a single response line the sidecar (`src/sidecar.ts`) writes to
/// its stdout: either
///   { "id": "...", "ok": true,  "result": <value> }
/// or
///   { "id": "...", "ok": false, "error": { "type": "...", "message": "..." } }
/// `result`/`error` are both optional here (rather than a proper untagged
/// enum keyed on `ok`) so a malformed/partial line still deserializes far
/// enough to be handled explicitly below, instead of falling through to the
/// generic "failed to parse" error path for a line that was actually valid
/// JSON, just missing a field.
#[derive(Deserialize)]
struct SidecarResponseError {
  message: String,
}

#[derive(Deserialize)]
struct SidecarResponseRaw {
  ok: bool,
  result: Option<serde_json::Value>,
  error: Option<SidecarResponseError>,
}

/// Generalized bridge to the `deliveryos-engine` sidecar: spawns it fresh,
/// writes a single `{"id":"1","command":<command>,"args":<args>}` request
/// line to its stdin, reads stdout lines from the `CommandEvent` stream
/// until one parses as a sidecar response, kills the child, and resolves to
/// that response's `result` (on `ok: true`) or its `error.message` (on
/// `ok: false`).
///
/// Every call spawns a brand-new sidecar process rather than keeping one
/// running across calls -- each invocation is a short-lived, independent
/// request/response round-trip, and per-call spawn keeps this command
/// simple (no shared child-process state to manage between calls, no
/// request/response multiplexing needed since exactly one request is ever
/// in flight per spawned process).
#[tauri::command]
async fn sidecar_call(
  app: tauri::AppHandle,
  command: String,
  args: serde_json::Value,
) -> Result<serde_json::Value, String> {
  let sidecar_command = app
    .shell()
    .sidecar("deliveryos-engine")
    .map_err(|e| format!("failed to resolve sidecar: {e}"))?;

  let (mut rx, mut child) = sidecar_command
    .spawn()
    .map_err(|e| format!("failed to spawn sidecar: {e}"))?;

  let request = serde_json::json!({
    "id": "1",
    "command": command,
    "args": args,
  });
  let mut request_line = serde_json::to_string(&request)
    .map_err(|e| format!("failed to serialize sidecar request: {e}"))?;
  request_line.push('\n');

  child
    .write(request_line.as_bytes())
    .map_err(|e| format!("failed to write to sidecar stdin: {e}"))?;

  while let Some(event) = rx.recv().await {
    match event {
      CommandEvent::Stdout(bytes) => {
        let text = String::from_utf8_lossy(&bytes).trim_end().to_string();
        if text.is_empty() {
          // Blank line -- the sidecar's protocol never intentionally emits
          // one, but skip rather than treating it as a parse failure.
          continue;
        }

        // Parse generically first: a progress line (`{"id","event":
        // "progress","stage","message"}`) has no `ok` field, so deserializing
        // it directly as `SidecarResponseRaw` would fail. Check for the
        // progress shape first, forward it to the frontend as a
        // `sidecar-progress` event, and keep looping -- the child is neither
        // killed nor returned from for a progress line, only for the real
        // final response.
        let generic: serde_json::Value = match serde_json::from_str(&text) {
          Ok(value) => value,
          Err(e) => {
            let _ = child.kill();
            return Err(format!(
              "failed to parse sidecar response as JSON: {e} (raw line: {text})"
            ));
          }
        };

        if generic.get("event").and_then(|v| v.as_str()) == Some("progress") {
          let _ = app.emit("sidecar-progress", &generic);
          continue;
        }

        let parsed = match serde_json::from_value::<SidecarResponseRaw>(generic) {
          Ok(parsed) => parsed,
          Err(e) => {
            let _ = child.kill();
            return Err(format!(
              "failed to parse sidecar response as JSON: {e} (raw line: {text})"
            ));
          }
        };

        let _ = child.kill();

        if parsed.ok {
          return Ok(parsed.result.unwrap_or(serde_json::Value::Null));
        }
        let message = parsed
          .error
          .map(|e| e.message)
          .unwrap_or_else(|| "sidecar reported an error with no message".to_string());
        return Err(message);
      }
      CommandEvent::Stderr(bytes) => {
        eprintln!(
          "[sidecar_call][sidecar stderr] {}",
          String::from_utf8_lossy(&bytes)
        );
      }
      CommandEvent::Error(err) => {
        // This variant reports an I/O error on the child's pipes -- unlike
        // `Terminated`, it does NOT imply the process has exited, so it
        // needs the same explicit `kill()` as the parse-failure and success
        // paths above to avoid leaking a still-running sidecar process.
        let _ = child.kill();
        return Err(format!("sidecar reported an error: {err}"));
      }
      CommandEvent::Terminated(payload) => {
        // The child has already exited by the time this event fires, so
        // `kill()` is a no-op here in practice -- called anyway for
        // defense in depth, matching every other return path.
        let _ = child.kill();
        return Err(format!(
          "sidecar terminated before responding: {payload:?}"
        ));
      }
      _ => {}
    }
  }

  // The event channel closed (`rx.recv()` returned `None`) without ever
  // producing a response -- kill defensively in case the child is
  // somehow still alive despite its output stream closing.
  let _ = child.kill();
  Err("sidecar closed stdout without ever responding".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
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
    .invoke_handler(tauri::generate_handler![sidecar_call])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
