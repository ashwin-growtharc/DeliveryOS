// The Document tab: see and open the Word, PDF, Excel and PowerPoint files an
// artifact ships.
//
// WHY THIS IS A SEPARATE FILE
//
// app.js is frozen at its current size (test/unit/appJsCeiling.test.ts), so
// new desktop behaviour lives beside it and is called from it. This file
// publishes one object, `window.DeliveryOSViewer`, and app.js touches it in
// exactly two places: the Document tab's render kick-off, and the "Open
// folder" button whose handler moved here because it is the same concern.
//
// WHAT IT RENDERS AND WHAT IT HANDS OFF
//
// Word renders in-app (docx-preview, vendored, inside a sandboxed iframe with
// the same isolation the markdown renderer uses). PDF renders in-app through
// the webview's own viewer. Excel and PowerPoint do not: in-browser renderers
// for them show a grid or a rough approximation, and the person has Excel.
// For every file there is Open (default program), Open with... (the Windows
// chooser) and Reveal (select it in Explorer), once the artifact is pulled --
// before that there is nothing on disk to open.
//
// WHY THE WORD RENDERER IS INLINED INTO THE FRAME
//
// The frame is a `srcdoc` document with `sandbox="allow-scripts"`: an opaque
// origin, so a client's document can reach nothing of the app. An opaque
// origin also cannot reliably load a sibling `<script src>` -- the app's
// origin is `tauri.localhost` in production and `file://` in the browser
// tests -- so the vendored bundle arrives as a STRING (`vendor/docx-preview.js`
// sets `window.DeliveryOSDocxBundle`) and is written into the frame's own
// `<script>`. The frame fetches nothing, which is also what keeps
// `npm run ui:fonts`'s "nothing but file://" check true.
(function () {
  const call = (command, args) => window.DeliveryOS.call(command, args);
  const $ = (id) => document.getElementById(id);

  const RENDERS_AS_WORD = /\.(docx|dotx|docm|dotm)$/i;
  const RENDERS_AS_PDF = /\.pdf$/i;
  const VIEWABLE = /\.(docx|dotx|docm|dotm|pdf|xlsx|xltx|xlsm|xltm|pptx|potx|pptm|potm|ppsx)$/i;

  let requestId = 0;
  let messageHandlers = [];
  let blobUrls = [];
  let current = null; // { entry, file, base64 } of the rendered document, for re-theming
  const isWindows = /Windows/i.test(navigator.userAgent);

  function effectiveTheme() {
    const explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'dark' || explicit === 'light') return explicit;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function teardown() {
    for (const handler of messageHandlers) window.removeEventListener('message', handler);
    messageHandlers = [];
    for (const url of blobUrls) URL.revokeObjectURL(url);
    blobUrls = [];
  }

  /** The path a payload file landed at after a pull. For a single-file
   * payload `install_target` IS the file; otherwise it is a directory the
   * file sits under. Separator follows install_target's own, so a Windows
   * path stays a Windows path. */
  function installedPath(entry, rootIsFile, relPath) {
    const target = entry.installTarget ?? '';
    if (rootIsFile) return target;
    const sep = target.includes('\\') ? '\\' : '/';
    return target.replace(/[\\/]+$/, '') + sep + relPath.split('/').join(sep);
  }

  function note(container, text) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = text;
    container.appendChild(p);
  }

  /** Shows the Open-folder button's target in the OS file manager. Uses
   * `revealItemInDir` (not `openPath`) because install_target can be either a
   * directory or a single file -- openPath on a file would launch it in its
   * default app instead of showing it in Explorer, which is not what a button
   * labelled "Open folder" should do for either case. */
  async function openInstallFolder(path, onError) {
    try {
      await window.__TAURI__.opener.revealItemInDir(path);
    } catch (err) {
      onError(err);
    }
  }

  async function openFile(path, onError) {
    try {
      await window.__TAURI__.opener.openPath(path);
    } catch (err) {
      onError(err);
    }
  }

  /** The Windows "Open with" chooser, through a Rust command that refuses any
   * path outside the project. Not available elsewhere; the button is hidden. */
  async function openWith(path, onError) {
    try {
      const projectDir = localStorage.getItem('deliveryos.projectDir') ?? '';
      await window.__TAURI__.core.invoke('open_with_dialog', { path, projectDir });
    } catch (err) {
      onError(err);
    }
  }

  function button(label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-ghost btn-sm';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  /** The Word page's document: the vendored renderer, then a tiny bootstrap
   * that waits for the bytes and reports its height, the same `contentHeight`
   * protocol the markdown frames use. The page itself stays white the way
   * Word's does; only the surround follows the theme. */
  function buildWordDocument(theme) {
    const bg = theme === 'dark' ? '#211C15' : '#FFFCF2';
    const ink = theme === 'dark' ? '#F0EAE0' : '#1E3C53';
    const bundle = window.DeliveryOSDocxBundle;
    return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:;">
<style>
  html, body { margin: 0; padding: 0; overflow: hidden; background: ${bg}; color: ${ink}; }
  body { padding: 12px 0 20px; font-family: system-ui, sans-serif; font-size: 14px; }
  .docx-wrapper { background: transparent !important; padding: 0 !important; }
  .docx-wrapper > section.docx { margin: 0 auto 16px !important; box-shadow: 0 1px 6px rgba(0,0,0,.25); }
  #status { padding: 12px; }
</style></head>
<body><div id="status">Rendering&hellip;</div><div id="doc"></div>
<script>${bundle}</script>
<script>
  (function () {
    var status = document.getElementById('status');
    var doc = document.getElementById('doc');
    function report() {
      parent.postMessage({ type: 'contentHeight', height: document.body.scrollHeight }, '*');
    }
    new ResizeObserver(report).observe(document.body);
    window.addEventListener('message', function (event) {
      var data = event.data;
      if (!data || data.type !== 'render' || typeof data.base64 !== 'string') return;
      var bin = atob(data.base64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      window.docx.renderAsync(bytes.buffer, doc, null, { inWrapper: true, useBase64URL: true, breakPages: true, ignoreLastRenderedPageBreak: true })
        .then(function () { status.remove(); report(); })
        .catch(function (err) { status.textContent = 'Could not render this document: ' + (err && err.message ? err.message : String(err)); report(); });
    });
    parent.postMessage({ type: 'ready' }, '*');
  })();
</script></body></html>`;
  }

  function renderWord(container, base64) {
    container.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-scripts';
    iframe.className = 'markdown-frame';
    iframe.title = 'Document preview';
    iframe.srcdoc = buildWordDocument(effectiveTheme());
    container.appendChild(iframe);

    const handler = (event) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'ready') {
        iframe.contentWindow.postMessage({ type: 'render', base64 }, '*');
      } else if (data.type === 'contentHeight') {
        iframe.style.height = `${Math.max(Number(data.height) || 0, 80)}px`;
      }
    };
    window.addEventListener('message', handler);
    messageHandlers.push(handler);
  }

  /** The webview's own PDF viewer. A `blob:` URL rather than a data URL so a
   * large file is not base64-inlined into an attribute, and NOT sandboxed:
   * Chromium does not run its PDF plugin inside a sandboxed frame. The Blob's
   * declared type is what stops the bytes being sniffed as anything else. */
  function renderPdf(container, base64, mime) {
    container.innerHTML = '';
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/pdf' }));
    blobUrls.push(url);
    const iframe = document.createElement('iframe');
    iframe.className = 'markdown-frame';
    iframe.title = 'PDF preview';
    iframe.src = url;
    iframe.style.height = '640px';
    container.appendChild(iframe);
  }

  async function view(entry, file, viewport, myRequest) {
    viewport.innerHTML = '';
    note(viewport, `Loading ${file}…`);
    let result;
    try {
      result = await call('artifact.readPayloadBinary', { remote: entry.remoteName, id: entry.manifest.id, path: file });
    } catch (err) {
      if (myRequest !== requestId) return;
      viewport.innerHTML = '';
      note(viewport, err && err.message ? err.message : String(err));
      return;
    }
    if (myRequest !== requestId) return;
    if (!result || result.kind !== 'bytes') {
      viewport.innerHTML = '';
      note(viewport, `${file} is not in this artifact's payload any more. Refresh the catalog.`);
      return;
    }
    current = { entry, file, base64: result.base64, mime: result.mime };
    if (RENDERS_AS_WORD.test(file)) renderWord(viewport, result.base64);
    else if (RENDERS_AS_PDF.test(file)) renderPdf(viewport, result.base64, result.mime);
  }

  /**
   * Renders the Document tab for an artifact, and tells app.js whether the tab
   * applies at all -- it does only when the payload ships at least one Office
   * or PDF file. `setApplies(false)` is the normal outcome for most artifacts.
   */
  async function renderDocumentTab(entry, setApplies, onError) {
    const myRequest = ++requestId;
    teardown();
    current = null;
    const section = $('detail-document-section');
    section.innerHTML = '';

    let listing;
    try {
      listing = await call('artifact.listPayloadFiles', { remote: entry.remoteName, id: entry.manifest.id });
    } catch {
      if (myRequest === requestId) setApplies(false);
      return;
    }
    if (myRequest !== requestId) return;

    const files = (listing && Array.isArray(listing.files) ? listing.files : []).filter((f) => VIEWABLE.test(f));
    if (files.length === 0) {
      setApplies(false);
      return;
    }
    const rootIsFile = Boolean(listing.rootIsFile);
    const pulled = entry.localStatus !== 'not_pulled';

    const label = document.createElement('div');
    label.className = 'wiring-section-label';
    label.textContent = files.length === 1 ? 'Document' : 'Documents';
    section.appendChild(label);

    const list = document.createElement('div');
    list.className = 'document-list';
    section.appendChild(list);

    const viewport = document.createElement('div');
    viewport.className = 'document-viewport markdown-container';
    section.appendChild(viewport);

    let firstRenderable = null;
    for (const file of files) {
      const row = document.createElement('div');
      row.className = 'document-row';
      const name = document.createElement('span');
      name.className = 'document-name';
      name.textContent = file;
      row.appendChild(name);

      const renderable = RENDERS_AS_WORD.test(file) || RENDERS_AS_PDF.test(file);
      if (renderable) {
        row.appendChild(button('View', () => void view(entry, file, viewport, requestId)));
        firstRenderable ??= file;
      }
      if (pulled) {
        const where = installedPath(entry, rootIsFile, file);
        row.appendChild(button('Open', () => void openFile(where, onError)));
        if (isWindows) row.appendChild(button('Open with…', () => void openWith(where, onError)));
        row.appendChild(button('Reveal', () => void openInstallFolder(where, onError)));
      }
      list.appendChild(row);
    }

    if (!pulled) {
      note(section, 'Pull this artifact to open these files in their own programs.');
    }
    if (!firstRenderable) {
      note(viewport, 'Excel and PowerPoint files open in their own programs rather than here.');
    }

    setApplies(true);
    if (firstRenderable) await view(entry, firstRenderable, viewport, myRequest);
  }

  // A theme toggle re-renders the open Word frame, whose colours are baked
  // into its srcdoc. Watching the attribute costs app.js nothing.
  new MutationObserver(() => {
    if (!current || !RENDERS_AS_WORD.test(current.file)) return;
    const viewport = document.querySelector('#detail-document-section .document-viewport');
    if (viewport && viewport.isConnected) {
      teardown();
      renderWord(viewport, current.base64);
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  window.DeliveryOSViewer = { renderDocumentTab, openInstallFolder };
})();
