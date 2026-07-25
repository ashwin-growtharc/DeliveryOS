// DeliveryOS desktop UI: vanilla JS, single-page, no framework/build step.
// State + view-switching + render functions for Browse / Detail / Add-new /
// Settings. Every engine call goes through `DeliveryOS.call` (sidecar.js),
// which spawns a fresh sidecar process per call -- so every button that
// triggers one is disabled with a "Working..." label for the duration.
(function () {
  const call = window.DeliveryOS.call;
  const { open: openDialog } = window.__TAURI__.dialog;

  const PROJECT_DIR_KEY = 'deliveryos.projectDir';

  const STATUS_LABELS = {
    not_pulled: 'Not pulled',
    pulled: 'Pulled',
    edited_locally: 'Edited locally',
  };

  const state = {
    view: 'browse',
    projectDir: null,
    catalog: [], // last catalog.list() result: { manifest, remoteName, localStatus, installTarget }[]
    search: '',
    activeKind: 'All',
    selectedKey: null, // `${id}::${remoteName}` of the entry shown in Detail
    remotes: [],
  };

  // ---------- small DOM helpers ----------

  function $(id) {
    return document.getElementById(id);
  }

  function entryKey(entry) {
    return `${entry.manifest.id}::${entry.remoteName}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------- toasts ----------

  function showToast(kind, message) {
    const stack = $('toast-stack');
    const toast = document.createElement('div');
    toast.className = `toast ${kind}`;
    toast.innerHTML = `<span class="dot"></span><span class="msg"></span>`;
    toast.querySelector('.msg').textContent = message;
    stack.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 5000);
  }

  function toastSuccess(message) {
    showToast('success', message);
  }

  function toastError(err) {
    showToast('error', err instanceof Error ? err.message : String(err));
  }

  /** Disables `button`, swaps its label to `busyLabel`, runs `fn`, then
   * always restores the button -- regardless of success/failure. Every
   * call() site uses this: each call is a fresh sidecar spawn and is never
   * instant.
   *
   * Reentrancy-safe: if this fires twice concurrently on the same button
   * (e.g. a pull's post-success catalog refresh overlapping with an
   * already-in-flight refresh from opening the Browse view), a busy counter
   * ensures only the last call to finish restores the idle state -- and it
   * restores to the button's true idle label (captured once, the first time
   * this button is ever busied), not whatever text happened to be showing
   * right before this particular call started. Without this, the second
   * call would capture "Working..." as its own "original" label and leave
   * the button stuck on it forever once both calls finish. */
  async function withBusy(button, busyLabel, fn) {
    if (button.dataset.idleLabel === undefined) {
      button.dataset.idleLabel = button.textContent;
    }
    button._busyCount = (button._busyCount || 0) + 1;
    button.disabled = true;
    button.textContent = busyLabel;
    try {
      return await fn();
    } finally {
      button._busyCount -= 1;
      if (button._busyCount <= 0) {
        button._busyCount = 0;
        button.disabled = false;
        button.textContent = button.dataset.idleLabel;
      }
    }
  }

  // ---------- project folder ----------

  function setProjectDir(dir) {
    state.projectDir = dir;
    if (dir) {
      localStorage.setItem(PROJECT_DIR_KEY, dir);
    } else {
      localStorage.removeItem(PROJECT_DIR_KEY);
    }
    renderFolderDisplay();
  }

  function renderFolderDisplay() {
    $('folder-path').textContent = state.projectDir || 'No folder selected';
    $('browse-no-folder').hidden = Boolean(state.projectDir);
  }

  async function changeFolder() {
    const button = $('change-folder-btn');
    await withBusy(button, 'Working...', async () => {
      let picked;
      try {
        picked = await openDialog({ directory: true });
      } catch (err) {
        toastError(err);
        return;
      }
      if (!picked) {
        return; // user cancelled
      }
      setProjectDir(picked);
      if (state.view === 'browse') {
        await loadCatalog();
      }
    });
  }

  // ---------- view switching ----------

  function showView(view) {
    state.view = view;
    for (const section of document.querySelectorAll('.view')) {
      section.hidden = section.id !== `view-${view}`;
    }
    for (const btn of document.querySelectorAll('.nav-btn')) {
      btn.classList.toggle('active', btn.dataset.view === view);
    }
    if (view === 'browse') {
      void loadCatalog();
    } else if (view === 'settings') {
      void loadRemotesForSettings();
    } else if (view === 'addnew') {
      void loadRemotesForAddNewSelect();
    }
  }

  // ---------- browse ----------

  async function loadCatalog() {
    renderFolderDisplay();
    if (!state.projectDir) {
      state.catalog = [];
      renderChips();
      renderCards();
      return;
    }
    const refreshBtn = $('refresh-btn');
    await withBusy(refreshBtn, 'Working...', async () => {
      try {
        state.catalog = await call('catalog.list', { cwd: state.projectDir });
      } catch (err) {
        toastError(err);
        state.catalog = [];
      }
      renderChips();
      renderCards();
    });
  }

  function renderChips() {
    const kinds = Array.from(new Set(state.catalog.map((e) => e.manifest.kind))).sort();
    const container = $('chips');
    container.innerHTML = '';

    const allChip = document.createElement('span');
    allChip.className = `chip ${state.activeKind === 'All' ? 'active' : ''}`;
    allChip.textContent = 'All';
    allChip.addEventListener('click', () => {
      state.activeKind = 'All';
      renderChips();
      renderCards();
    });
    container.appendChild(allChip);

    for (const kind of kinds) {
      const chip = document.createElement('span');
      chip.className = `chip ${state.activeKind === kind ? 'active' : ''}`;
      chip.textContent = kind;
      chip.addEventListener('click', () => {
        state.activeKind = kind;
        renderChips();
        renderCards();
      });
      container.appendChild(chip);
    }
  }

  function filteredEntries() {
    const search = state.search.trim().toLowerCase();
    return state.catalog.filter((entry) => {
      if (state.activeKind !== 'All' && entry.manifest.kind !== state.activeKind) {
        return false;
      }
      if (search.length === 0) {
        return true;
      }
      const haystack = `${entry.manifest.id} ${entry.manifest.description}`.toLowerCase();
      return haystack.includes(search);
    });
  }

  function actionButtonFor(entry) {
    if (entry.localStatus === 'not_pulled') {
      return { label: 'Pull', action: 'pull' };
    }
    if (entry.localStatus === 'edited_locally') {
      return { label: 'Push', action: 'push' };
    }
    return null; // 'pulled': nothing to do
  }

  function renderCards() {
    const entries = filteredEntries();
    const grid = $('card-grid');
    grid.innerHTML = '';
    $('browse-empty').hidden = entries.length !== 0;

    for (const entry of entries) {
      const card = document.createElement('div');
      card.className = 'res-card';

      const action = actionButtonFor(entry);
      const actionHtml = action
        ? `<button class="btn card-action" data-key="${escapeHtml(entryKey(entry))}" data-action="${action.action}">${action.label}</button>`
        : '';

      card.innerHTML = `
        <div class="row1">
          <span class="kind">${escapeHtml(entry.manifest.kind)}</span>
          <span class="badge ${entry.localStatus}">${STATUS_LABELS[entry.localStatus]}</span>
        </div>
        <div class="name">${escapeHtml(entry.manifest.id)}</div>
        <div class="summary">${escapeHtml(entry.manifest.description)}</div>
        <div class="row2">
          <span class="meta">v${escapeHtml(entry.manifest.version)} &middot; ${escapeHtml(entry.manifest.owner)}</span>
          ${actionHtml}
        </div>
      `;

      card.addEventListener('click', (ev) => {
        if (ev.target.closest('.card-action')) {
          return; // handled by the action button's own listener below
        }
        openDetail(entry);
      });

      const actionBtn = card.querySelector('.card-action');
      if (actionBtn) {
        actionBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (action.action === 'pull') {
            void doPull(entry, actionBtn);
          } else {
            void doPush(entry, actionBtn);
          }
        });
      }

      grid.appendChild(card);
    }
  }

  async function doPull(entry, button) {
    await withBusy(button, 'Working...', async () => {
      try {
        const result = await call('artifact.pull', {
          id: entry.manifest.id,
          remote: entry.remoteName,
          cwd: state.projectDir,
        });
        toastSuccess(`Pulled ${result.manifest.id}`);
        await loadCatalog();
      } catch (err) {
        toastError(err);
      }
    });
  }

  async function doPush(entry, button) {
    await withBusy(button, 'Working...', async () => {
      try {
        const result = await call('artifact.push', {
          id: entry.manifest.id,
          cwd: state.projectDir,
          options: {},
        });
        toastSuccess(`Pushed ${entry.manifest.id}: opened PR #${result.number} (${result.url})`);
        await loadCatalog();
      } catch (err) {
        toastError(err);
      }
    });
  }

  // ---------- detail ----------

  function openDetail(entry) {
    state.selectedKey = entryKey(entry);
    renderDetail(entry);
    showViewRaw('detail');
  }

  /** Switches the visible section without re-triggering showView()'s
   * per-view data load -- used by openDetail(), which already has the
   * entry it needs and shouldn't re-fetch the catalog. */
  function showViewRaw(view) {
    state.view = view;
    for (const section of document.querySelectorAll('.view')) {
      section.hidden = section.id !== `view-${view}`;
    }
    for (const btn of document.querySelectorAll('.nav-btn')) {
      btn.classList.toggle('active', btn.dataset.view === view);
    }
  }

  function renderDetail(entry) {
    const { manifest } = entry;
    $('detail-kind').textContent = manifest.kind;
    $('detail-name').textContent = manifest.id;
    $('detail-badge').textContent = STATUS_LABELS[entry.localStatus];
    $('detail-badge').className = `badge ${entry.localStatus}`;
    $('detail-description').textContent = manifest.description;
    $('meta-kind').textContent = manifest.kind;
    $('meta-version').textContent = manifest.version;
    $('meta-owner').textContent = manifest.owner;
    $('meta-refresh').textContent = manifest.refresh || '—';

    const tags = manifest.tags || { roles: [], teams: [], stacks: [] };
    const pills = [
      ...(tags.roles || []),
      ...(tags.teams || []),
      ...(tags.stacks || []).map((s) => `stack: ${s}`),
    ];
    $('meta-tags').innerHTML = pills.length
      ? pills.map((p) => `<span class="tag-pill">${escapeHtml(p)}</span>`).join('')
      : '<span class="tag-pill">none</span>';

    $('detail-install-path').textContent = entry.installTarget;

    const actionBtn = $('detail-action-btn');
    const action = actionButtonFor(entry);
    if (action) {
      actionBtn.hidden = false;
      actionBtn.textContent = action.label;
      actionBtn.onclick = () => {
        if (action.action === 'pull') {
          void doPull(entry, actionBtn).then(() => refreshDetailIfShown(entry));
        } else {
          void doPush(entry, actionBtn).then(() => refreshDetailIfShown(entry));
        }
      };
    } else {
      actionBtn.hidden = true;
      actionBtn.onclick = null;
    }
  }

  function refreshDetailIfShown(entry) {
    if (state.view !== 'detail' || state.selectedKey !== entryKey(entry)) {
      return;
    }
    const updated = state.catalog.find((e) => entryKey(e) === state.selectedKey);
    if (updated) {
      renderDetail(updated);
    }
  }

  // ---------- add new ----------

  async function loadRemotesForAddNewSelect() {
    const select = $('f-remote');
    select.innerHTML = '';
    try {
      state.remotes = await call('remote.list', {});
    } catch (err) {
      toastError(err);
      state.remotes = [];
    }
    for (const remote of state.remotes) {
      const option = document.createElement('option');
      option.value = remote.name;
      option.textContent = remote.name;
      select.appendChild(option);
    }
  }

  let pendingPayloadPath = null;

  async function pickPayload(directory) {
    try {
      const picked = await openDialog({ directory });
      if (!picked) {
        return;
      }
      pendingPayloadPath = picked;
      $('payload-path-display').textContent = picked;
    } catch (err) {
      toastError(err);
    }
  }

  function parseCommaList(value) {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  async function submitAddNew(ev) {
    ev.preventDefault();
    const submitBtn = $('addnew-submit-btn');

    if (!state.projectDir) {
      toastError(new Error('Select a project folder first.'));
      return;
    }
    if (!pendingPayloadPath) {
      toastError(new Error('Choose a payload file or folder first.'));
      return;
    }

    const id = $('f-id').value.trim();
    const kind = $('f-kind').value.trim();
    const description = $('f-description').value.trim();
    const owner = $('f-owner').value.trim();
    const roles = parseCommaList($('f-roles').value);
    const remote = $('f-remote').value;

    await withBusy(submitBtn, 'Working...', async () => {
      try {
        const result = await call('artifact.push', {
          id,
          cwd: state.projectDir,
          options: {
            isNew: true,
            remote,
            payloadPath: pendingPayloadPath,
            kind,
            owner,
            description,
            roles,
          },
        });
        toastSuccess(`Proposed ${id}: opened PR #${result.number} (${result.url})`);
        $('addnew-form').reset();
        pendingPayloadPath = null;
        $('payload-path-display').textContent = 'No file or folder selected';
        showView('browse');
      } catch (err) {
        toastError(err);
      }
    });
  }

  // ---------- settings ----------

  async function loadRemotesForSettings() {
    const list = $('remotes-list');
    list.innerHTML = '<p class="empty-state">Loading&hellip;</p>';
    try {
      state.remotes = await call('remote.list', {});
    } catch (err) {
      toastError(err);
      state.remotes = [];
    }
    renderRemotesList();
  }

  function renderRemotesList() {
    const list = $('remotes-list');
    if (state.remotes.length === 0) {
      list.innerHTML = '<p class="empty-state">No remotes registered yet.</p>';
      return;
    }
    list.innerHTML = state.remotes
      .map(
        (remote) => `
        <div class="settings-row">
          <div>
            <div class="n">${escapeHtml(remote.name)}</div>
            <div class="s">${escapeHtml(remote.url)} &middot; added ${escapeHtml(remote.addedAt)}</div>
          </div>
        </div>
      `,
      )
      .join('');
  }

  async function submitAddRemote(ev) {
    ev.preventDefault();
    const submitBtn = $('remote-submit-btn');
    const url = $('r-url').value.trim();
    const name = $('r-name').value.trim();

    await withBusy(submitBtn, 'Working...', async () => {
      try {
        const result = await call('remote.add', { url, name: name || undefined });
        toastSuccess(`Added remote "${result.name}" (${result.url})`);
        $('remote-form').reset();
        await loadRemotesForSettings();
      } catch (err) {
        toastError(err);
      }
    });
  }

  // ---------- wiring ----------

  function wireEvents() {
    for (const btn of document.querySelectorAll('.nav-btn')) {
      btn.addEventListener('click', () => showView(btn.dataset.view));
    }
    for (const btn of document.querySelectorAll('[data-view="browse"]')) {
      if (!btn.classList.contains('nav-btn')) {
        btn.addEventListener('click', () => showView('browse'));
      }
    }

    $('change-folder-btn').addEventListener('click', () => void changeFolder());
    $('refresh-btn').addEventListener('click', () => void loadCatalog());
    $('add-new-btn').addEventListener('click', () => showView('addnew'));
    $('back-to-browse-btn').addEventListener('click', () => showView('browse'));

    $('search-input').addEventListener('input', (ev) => {
      state.search = ev.target.value;
      renderCards();
    });

    $('addnew-form').addEventListener('submit', (ev) => void submitAddNew(ev));
    $('pick-payload-file-btn').addEventListener('click', () => void pickPayload(false));
    $('pick-payload-dir-btn').addEventListener('click', () => void pickPayload(true));

    $('remote-form').addEventListener('submit', (ev) => void submitAddRemote(ev));
  }

  async function init() {
    wireEvents();

    const stored = localStorage.getItem(PROJECT_DIR_KEY);
    if (stored) {
      state.projectDir = stored;
      try {
        state.catalog = await call('catalog.list', { cwd: stored });
      } catch (err) {
        // Stored path is no longer usable (removed, renamed, or otherwise
        // invalid) -- clear it and fall back to prompting for a folder
        // again, rather than getting stuck silently failing on every
        // Browse load.
        toastError(err);
        state.projectDir = null;
        localStorage.removeItem(PROJECT_DIR_KEY);
        state.catalog = [];
      }
    }

    // Render directly from the state already loaded above rather than
    // going through showView('browse'), which would otherwise immediately
    // re-trigger a second, redundant catalog.list call.
    renderFolderDisplay();
    renderChips();
    renderCards();
    showViewRaw('browse');
  }

  window.addEventListener('DOMContentLoaded', () => {
    void init();
  });
})();
