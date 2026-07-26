// DeliveryOS desktop UI: vanilla JS, single-page, no framework/build step.
// State + view-switching + render functions for Browse / Detail / Add-new /
// Settings. Every engine call goes through `DeliveryOS.call` (sidecar.js),
// which spawns a fresh sidecar process per call -- so every button that
// triggers one is disabled with a "Working..." label for the duration.
(function () {
  const call = window.DeliveryOS.call;
  const { open: openDialog } = window.__TAURI__.dialog;
  const { revealItemInDir } = window.__TAURI__.opener;
  const { listen } = window.__TAURI__.event;
  const { check } = window.__TAURI__.updater;
  const { relaunch } = window.__TAURI__.process;

  const PROJECT_DIR_KEY = 'deliveryos.projectDir';

  const STATUS_LABELS = {
    not_pulled: 'Not pulled',
    pulled: 'Pulled',
    edited_locally: 'Edited locally',
    update_available: 'Update available',
    both_changed: 'Both changed',
  };

  const state = {
    view: 'browse',
    projectDir: null,
    // last catalog.list() result, enriched client-side with `availableVersion`
    // (from sync.checkForUpdates) as entries: { manifest, remoteName,
    // localStatus, installTarget, availableVersion? }[]
    catalog: [],
    search: '',
    activeKind: 'All',
    selectedKey: null, // `${id}::${remoteName}` of the entry shown in Detail
    remotes: [],
  };

  // Unlisten function for the current `sidecar-progress` event subscription,
  // if one is active -- there is at most one live subscription at a time
  // (Detail's action button is the sole trigger for pull/push now), torn
  // down and re-created fresh every time a new action starts or a new
  // Detail view is opened.
  let progressUnlisten = null;

  // ---------- small DOM helpers ----------

  function $(id) {
    return document.getElementById(id);
  }

  function entryKey(entry) {
    return `${entry.manifest.id}::${entry.remoteName}`;
  }

  /** Derives the status actually shown in the UI (badge + action button)
   * from an entry's raw `localStatus` (from catalog.list) plus whatever
   * `availableVersion` was merged in client-side by a prior
   * sync.checkForUpdates call (see handleCheckForArtifactUpdates). An entry
   * that's both edited locally AND has a newer upstream version is its own
   * distinct status ('both_changed') -- deliberately not just
   * 'update_available' -- because pulling to get the update would silently
   * discard the local edit, which needs its own explicit warning/action
   * rather than a plain one-click button. */
  function displayStatus(entry) {
    if (entry.availableVersion && entry.localStatus === 'edited_locally') {
      return 'both_changed';
    }
    if (entry.availableVersion) {
      return 'update_available';
    }
    return entry.localStatus;
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
    const status = displayStatus(entry);
    if (status === 'not_pulled') {
      return { label: 'Pull', action: 'pull' };
    }
    if (status === 'edited_locally') {
      return { label: 'Push', action: 'push' };
    }
    if (status === 'update_available') {
      // Pulling always overwrites install_target with current upstream
      // content, so "Update" is just a pull under a friendlier label --
      // no separate update codepath needed.
      return { label: 'Update', action: 'pull' };
    }
    if (status === 'both_changed') {
      // No default one-click action: pulling here would silently discard
      // the local edit. Detail view instead renders an explicit warning
      // block with its own confirm-gated overwrite button.
      return null;
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

      const status = displayStatus(entry);
      card.innerHTML = `
        <div class="row1">
          <span class="kind">${escapeHtml(entry.manifest.kind)}</span>
          <span class="badge ${status}">${STATUS_LABELS[status]}</span>
        </div>
        <div class="name">${escapeHtml(entry.manifest.id)}</div>
        <div class="summary">${escapeHtml(entry.manifest.description)}</div>
        <div class="row2">
          <span class="meta">v${escapeHtml(entry.manifest.version)} &middot; ${escapeHtml(entry.manifest.owner)}</span>
        </div>
      `;

      // The whole card is the click target now -- Pull/Push moved into
      // Detail, so there's no inner action button to carve out a
      // stopPropagation() exception for anymore.
      card.addEventListener('click', () => openDetail(entry));

      grid.appendChild(card);
    }
  }

  /** Runs `action` ('pull' or 'push') for `entry`, driving the Detail
   * view's progress panel (see beginProgress/endProgress) around the call.
   * This is the single call site for both actions now that cards no longer
   * have their own action button -- previously doPull/doPush were each
   * called from both a card's button and Detail's button; now Detail's
   * action button is the only trigger, so one function covers it. */
  async function runArtifactAction(entry, action, button) {
    await withBusy(button, 'Working...', async () => {
      await beginProgress();
      try {
        if (action === 'pull') {
          const result = await call('artifact.pull', {
            id: entry.manifest.id,
            remote: entry.remoteName,
            cwd: state.projectDir,
          });
          toastSuccess(`Pulled ${result.manifest.id}`);
        } else {
          const result = await call('artifact.push', {
            id: entry.manifest.id,
            cwd: state.projectDir,
            options: {},
          });
          toastSuccess(`Pushed ${entry.manifest.id}: opened PR #${result.number} (${result.url})`);
        }
        endProgress(true);
        await loadCatalog();
      } catch (err) {
        endProgress(false);
        toastError(err);
      }
    });
  }

  /** Checks every registered remote referenced by the current project's
   * lockfile for newer artifact versions (`sync.checkForUpdates`), then
   * merges the result into the already-loaded `state.catalog` client-side
   * by matching `id`+`remoteName` -- this only enriches data already
   * rendered from a prior `catalog.list` call; it deliberately does NOT
   * call `loadCatalog()`/re-run `catalog.list`, which stays fast and
   * local-only. Drives the same Detail progress panel
   * (beginProgress/endProgress) that runArtifactAction uses, so a fetch
   * against every relevant remote shows live stage-by-stage progress
   * instead of appearing to hang.
   *
   * This is the core work only -- no button busy/label state and no toast,
   * so it can be shared as-is by both the manual "Check for updates" button
   * (handleCheckForArtifactUpdates, below) and the background auto-sync
   * timer (onAutoSyncTick) without either one visibly driving UI feedback
   * that belongs to the other (the button shouldn't silently flip to
   * "Checking..." every 20 minutes when the user didn't click it, and the
   * background tick shouldn't show its own "no updates" toast on top of the
   * manual button's). Returns the raw `updates` array so callers can decide
   * what, if anything, to tell the user about the result. Rethrows on
   * failure (after marking the progress panel failed) so each caller can
   * apply its own error handling. */
  async function checkForArtifactUpdatesCore() {
    await beginProgress();
    try {
      const updates = await call('sync.checkForUpdates', { cwd: state.projectDir });
      endProgress(true);

      for (const update of updates) {
        const entry = state.catalog.find(
          (e) => e.manifest.id === update.id && e.remoteName === update.remote,
        );
        if (entry) {
          entry.availableVersion = update.availableVersion;
        }
      }

      renderCards();
      if (state.selectedKey) {
        const selected = state.catalog.find((e) => entryKey(e) === state.selectedKey);
        if (selected) {
          refreshDetailIfShown(selected);
        }
      }

      return updates;
    } catch (err) {
      endProgress(false);
      throw err;
    }
  }

  /** Manual "Check for updates" button handler: busies/relabels the button
   * and always reports a result (either "No updates available." or a count)
   * via toast, wrapped around the shared checkForArtifactUpdatesCore(). */
  async function handleCheckForArtifactUpdates() {
    const btn = $('check-artifact-updates-btn');
    await withBusy(btn, 'Checking...', async () => {
      try {
        const updates = await checkForArtifactUpdatesCore();
        toastSuccess(
          updates.length === 0
            ? 'No updates available.'
            : `${updates.length} update${updates.length === 1 ? '' : 's'} available.`,
        );
      } catch (err) {
        toastError(err);
      }
    });
  }

  // ---------- detail ----------

  /** Shows the Open-folder button's target in the OS file manager. Uses
   * `revealItemInDir` (not `openPath`) specifically because install_target
   * can be either a directory (payload_path pointed at a folder) or a
   * single file (payload_path pointed at one file, e.g. code-reviewer's
   * install target is a single .md file) -- openPath on a file would launch
   * that file in its default app (e.g. an editor) instead of showing it in
   * Explorer, which doesn't match what a button labeled "Open folder" should
   * do for either case. revealItemInDir handles both uniformly. Errors (e.g.
   * the path no longer exists on disk) surface as a toast, same as every
   * other engine/OS call in this app. */
  async function openInstallFolder(path) {
    try {
      await revealItemInDir(path);
    } catch (err) {
      toastError(err);
    }
  }

  /** Appends one `{stage, message}` line to the progress log and scrolls it
   * into view. Each line shows the stage as a small uppercase label
   * alongside the human-readable message -- deliberately not a percentage,
   * see style.css's `.progress-log` comment for why. */
  function appendProgressLine(stage, message) {
    const log = $('progress-log');
    const line = document.createElement('div');
    line.className = 'progress-line';
    line.innerHTML = '<span class="stage"></span><span class="msg"></span>';
    line.querySelector('.stage').textContent = stage;
    line.querySelector('.msg').textContent = message;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  /** Resets and shows the progress panel for a fresh pull/push, and
   * (re)subscribes to `sidecar-progress` events -- awaited so the
   * subscription is guaranteed live before the caller issues the
   * `artifact.pull`/`artifact.push` call that follows, closing any race
   * where an early progress line could otherwise arrive before anyone is
   * listening for it. Tears down any previous subscription first (there's
   * only ever one action in flight at a time, but this is defensive). */
  async function beginProgress() {
    const panel = $('detail-progress');
    $('progress-log').innerHTML = '';
    panel.hidden = false;
    panel.classList.remove('done', 'error');
    $('progress-status').textContent = 'Working…';

    if (progressUnlisten) {
      progressUnlisten();
      progressUnlisten = null;
    }
    progressUnlisten = await listen('sidecar-progress', (event) => {
      const { stage, message } = event.payload;
      appendProgressLine(stage, message);
    });
  }

  /** Marks the progress panel as finished (success or failure) and tears
   * down the event subscription. Deliberately does NOT hide or clear the
   * panel/log -- the point is to leave the full stage history visible
   * through to "Done"/"Failed", not wipe it the moment the action settles. */
  function endProgress(success) {
    const panel = $('detail-progress');
    panel.classList.add(success ? 'done' : 'error');
    $('progress-status').textContent = success ? 'Done' : 'Failed';
    if (progressUnlisten) {
      progressUnlisten();
      progressUnlisten = null;
    }
  }

  /** Resets the progress panel back to its hidden, empty idle state. Called
   * only when a NEW Detail view is opened (openDetail(), below) -- never by
   * renderDetail()/refreshDetailIfShown()'s post-action re-render, which
   * must leave an in-progress or just-finished log alone. */
  function resetProgressPanel() {
    const panel = $('detail-progress');
    panel.hidden = true;
    panel.classList.remove('done', 'error');
    $('progress-log').innerHTML = '';
    if (progressUnlisten) {
      progressUnlisten();
      progressUnlisten = null;
    }
  }

  function openDetail(entry) {
    state.selectedKey = entryKey(entry);
    resetProgressPanel();
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
    const status = displayStatus(entry);
    $('detail-kind').textContent = manifest.kind;
    $('detail-name').textContent = manifest.id;
    $('detail-badge').textContent = STATUS_LABELS[status];
    $('detail-badge').className = `badge ${status}`;
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

    const openFolderBtn = $('detail-open-folder-btn');
    if (entry.localStatus !== 'not_pulled') {
      openFolderBtn.hidden = false;
      openFolderBtn.onclick = () => void openInstallFolder(entry.installTarget);
    } else {
      openFolderBtn.hidden = true;
      openFolderBtn.onclick = null;
    }

    const actionBtn = $('detail-action-btn');
    const action = actionButtonFor(entry);
    if (action) {
      actionBtn.hidden = false;
      actionBtn.textContent = action.label;
      actionBtn.onclick = () => {
        void runArtifactAction(entry, action.action, actionBtn).then(() => refreshDetailIfShown(entry));
      };
    } else {
      actionBtn.hidden = true;
      actionBtn.onclick = null;
    }

    // 'both_changed' gets no default one-click action button above -- instead
    // a distinct warning block with its own confirm-gated overwrite button,
    // so a local edit is never silently discarded by a plain "Update" click.
    const driftWarning = $('detail-drift-warning');
    const overwriteBtn = $('detail-overwrite-btn');
    if (status === 'both_changed') {
      driftWarning.hidden = false;
      overwriteBtn.onclick = () => {
        if (
          window.confirm(
            'This will discard your local edits to ' +
              entry.manifest.id +
              ' and replace them with the upstream version. Continue?',
          )
        ) {
          void runArtifactAction(entry, 'pull', overwriteBtn).then(() => refreshDetailIfShown(entry));
        }
      };
    } else {
      driftWarning.hidden = true;
      overwriteBtn.onclick = null;
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
    const postInstall = $('f-post-install').value.trim() || undefined;

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
            postInstall,
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

  // ---------- updates ----------

  async function handleCheckForUpdates() {
    const btn = $('check-updates-btn');
    const status = $('update-status');
    await withBusy(btn, 'Checking...', async () => {
      try {
        const update = await check();
        if (!update) {
          status.textContent = 'You are on the latest version.';
          toastSuccess('You are on the latest version.');
          return;
        }
        status.textContent = `Update ${update.version} available. Downloading and installing...`;
        toastSuccess(`Update ${update.version} available. Downloading and installing...`);
        await update.downloadAndInstall();
        await relaunch();
      } catch (err) {
        status.textContent = '';
        toastError(err);
      }
    });
  }

  // ---------- auto-sync ----------

  // Reentrancy guard for onAutoSyncTick, below -- there's no scenario where
  // two ticks should ever run concurrently (each is a full
  // sync.checkForUpdates round-trip against every remote), so a stray
  // second `auto-sync-tick` arriving before the first finishes just skips
  // itself rather than piling up overlapping checks.
  let autoSyncInFlight = false;

  /** Handles the periodic `auto-sync-tick` event emitted by the Rust
   * backend (see src-tauri/src/lib.rs's 20-minute timer). Silently reruns
   * the exact same check+merge logic the manual "Check for updates" button
   * uses (checkForArtifactUpdatesCore) -- deliberately without that
   * button's busy/label feedback, since the user didn't click anything --
   * and only surfaces a toast when the tick actually turned up new updates
   * (comparing the count of entries with an `availableVersion` before vs.
   * after), so a routine no-op tick every 20 minutes stays invisible rather
   * than nagging the user. */
  async function onAutoSyncTick() {
    if (autoSyncInFlight) return; // reentrancy guard: skip this tick if a check is already running
    if (!state.projectDir) return; // nothing to check without a project folder
    autoSyncInFlight = true;
    try {
      const before = state.catalog.filter((e) => e.availableVersion).length;
      await checkForArtifactUpdatesCore();
      const after = state.catalog.filter((e) => e.availableVersion).length;
      if (after > before) {
        toastSuccess(`${after - before} new update(s) available.`);
      }
    } catch (err) {
      toastError(err);
    } finally {
      autoSyncInFlight = false;
    }
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
    $('check-artifact-updates-btn').addEventListener('click', () => void handleCheckForArtifactUpdates());
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

    $('check-updates-btn').addEventListener('click', () => void handleCheckForUpdates());
  }

  async function init() {
    wireEvents();

    // One-time subscription for the whole app session -- unlike
    // `sidecar-progress` (re-subscribed per action via beginProgress/
    // endProgress), there's exactly one `auto-sync-tick` listener ever
    // needed, since the Rust timer behind it runs for the lifetime of the
    // app and never needs tearing down/re-creating.
    await listen('auto-sync-tick', () => void onAutoSyncTick());

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
