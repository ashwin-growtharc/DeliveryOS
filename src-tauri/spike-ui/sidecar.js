// Thin wrapper around the generalized `sidecar_call` Tauri command
// (src-tauri/src/lib.rs). This is a static single HTML page with no
// bundler/dev-server wired up (see tauri.conf.json's `build.frontendDist`),
// so we can't use a bare `import { invoke } from '@tauri-apps/api/core'`
// specifier -- the browser has no module resolution for node_modules.
// Instead we rely on `app.withGlobalTauri: true` (tauri.conf.json), which
// injects `window.__TAURI__.core.invoke` (and `window.__TAURI__.dialog.*`
// for the dialog plugin used elsewhere) for us.
(function () {
  const { invoke } = window.__TAURI__.core;

  /**
   * Calls a sidecar command by name (e.g. "catalog.list", "artifact.pull").
   * Resolves to the command's `result` on success.
   *
   * On failure, throws a plain `Error` whose `.message` is exactly the
   * underlying engine's own error message (e.g. `No artifact with id "..."
   * found in any registered remote`, or a real git error) -- never
   * paraphrased, so callers can show it verbatim in a toast.
   */
  async function call(command, args) {
    try {
      return await invoke('sidecar_call', { command, args: args ?? {} });
    } catch (err) {
      // `sidecar_call`'s Rust side returns `Err(String)` on every failure
      // path, which surfaces here as a plain string, not an Error instance.
      const message = typeof err === 'string' ? err : (err && err.message) || String(err);
      throw new Error(message);
    }
  }

  window.DeliveryOS = window.DeliveryOS || {};
  window.DeliveryOS.call = call;
})();
