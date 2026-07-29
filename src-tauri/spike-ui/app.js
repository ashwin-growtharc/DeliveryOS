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

  // Display order + label for each of manifest.tags's own (plural) keys --
  // e.g. a `stacks: ['python']` tag shows under the "stack" category.
  // "project" (not "team") is the deliberate display label for `teams`.
  // componentTypes rides along here too, so Browse-by-tag picks it up
  // automatically -- the dedicated "UI Components" page (renderUiComponentsPage)
  // is a separate, richer view specifically for kind:"ui-component" cards
  // with live previews, not a replacement for this generic one.
  const TAG_CATEGORIES = ['stacks', 'roles', 'teams', 'componentTypes'];
  const TAG_CATEGORY_LABEL = { stacks: 'stack', roles: 'role', teams: 'project', componentTypes: 'component type' };

  const STATUS_LABELS = {
    not_pulled: 'Not pulled',
    pulled: 'Pulled',
    edited_locally: 'Edited locally',
    update_available: 'Update available',
    both_changed: 'Both changed',
  };

  // ---------- kind icon (Browse's cards, Detail, Tag Folder/Scan rows) ----------
  //
  // A small, distinct mark per kind, plus a warm accent tint -- never the
  // AI-reserved purple/cyan tokens, matching the rule already applied
  // elsewhere in this app. Kind stays open-ended (z.string() in the
  // manifest schema, not a closed enum -- see ARCHITECTURE.md), so this is
  // a convenience lookup, not a whitelist: any kind not listed here falls
  // back to a neutral diamond glyph rather than a broken/missing icon.
  const KIND_ICON = {
    agent: { icon: 'i-kind-agent', bg: 'var(--sage-100)', fg: 'var(--sage-700)' },
    skill: { icon: 'i-kind-skill', bg: 'var(--sand-100)', fg: '#8A5A2B' },
    command: { icon: 'i-kind-command', bg: 'var(--sky-100)', fg: '#2E5E82' },
    rule: { icon: 'i-kind-rule', bg: 'var(--sage-50)', fg: 'var(--primary-700)' },
    template: { icon: 'i-kind-template', bg: 'var(--gold-500)', fg: '#6B4A00' },
    doc: { icon: 'i-kind-doc', bg: 'var(--surface-inset)', fg: 'var(--primary-700)' },
  };
  const KIND_ICON_FALLBACK = { icon: 'i-kind-default', bg: 'var(--surface-inset)', fg: 'var(--primary-700)' };

  /** Returns the inner HTML for a `.kind-swatch` element (a colored,
   * rounded icon tile) for `kind` -- append `' sm'`/`' lg'` to `sizeClass`
   * for the smaller (kind-group rows) or larger (Detail header) variants;
   * default size is Browse's own card treatment. Callers set the class on
   * their own wrapper element and use this just for the inner
   * background/color/icon. */
  function kindIconParts(kind) {
    return KIND_ICON[kind] ?? KIND_ICON_FALLBACK;
  }

  function kindSwatchHtml(kind, extraClass) {
    const entry = kindIconParts(kind);
    const cls = `kind-swatch${extraClass ? ` ${extraClass}` : ''}`;
    return (
      `<div class="${cls}" style="background:${entry.bg};color:${entry.fg};">`
      + `<svg><use href="#${entry.icon}"/></svg></div>`
    );
  }

  // ---------- tag value icon (Browse by tag's list rows) ----------
  //
  // Real research (GitHub's own topic-browsing page) confirms a
  // recognizable icon per item is what makes a "browse by category" list
  // feel rich, not a chart device. Only a curated few stack values get
  // their own mark (simplified, not a trademarked logo, or -- for
  // TypeScript/JavaScript -- literal lettering, since that IS their real
  // mark); anything else, and every role/project value, gets a sensible
  // generic icon instead of an empty/broken one. Tag values are free-text
  // (see Add New's Stack field), so this is deliberately a small curated
  // convenience, not an attempt to cover every possible value.
  const STACK_ICON = {
    python: { icon: 'i-lang-python', bg: 'var(--sage-100)', fg: 'var(--sage-700)' },
    java: { icon: 'i-lang-java', bg: 'var(--sand-100)', fg: '#8A5A2B' },
    rust: { icon: 'i-lang-rust', bg: 'var(--gold-500)', fg: '#6B4A00' },
    typescript: { text: 'TS', bg: 'var(--sky-100)', fg: '#2E5E82' },
    javascript: { text: 'JS', bg: 'var(--gold-500)', fg: '#6B4A00' },
    go: { text: 'Go', bg: 'var(--sky-100)', fg: '#2E5E82' },
    ruby: { text: 'Rb', bg: 'var(--danger-100)', fg: 'var(--danger-600)' },
  };

  /** Returns `{ bg, fg, html }` for a `.tag-item-icon` -- `category` is one
   * of the raw manifest.tags keys ('stacks'/'roles'/'teams'). */
  function tagValueIconParts(category, value) {
    if (category === 'stacks') {
      const entry = STACK_ICON[value.toLowerCase()];
      if (entry) {
        const html = entry.icon
          ? `<svg><use href="#${entry.icon}"/></svg>`
          : `<span class="tag-item-icon-text">${escapeHtml(entry.text)}</span>`;
        return { bg: entry.bg, fg: entry.fg, html };
      }
      return { bg: 'var(--surface-inset)', fg: 'var(--primary-700)', html: '<svg><use href="#i-tag"/></svg>' };
    }
    if (category === 'roles') {
      return { bg: 'var(--sage-100)', fg: 'var(--sage-700)', html: '<svg><use href="#i-role"/></svg>' };
    }
    // 'teams' (displayed as "project")
    return { bg: 'var(--sky-100)', fg: '#2E5E82', html: '<svg><use href="#i-folder"/></svg>' };
  }

  const state = {
    view: 'browse',
    projectDir: null,
    // last catalog.list() result, enriched client-side with `availableVersion`
    // (from sync.checkForUpdates) as entries: { manifest, remoteName,
    // localStatus, installTarget, availableVersion? }[]
    catalog: [],
    search: '',
    // Multi-select kind filter -- empty set means "All". A Set (not a
    // single string) so e.g. "agent" + "skill" can be viewed together; this
    // is a global filter, applied both to Browse's own grid AND to a Tag
    // Folder's grouped results (see applyKindFilter), so picking a kind in
    // Browse and then drilling into a tag folder stays consistent instead
    // of the kind filter silently having no effect there.
    activeKinds: new Set(),
    // '' means "all remotes" -- single-select (a <select>, matching every
    // other remote picker already in this app: Add New, Scan) rather than
    // chips like Kind, since an artifact only ever comes from exactly one
    // remote (unlike kind/tags, picking more than one at a time isn't a
    // meaningful combination here).
    activeRemote: '',
    sortBy: 'name', // 'name' | 'kind' | 'status' | 'edited' -- see sortEntries()
    // Which category tab is active on the Browse-by-tag page (its own
    // sidebar destination/view, see renderTagsPage) -- independent of
    // activeTagCategory/activeTagValue below, which track whichever Tag
    // Folder is currently *open*, not which tab is showing on the page one
    // navigates there from.
    tagsPageCategory: null, // 'stacks' | 'roles' | 'teams' | 'componentTypes' | null
    // Which componentTypes VALUE tab is active on the UI Components page --
    // a separate concern from tagsPageCategory (that's the Browse-by-tag
    // page's DIMENSION tab; this page only ever has one dimension).
    uiComponentsPageCategory: null,
    // Set when a tag VALUE is picked (from the Browse-by-tag page),
    // opening the dedicated Tag Folder view (openTagFolder/renderTagFolder),
    // grouped by kind.
    activeTagCategory: null, // 'stacks' | 'roles' | 'teams' | null
    activeTagValue: null,
    // Filters the value list shown for the active category on the
    // Browse-by-tag page (e.g. typing "py" narrows a long "stack" value
    // list to "python"). Reset whenever the active category changes.
    tagValueSearch: '',
    // Filters *within* an open Tag Folder's own results, independent of
    // Browse's own search box -- reset every time a new folder is opened.
    tagFolderSearch: '',
    selectedKey: null, // `${id}::${remoteName}` of the entry shown in Detail
    remotes: [],
  };

  // Unlisten function for the current `sidecar-progress` event subscription,
  // if one is active -- there is at most one live subscription at a time
  // (only one pull/push runs at once, whether triggered from Detail's action
  // button or a row/Pull-all button in a Tag Folder view), torn down and
  // re-created fresh every time a new action starts or a new Detail view is
  // opened.
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

  /** Whether an entry has an uncommitted local edit -- true for both
   * 'edited_locally' and 'both_changed' (both_changed is still a local
   * edit, just one that also has an upstream update sitting on top of it).
   * Used by the "Locally edited first" sort so both statuses bubble up
   * together, not just whichever one alphabetizes first. */
  function hasLocalEdit(entry) {
    return displayStatus(entry) === 'edited_locally' || displayStatus(entry) === 'both_changed';
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
    // The shared progress/log panel belongs to whatever artifact/folder was
    // just acted on, not to Browse/Settings/Add-new -- without this, a log
    // left over from a Detail or Tag Folder action stayed visible after
    // navigating away from it (e.g. clicking "Back to Browse"), showing up
    // underneath the plain artifact grid where it doesn't belong. Detail and
    // Tag Folder both navigate in via showViewRaw (below), which already
    // calls this same reset right before rendering, so this doesn't clear
    // anything they're about to show.
    resetProgressPanel();
    for (const section of document.querySelectorAll('.view')) {
      section.hidden = section.id !== `view-${view}`;
    }
    for (const btn of document.querySelectorAll('.sidebar-item')) {
      btn.classList.toggle('active', btn.dataset.view === view);
    }
    if (view === 'browse') {
      void loadCatalog();
    } else if (view === 'tags') {
      renderTagsPage();
    } else if (view === 'ui-components') {
      renderUiComponentsPage();
    } else if (view === 'settings') {
      void loadRemotesForSettings();
    } else if (view === 'scan') {
      void openScanView();
    } else if (view === 'addnew') {
      resetAddNewForm();
      void loadRemotesForAddNewSelect();
      populateKindPicker();
      addNewWizardMode = false;
      resetWizard();
    }
  }

  // ---------- browse ----------

  async function loadCatalog() {
    renderFolderDisplay();
    if (!state.projectDir) {
      state.catalog = [];
      renderChips();
      renderCards();
      refreshTagPickerSuggestions();
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
      refreshTagPickerSuggestions();
    });
  }

  /** Bound only to the Refresh button's click -- unlike the plain
   * `catalog.list` that every other call site above uses (folder switches,
   * post-push/pull re-renders, view switches), this one actually re-fetches
   * every registered remote first via `catalog.refresh`. Deliberately not
   * used anywhere else: an artifact proposed via Add New and merged upstream
   * would otherwise never show up in Browse (nothing fetches a remote
   * nobody has pulled anything from yet), but re-fetching every remote on
   * every routine internal re-render would reintroduce network flakiness
   * into actions that don't need it. */
  async function refreshCatalogFromRemotes() {
    renderFolderDisplay();
    if (!state.projectDir) {
      return;
    }
    const refreshBtn = $('refresh-btn');
    await withBusy(refreshBtn, 'Refreshing...', async () => {
      try {
        state.catalog = await call('catalog.refresh', { cwd: state.projectDir });
      } catch (err) {
        toastError(err);
      }
      renderChips();
      renderCards();
      refreshTagPickerSuggestions();
    });
  }

  /** Kind tabs (an underline tab bar, not pill chips -- reads as a
   * deliberate filter control instead of a generic row of buttons) are
   * multi-select (e.g. "agent" + "skill" together) -- "All" is just
   * shorthand for "nothing specifically selected," so clicking it clears
   * the whole set rather than being its own kind value. The kind
   * vocabulary itself stays fully dynamic (derived from whatever kinds
   * actually exist in the loaded catalog, same as before) rather than a
   * hardcoded list -- `kind` is deliberately open-ended in the manifest
   * schema (see ARCHITECTURE.md), so a fixed button set would either show
   * dead buttons for kinds nobody uses yet or silently omit a real one
   * someone invents later. This selection is also applied inside an open
   * Tag Folder (see applyKindFilter), not just Browse's own grid. */
  function renderChips() {
    const kinds = Array.from(new Set(state.catalog.map((e) => e.manifest.kind))).sort();
    const container = $('chips');
    container.innerHTML = '';

    const allTab = document.createElement('button');
    allTab.className = `tab ${state.activeKinds.size === 0 ? 'active' : ''}`;
    allTab.textContent = 'All';
    allTab.addEventListener('click', () => {
      state.activeKinds.clear();
      renderChips();
      renderCards();
    });
    container.appendChild(allTab);

    for (const kind of kinds) {
      const tab = document.createElement('button');
      tab.className = `tab ${state.activeKinds.has(kind) ? 'active' : ''}`;
      tab.textContent = kind;
      tab.addEventListener('click', () => {
        if (state.activeKinds.has(kind)) {
          state.activeKinds.delete(kind);
        } else {
          state.activeKinds.add(kind);
        }
        renderChips();
        renderCards();
      });
      container.appendChild(tab);
    }

    renderRemoteFilterSelect();
  }

  /** Shared by Browse's grid and an open Tag Folder's grouped results --
   * an empty `state.activeKinds` means no restriction (matches "All"). */
  function applyKindFilter(entries) {
    if (state.activeKinds.size === 0) {
      return entries;
    }
    return entries.filter((entry) => state.activeKinds.has(entry.manifest.kind));
  }

  function applyRemoteFilter(entries) {
    if (!state.activeRemote) {
      return entries;
    }
    return entries.filter((entry) => entry.remoteName === state.activeRemote);
  }

  /** Every filter that applies globally (Browse's grid AND an open Tag
   * Folder) chained together -- Kind and Remote. Search stays separate
   * since Tag Folder has its own, differently-scoped search box (see
   * filteredTagFolderEntries) rather than sharing Browse's. */
  function applyGlobalFilters(entries) {
    return applyRemoteFilter(applyKindFilter(entries));
  }

  /** (Re)populates the Remote filter <select> from whatever remotes are
   * actually represented in the loaded catalog -- not the full registered-
   * remotes list (Settings' own list), so this never offers a remote with
   * zero artifacts in it as a filter option. Preserves the current
   * selection across a catalog reload when that remote is still present;
   * falls back to "All remotes" if it disappeared (e.g. the remote was
   * removed in Settings). */
  function renderRemoteFilterSelect() {
    const select = $('remote-filter-select');
    const remoteNames = Array.from(new Set(state.catalog.map((e) => e.remoteName))).sort();
    if (state.activeRemote && !remoteNames.includes(state.activeRemote)) {
      state.activeRemote = '';
    }
    select.innerHTML = '<option value="">All remotes</option>';
    for (const name of remoteNames) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    }
    select.value = state.activeRemote;
  }

  /** Case-insensitive match across everything a user would plausibly
   * remember about an artifact -- id, description, kind, owner, and every
   * tag value -- not just id+description. A search for "python" or
   * "design" now finds artifacts by stack/role/project too, not only ones
   * that happen to mention the word in their description. */
  function matchesSearch(entry, search) {
    const tags = entry.manifest.tags || {};
    const haystack = [
      entry.manifest.id,
      entry.manifest.description,
      entry.manifest.kind,
      entry.manifest.owner,
      ...(tags.roles || []),
      ...(tags.stacks || []),
      ...(tags.teams || []),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(search);
  }

  /** Shared ordering for Browse's grid and each kind-group's rows inside a
   * Tag Folder. Doesn't mutate its input. 'status' orders by the same
   * badge label the user actually sees (STATUS_LABELS), so the grouping
   * reads the same as what's on screen, not an arbitrary internal enum
   * order; ties within any mode fall back to id so the result is stable
   * and reproducible rather than re-shuffling on every render. */
  function sortEntries(entries) {
    const sorted = [...entries];
    sorted.sort((a, b) => {
      if (state.sortBy === 'kind') {
        return (
          a.manifest.kind.localeCompare(b.manifest.kind) || a.manifest.id.localeCompare(b.manifest.id)
        );
      }
      if (state.sortBy === 'status') {
        const labelA = STATUS_LABELS[displayStatus(a)];
        const labelB = STATUS_LABELS[displayStatus(b)];
        return labelA.localeCompare(labelB) || a.manifest.id.localeCompare(b.manifest.id);
      }
      if (state.sortBy === 'edited') {
        const editedA = hasLocalEdit(a) ? 0 : 1;
        const editedB = hasLocalEdit(b) ? 0 : 1;
        return editedA - editedB || a.manifest.id.localeCompare(b.manifest.id);
      }
      return a.manifest.id.localeCompare(b.manifest.id);
    });
    return sorted;
  }

  // ---------- browse by tag (its own sidebar destination/view) ----------
  //
  // Tried inline in Browse's own grid, tried permanently expanded in the
  // sidebar, tried a flyout popover off a sidebar row -- all three either
  // dumped variable-length tag data next to stable content, or were
  // inconsistent with every other sidebar item (which all go to a real
  // page). This is just that: a normal page, entered via showView('tags').

  /** Populates the category tab row (stack/role/project, whichever
   * actually have at least one value in the loaded catalog) and renders
   * the currently-active one's value list. Falls back to the first
   * present category if the previously-active one no longer has any
   * values (e.g. the catalog just reloaded). */
  function renderTagsPage() {
    $('tags-no-folder').hidden = Boolean(state.projectDir);

    const presentCategories = TAG_CATEGORIES.filter((category) =>
      state.catalog.some((entry) => (entry.manifest.tags?.[category] ?? []).length > 0),
    );
    if (!state.tagsPageCategory || !presentCategories.includes(state.tagsPageCategory)) {
      state.tagsPageCategory = presentCategories[0] ?? null;
    }

    const tabsContainer = $('tags-cat-tabs');
    tabsContainer.innerHTML = '';
    for (const category of presentCategories) {
      const tab = document.createElement('button');
      tab.className = `tab ${state.tagsPageCategory === category ? 'active' : ''}`;
      tab.textContent = TAG_CATEGORY_LABEL[category];
      tab.addEventListener('click', () => {
        state.tagsPageCategory = category;
        state.tagValueSearch = '';
        $('tags-value-search').value = '';
        renderTagsPage();
      });
      tabsContainer.appendChild(tab);
    }

    renderTagsPageList();
  }

  /** The active category's values as a plain list -- icon-led rows (see
   * tagValueIconParts) reusing the exact same card language as Browse's
   * own .res-card, sorted by count descending so the most-populous value
   * leads (a plain alphabetical list doesn't actually show what's worth
   * looking at first). Deduped case-insensitively -- tag values come from
   * free-text input (Add New's Stack/Team fields, or the CLI's
   * --stacks/--teams flags), so "python" and "Python" typed on two
   * different pushes must still land in the same folder, not two separate
   * ones. */
  function renderTagsPageList() {
    const container = $('tags-list');
    const emptyState = $('tags-empty');
    const searchInput = $('tags-value-search');
    const category = state.tagsPageCategory;
    container.innerHTML = '';

    if (!category) {
      searchInput.hidden = true;
      emptyState.hidden = false;
      $('tags-count').textContent = '';
      return;
    }
    searchInput.hidden = false;

    const allValues = Array.from(
      new Set(
        state.catalog.flatMap((entry) => entry.manifest.tags?.[category] ?? []).map((v) => v.toLowerCase()),
      ),
    );
    const search = state.tagValueSearch.trim().toLowerCase();
    const filteredValues = search.length === 0 ? allValues : allValues.filter((v) => v.includes(search));

    const withCounts = filteredValues.map((value) => ({
      value,
      // Scoped to the active Kind/Remote selection too (if any), so this
      // count matches what opening the folder will actually show.
      count: applyGlobalFilters(entriesForTag(category, value)).length,
    }));
    withCounts.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

    emptyState.hidden = withCounts.length !== 0;
    $('tags-count').textContent = `${withCounts.length} value${withCounts.length === 1 ? '' : 's'}`;

    for (const { value, count } of withCounts) {
      const icon = tagValueIconParts(category, value);
      const row = document.createElement('div');
      row.className = 'tag-item-row';
      row.innerHTML = `
        <div class="tag-item-icon" style="background:${icon.bg};color:${icon.fg};">${icon.html}</div>
        <div class="tag-item-body">
          <div class="tag-item-name"></div>
          <div class="tag-item-count"></div>
        </div>
        <span class="tag-item-chev" aria-hidden="true">&rsaquo;</span>
      `;
      row.querySelector('.tag-item-name').textContent = value;
      row.querySelector('.tag-item-count').textContent = `${count} artifact${count === 1 ? '' : 's'}`;
      row.addEventListener('click', () => openTagFolder(category, value));
      container.appendChild(row);
    }
  }

  // ---------- UI Components (its own sidebar page, live previews) ----------
  //
  // See docs/ui-components-feature-design.md. Category tabs here are the
  // componentTypes VALUES themselves (Buttons/Navbars/Cards/...), not a
  // dimension-picker the way Browse-by-tag's stack/role/project tabs work
  // -- there's only one relevant tag dimension on this page. Reuses the
  // global remote filter (applyRemoteFilter) but deliberately NOT Browse's
  // own Kind tab-row filter (state.activeKinds/applyKindFilter) -- that's a
  // different page's own control; kind is implicitly always "ui-component"
  // here, not something this page lets you toggle.

  /** Populates the category tab row and renders the card grid. */
  function renderUiComponentsPage() {
    $('ui-components-no-folder').hidden = Boolean(state.projectDir);

    const uiComponentEntries = applyRemoteFilter(
      state.catalog.filter((entry) => entry.manifest.kind === 'ui-component'),
    );
    const presentTypes = Array.from(
      new Set(uiComponentEntries.flatMap((entry) => entry.manifest.tags?.componentTypes ?? [])),
    ).sort();

    if (state.uiComponentsPageCategory && !presentTypes.includes(state.uiComponentsPageCategory)) {
      state.uiComponentsPageCategory = null;
    }

    const tabsContainer = $('ui-components-cat-tabs');
    tabsContainer.innerHTML = '';

    const allTab = document.createElement('button');
    allTab.className = `tab ${!state.uiComponentsPageCategory ? 'active' : ''}`;
    allTab.textContent = 'All';
    allTab.addEventListener('click', () => {
      state.uiComponentsPageCategory = null;
      renderUiComponentsPage();
    });
    tabsContainer.appendChild(allTab);

    for (const type of presentTypes) {
      const tab = document.createElement('button');
      tab.className = `tab ${state.uiComponentsPageCategory === type ? 'active' : ''}`;
      tab.textContent = type;
      tab.addEventListener('click', () => {
        state.uiComponentsPageCategory = type;
        renderUiComponentsPage();
      });
      tabsContainer.appendChild(tab);
    }

    renderUiComponentsGrid(uiComponentEntries);
  }

  /** The active category's cards, each a live sandboxed-iframe preview.
   * Lazy-rendered via IntersectionObserver -- a grid of many components
   * shouldn't eagerly call preview.compile for every single one the
   * moment the page opens, only the ones actually scrolled into view. */
  // Tracks the grid's current IntersectionObserver so a re-render (e.g.
  // clicking a different category tab) can disconnect the previous one
  // first -- without this, every re-render's `container.innerHTML = ''`
  // detaches the old cards from the DOM but leaves the old observer still
  // holding references to them (and their closures) indefinitely, since
  // nothing ever called .disconnect() on it.
  let uiComponentsGridObserver = null;

  function renderUiComponentsGrid(uiComponentEntries) {
    const container = $('ui-components-grid');
    const emptyState = $('ui-components-empty');
    container.innerHTML = '';

    if (uiComponentsGridObserver) {
      uiComponentsGridObserver.disconnect();
    }

    const category = state.uiComponentsPageCategory;
    const filtered = category
      ? uiComponentEntries.filter((entry) => (entry.manifest.tags?.componentTypes ?? []).includes(category))
      : uiComponentEntries;

    emptyState.hidden = filtered.length !== 0;
    $('ui-components-count').textContent = `${filtered.length} component${filtered.length === 1 ? '' : 's'}`;

    const entryByCard = new Map();
    const observer = new IntersectionObserver((observedEntries) => {
      for (const observedEntry of observedEntries) {
        if (!observedEntry.isIntersecting) {
          continue;
        }
        const card = observedEntry.target;
        observer.unobserve(card);
        const entry = entryByCard.get(card);
        void loadUiComponentPreview(card, entry);
      }
    });
    uiComponentsGridObserver = observer;

    for (const entry of filtered) {
      const card = document.createElement('div');
      card.className = 'ui-component-card';
      card.innerHTML = `
        <div class="ui-component-preview-frame">
          <span class="ui-component-preview-loading">Loading preview&hellip;</span>
        </div>
        <div class="ui-component-card-body">
          <div class="name"></div>
          <div class="meta"></div>
        </div>
      `;
      card.querySelector('.name').textContent = entry.manifest.id;
      card.querySelector('.meta').textContent =
        (entry.manifest.tags?.componentTypes ?? []).join(', ') || entry.manifest.kind;
      // Only the card BODY opens Detail, not the whole card -- the preview
      // frame above it gets a real, interactive <iframe> once loaded, and
      // clicks landing inside an iframe (a separate browsing context)
      // don't bubble to a listener on an ancestor element anyway. Keeping
      // the live preview fully interactive (hover states etc. actually
      // working) matters more here than the whole card being one giant
      // click target.
      card.querySelector('.ui-component-card-body').addEventListener('click', () => openDetail(entry));
      container.appendChild(card);

      entryByCard.set(card, entry);
      observer.observe(card);
    }
  }

  /** Fetches the compiled preview for one card and drops it into a
   * sandboxed iframe -- sandbox="allow-scripts" only, deliberately never
   * allow-same-origin (see docs/ui-components-feature-design.md §3: that's
   * what keeps the frame's origin opaque, so a pushed component's own code
   * can never reach window.parent, cookies, or localStorage). A compile
   * failure degrades to a text placeholder, never breaks the whole grid --
   * same "preview fails soft" principle as every other known limitation
   * in this feature. */
  async function loadUiComponentPreview(card, entry) {
    const frame = card.querySelector('.ui-component-preview-frame');
    try {
      const result = await call('preview.compile', { remote: entry.remoteName, id: entry.manifest.id });
      const iframe = document.createElement('iframe');
      iframe.sandbox = 'allow-scripts';
      iframe.srcdoc = result.html;
      frame.innerHTML = '';
      frame.appendChild(iframe);
    } catch (err) {
      frame.innerHTML = '';
      const placeholder = document.createElement('span');
      placeholder.className = 'ui-component-preview-loading';
      placeholder.textContent = 'Preview unavailable';
      frame.appendChild(placeholder);
    }
  }

  function filteredEntries() {
    const search = state.search.trim().toLowerCase();
    const filtered = applyGlobalFilters(state.catalog).filter(
      (entry) => search.length === 0 || matchesSearch(entry, search),
    );
    return sortEntries(filtered);
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

  /** An entry is safe to fold into one bulk "Pull all" click iff a plain,
   * unconfirmed pull is already what its own card would offer one at a time
   * (see actionButtonFor) -- 'not_pulled' or 'update_available'. Deliberately
   * excludes 'edited_locally'/'both_changed': those need their own explicit,
   * per-artifact confirmation (Detail's drift-warning/overwrite flow), never
   * something a bulk action silently steamrolls. */
  function isBulkPullable(entry) {
    const status = displayStatus(entry);
    return status === 'not_pulled' || status === 'update_available';
  }

  /** Shared by both bulk-pull entry points (Tag Folder's own button, and
   * Browse's "Pull all (filtered)" button) -- just updates `btn`'s label/
   * visibility to reflect how many of `entries` are actually pullable right
   * now, leaving the button untouched (not re-labeled to its idle count)
   * while a pull is already in flight on it. */
  function renderPullAllButton(btn, entries) {
    const pullable = entries.filter(isBulkPullable);
    if (pullable.length === 0) {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    if (btn.dataset.idleLabel === undefined || !btn._busyCount) {
      btn.textContent = `Pull all (${pullable.length})`;
      btn.dataset.idleLabel = `Pull all (${pullable.length})`;
    }
  }

  /** Pulls every entry in `pullable` one at a time (never overlapping),
   * driving the shared progress/log panel around the whole batch -- one
   * continuous history for the entire run, not reset between items. Shared
   * by Tag Folder's "Pull all" and Browse's "Pull all (filtered)": both are
   * just "everything currently on screen that's safe to pull with no
   * confirmation" (see isBulkPullable), differing only in which entries
   * that currently is. `onDone` re-renders whatever view-specific list
   * needs a fresh render after `loadCatalog()`'s own refresh (Browse's grid
   * already re-renders as part of loadCatalog; Tag Folder needs its own
   * explicit re-render since it isn't part of Browse). */
  async function bulkPull(pullable, btn, onDone) {
    if (pullable.length === 0) {
      return;
    }
    await withBusy(btn, 'Pulling...', async () => {
      await beginProgress();
      let succeeded = 0;
      const failures = [];
      for (let i = 0; i < pullable.length; i += 1) {
        const entry = pullable[i];
        btn.textContent = `Pulling ${i + 1}/${pullable.length}: ${entry.manifest.id}`;
        try {
          await call('artifact.pull', {
            id: entry.manifest.id,
            remote: entry.remoteName,
            cwd: state.projectDir,
          });
          succeeded += 1;
        } catch (err) {
          failures.push(`${entry.manifest.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      endProgress(failures.length === 0);

      if (succeeded > 0) {
        toastSuccess(`Pulled ${succeeded} artifact${succeeded === 1 ? '' : 's'}`);
      }
      for (const failure of failures) {
        toastError(new Error(failure));
      }
      await loadCatalog();
      onDone?.();
    });
  }

  function renderTagFolderPullAllButton(entries) {
    renderPullAllButton($('tag-folder-pull-all-btn'), entries);
  }

  async function handleTagFolderPullAll() {
    const btn = $('tag-folder-pull-all-btn');
    const pullable = filteredTagFolderEntries().filter(isBulkPullable);
    await bulkPull(pullable, btn, () => renderTagFolder());
  }

  /** Browse's own bulk action, generalizing the same capability Tag Folder
   * already had to the plain artifact grid: pulls everything currently
   * matching the active Kind selection + search box, not just a tag
   * folder's contents. */
  function renderBrowsePullAllButton() {
    const btn = $('browse-pull-all-btn');
    renderPullAllButton(btn, filteredEntries());
  }

  async function handleBrowsePullAll() {
    const btn = $('browse-pull-all-btn');
    const pullable = filteredEntries().filter(isBulkPullable);
    await bulkPull(pullable, btn);
  }

  /** Every entry in the catalog carrying `category:value` (e.g.
   * 'stacks','python') -- the actual feature requested: find every
   * python-tagged artifact, regardless of kind/remote, ignoring whatever
   * Kind chip/search happens to be active in Browse (this is its own page,
   * not a filter layered on top of Browse's grid). Case-insensitive for the
   * same reason renderTagsPageList dedupes case-insensitively -- "python"
   * and "Python" are the same folder, not two. */
  function entriesForTag(category, value) {
    const target = value.toLowerCase();
    return state.catalog.filter((entry) =>
      (entry.manifest.tags?.[category] ?? []).some((v) => v.toLowerCase() === target),
    );
  }

  /** entriesForTag's results, further narrowed by the (global) active Kind
   * selection, this folder's own search box, and sorted the same way
   * Browse's grid is -- the single source of truth both renderTagFolder and
   * the Tag Folder's own "Pull all" button use, so the button's count
   * always matches what's actually on screen. */
  function filteredTagFolderEntries() {
    const base = applyGlobalFilters(entriesForTag(state.activeTagCategory, state.activeTagValue));
    const search = state.tagFolderSearch.trim().toLowerCase();
    const filtered = search.length === 0 ? base : base.filter((entry) => matchesSearch(entry, search));
    return sortEntries(filtered);
  }

  function openTagFolder(category, value) {
    state.activeTagCategory = category;
    state.activeTagValue = value;
    state.tagFolderSearch = '';
    $('tag-folder-search').value = '';
    resetProgressPanel();
    renderTagFolder();
    showViewRaw('tag-folder');
  }

  /** Grouped-by-kind results for the active tag folder -- one section per
   * kind ("skill", "agent", ...) with each artifact as a row carrying its
   * own inline action button (Pull/Push/Update), so acting on one doesn't
   * require opening Detail first. Reuses `runArtifactAction` unchanged --
   * it only ever needed a button element and an entry, never anything
   * Detail-specific -- so the shared progress/log panel (moved out to be
   * page-level, see index.html) lights up here exactly the same way it
   * does from Detail. Clicking a row (not its button) opens the existing,
   * unchanged Detail view. */
  function renderTagFolder() {
    const allEntries = entriesForTag(state.activeTagCategory, state.activeTagValue);
    const entries = filteredTagFolderEntries();
    $('tag-folder-title').textContent =
      `${TAG_CATEGORY_LABEL[state.activeTagCategory]}: ${state.activeTagValue} (${allEntries.length})`;
    renderTagFolderPullAllButton(entries);

    const container = $('tag-folder-results');
    container.innerHTML = '';
    $('tag-folder-empty').hidden = entries.length !== 0;

    const byKind = new Map();
    for (const entry of entries) {
      const kind = entry.manifest.kind;
      if (!byKind.has(kind)) {
        byKind.set(kind, []);
      }
      byKind.get(kind).push(entry);
    }

    for (const kind of Array.from(byKind.keys()).sort()) {
      const group = byKind.get(kind);

      const groupEl = document.createElement('div');
      groupEl.className = 'kind-group';
      groupEl.innerHTML = `
        <div class="kind-group-header">${escapeHtml(kind)} <span class="count">(${group.length})</span></div>
      `;

      const list = document.createElement('div');
      list.className = 'kind-group-list';

      for (const entry of group) {
        const status = displayStatus(entry);
        const row = document.createElement('div');
        row.className = 'kind-group-row';
        row.innerHTML = `
          ${kindSwatchHtml(entry.manifest.kind, 'sm')}
          <div class="row-main">
            <span class="name">${escapeHtml(entry.manifest.id)}</span>
            <span class="badge ${status}">${STATUS_LABELS[status]}</span>
            <span class="summary">${escapeHtml(entry.manifest.description)}</span>
          </div>
        `;
        row.addEventListener('click', () => openDetail(entry));

        const action = actionButtonFor(entry);
        if (action) {
          const btn = document.createElement('button');
          btn.className = 'btn btn-sm';
          btn.textContent = action.label;
          btn.addEventListener('click', (ev) => {
            ev.stopPropagation(); // don't also trigger the row's openDetail
            void runArtifactAction(entry, action.action, btn);
          });
          row.appendChild(btn);
        }

        list.appendChild(row);
      }

      groupEl.appendChild(list);
      container.appendChild(groupEl);
    }
  }

  function renderCards() {
    const grid = $('card-grid');
    renderBrowsePullAllButton();

    const entries = filteredEntries();
    grid.innerHTML = '';
    $('browse-empty').hidden = entries.length !== 0;
    $('browse-empty').textContent =
      state.search.trim() || state.activeKinds.size > 0
        ? 'No artifacts match the current filters.'
        : 'No artifacts match.';

    for (const entry of entries) {
      const card = document.createElement('div');
      card.className = 'res-card';

      const status = displayStatus(entry);
      card.innerHTML = `
        <div class="row1">
          ${kindSwatchHtml(entry.manifest.kind)}
          <div>
            <div class="name"></div>
            <div class="kind-label"></div>
          </div>
        </div>
        <div class="summary"></div>
        <div class="row2">
          <span class="meta"></span>
          <span class="badge ${status}"></span>
        </div>
      `;
      card.querySelector('.name').textContent = entry.manifest.id;
      card.querySelector('.kind-label').textContent = entry.manifest.kind;
      card.querySelector('.summary').textContent = entry.manifest.description;
      card.querySelector('.meta').textContent = `v${entry.manifest.version} · ${entry.manifest.owner}`;
      card.querySelector('.badge').textContent = STATUS_LABELS[status];

      // The whole card is the click target now -- Pull/Push moved into
      // Detail, so there's no inner action button to carve out a
      // stopPropagation() exception for anymore.
      card.addEventListener('click', () => openDetail(entry));

      grid.appendChild(card);
    }
  }

  /** Runs `action` ('pull' or 'push') for `entry`, driving the shared
   * progress/log panel (see beginProgress/endProgress) around the call.
   * The single call site for both actions everywhere they can be
   * triggered one-at-a-time: Detail's action button, and a row's own
   * inline button inside a Tag Folder view. */
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

  /** "Check push status" button handler (Detail view, shown only when the
   * selected entry has a pendingPr): asks the engine to check every
   * pending-push PR's real GitHub state and resync anything that got
   * merged, then merges the result back into state.catalog and reports
   * what happened for THIS entry specifically via toast. Uses the same
   * progress-panel plumbing as a normal pull/push, since this can be a
   * real network call. */
  async function handleCheckPushStatus(entry) {
    const btn = $('detail-check-push-status-btn');
    await withBusy(btn, 'Checking...', async () => {
      await beginProgress();
      try {
        const results = await call('sync.resolvePendingPushes', { cwd: state.projectDir });
        endProgress(true);

        // A merge resyncs the pristine snapshot server-side, which changes
        // what localStatus should be (edited_locally -> pulled) -- that can
        // only be recomputed by re-running catalog.list (it's derived from
        // files on disk, not something to fake client-side), so do a full,
        // cheap (local-only, no network) catalog refresh whenever anything
        // merged. A closed-without-merge result only needs pendingPr
        // cleared, which is safe to patch in client-side.
        const anyMerged = results.some((r) => r.merged);
        if (anyMerged) {
          await loadCatalog();
        } else {
          for (const result of results) {
            const match = state.catalog.find(
              (e) => e.manifest.id === result.id && e.remoteName === result.remote,
            );
            if (match && result.state === 'closed') {
              match.pendingPr = undefined;
            }
          }
          renderCards();
        }

        const mine = results.find(
          (r) => r.id === entry.manifest.id && r.remote === entry.remoteName,
        );
        if (mine) {
          if (mine.merged) {
            toastSuccess(`PR #${mine.prNumber} was merged — status updated to Pulled.`);
          } else if (mine.state === 'closed') {
            toastError(new Error(`PR #${mine.prNumber} was closed without merging.`));
          } else {
            toastSuccess(`PR #${mine.prNumber} is still open.`);
          }
        } else {
          toastSuccess('No pending push found for this artifact.');
        }
        refreshDetailIfShown(entry);
      } catch (err) {
        endProgress(false);
        toastError(err);
      }
    });
  }

  /** Detail's Edit form submit handler: pushes a metadata-only edit
   * (description/roles/teams/stacks), never touching the artifact's
   * payload/content at all. Uses the same shared progress panel and
   * post-push refresh pattern as runArtifactAction/handleCheckPushStatus --
   * a merged/still-open PR from this shows up via the same pendingPr/"Check
   * push status" transparency a payload edit push already gets, since the
   * engine's pushArtifact records pendingPr for this mode too. */
  async function handleSaveMetadataEdit(entry, metadataEdit) {
    const saveBtn = $('edit-save-btn');
    await withBusy(saveBtn, 'Saving...', async () => {
      await beginProgress();
      try {
        const result = await call('artifact.push', {
          id: entry.manifest.id,
          cwd: state.projectDir,
          options: { metadataEdit },
        });
        endProgress(true);
        toastSuccess(`Updated ${entry.manifest.id} metadata: opened PR #${result.number} (${result.url})`);
        $('detail-edit-form').hidden = true;
        await loadCatalog();
        refreshDetailIfShown(entry);
      } catch (err) {
        endProgress(false);
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
    for (const btn of document.querySelectorAll('.sidebar-item')) {
      btn.classList.toggle('active', btn.dataset.view === view);
    }
  }

  function renderDetail(entry) {
    const { manifest } = entry;
    const status = displayStatus(entry);
    const kindIcon = kindIconParts(manifest.kind);
    const kindIconEl = $('detail-kind-icon');
    kindIconEl.style.background = kindIcon.bg;
    kindIconEl.style.color = kindIcon.fg;
    kindIconEl.innerHTML = `<svg><use href="#${kindIcon.icon}"/></svg>`;
    $('detail-kind').textContent = manifest.kind;
    $('detail-name').textContent = manifest.id;
    $('detail-badge').textContent = STATUS_LABELS[status];
    $('detail-badge').className = `badge ${status}`;
    $('detail-description').textContent = manifest.description;
    $('meta-kind').textContent = manifest.kind;
    $('meta-version').textContent = manifest.version;
    $('meta-owner').textContent = manifest.owner;
    $('meta-refresh').textContent = manifest.refresh || '—';

    const tags = manifest.tags || { roles: [], teams: [], stacks: [], componentTypes: [] };
    const pills = [
      ...(tags.roles || []),
      ...(tags.teams || []),
      ...(tags.stacks || []).map((s) => `stack: ${s}`),
      ...(tags.componentTypes || []).map((c) => `component: ${c}`),
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

    // Edit: description/roles/teams/stacks only, never the payload -- needs
    // an existing lockfile entry (metadataEdit push mode requires the
    // artifact already be tracked), same constraint as Open folder above.
    // Collapsed on every (re-)render regardless of prior state -- opening it
    // is always an explicit click, never carried over from a stale render.
    const editBtn = $('detail-edit-btn');
    const editForm = $('detail-edit-form');
    editForm.hidden = true;
    if (entry.localStatus !== 'not_pulled') {
      editBtn.hidden = false;
      editBtn.onclick = () => {
        $('edit-description').value = manifest.description;
        editRolesPicker.setValues(tags.roles || []);
        editTeamsPicker.setValues(tags.teams || []);
        editStacksPicker.setValues(tags.stacks || []);
        editComponentTypesPicker.setValues(tags.componentTypes || []);
        editForm.hidden = false;
      };
    } else {
      editBtn.hidden = true;
      editBtn.onclick = null;
    }
    editForm.onsubmit = (ev) => {
      ev.preventDefault();
      void handleSaveMetadataEdit(entry, {
        description: $('edit-description').value.trim(),
        roles: editRolesPicker.getValues(),
        teams: editTeamsPicker.getValues(),
        stacks: editStacksPicker.getValues(),
        componentTypes: editComponentTypesPicker.getValues(),
      });
    };
    $('edit-cancel-btn').onclick = () => {
      editForm.hidden = true;
    };

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

    // 'both_changed' gets no default one-click action button above (pulling
    // there would silently discard a local edit). 'edited_locally' DOES get
    // a default action (Push), but that's only useful if you actually want
    // to propose the edit -- there was previously no way to instead say
    // "discard this and re-sync," even when that's exactly what's needed
    // (e.g. this exact edit was already pushed and merged some other way,
    // and the local pristine snapshot is just stale). Both states show the
    // same confirm-gated "discard and re-sync" escape hatch; only the
    // wording differs, since 'edited_locally' isn't necessarily "wrong,"
    // just possibly no longer what you want tracked as a pending edit.
    const driftWarning = $('detail-drift-warning');
    const driftWarningText = $('detail-drift-warning-text');
    const overwriteBtn = $('detail-overwrite-btn');
    if (status === 'both_changed' || status === 'edited_locally') {
      driftWarning.hidden = false;
      driftWarningText.textContent =
        status === 'both_changed'
          ? 'This artifact has been edited locally AND updated upstream. Pulling now would '
            + 'normally overwrite your local edits, so no default action is offered above.'
          : 'If this local edit is already accounted for elsewhere (e.g. it was pushed and '
            + 'merged, or you no longer want to keep it), you can discard it and re-sync to '
            + 'exactly what\'s currently on the remote.';
      overwriteBtn.textContent =
        status === 'both_changed'
          ? 'Overwrite with upstream (discards your local edits)'
          : 'Discard local edit and re-sync';
      overwriteBtn.onclick = () => {
        if (
          window.confirm(
            'This will discard your local edits to ' +
              entry.manifest.id +
              ' and replace them with the current upstream version. Continue?',
          )
        ) {
          void runArtifactAction(entry, 'pull', overwriteBtn).then(() => refreshDetailIfShown(entry));
        }
      };
    } else {
      driftWarning.hidden = true;
      overwriteBtn.onclick = null;
    }

    // Transparency for a previously-pushed edit: pushing a PR doesn't
    // change local status on its own, so without this there'd be no way to
    // ever learn whether that push was merged, rejected, or is still open.
    const pushStatusBlock = $('detail-push-status');
    const pushStatusText = $('detail-push-status-text');
    const checkPushBtn = $('detail-check-push-status-btn');
    if (entry.pendingPr) {
      pushStatusBlock.hidden = false;
      pushStatusText.textContent =
        `Pushed — PR #${entry.pendingPr.number} (${entry.pendingPr.url}) `
        + `is still open, as far as DeliveryOS knows.`;
      checkPushBtn.onclick = () => void handleCheckPushStatus(entry);
    } else {
      pushStatusBlock.hidden = true;
      checkPushBtn.onclick = null;
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

  // ---------- tag picker (roles/stacks/teams input, Add New + Edit) ----------

  /** A simple multi-value "chip" picker replacing a raw comma-separated
   * text field: already-added values render as removable pills, and
   * existing values used elsewhere in the catalog render as visible,
   * clickable suggestion chips below the input -- not a native <datalist>
   * popup, which only a browser's own hidden autocomplete UI surfaces (the
   * same "doesn't match the rest of the app, hides every option behind a
   * click" problem native <select>s have) and matches the app's own chip
   * visual language everywhere else instead. Typing a brand-new value and
   * pressing Enter/comma still works the same way (tags stay free-text by
   * design). `container` is an otherwise-empty element this takes over
   * entirely. Values are trimmed+lowercased on commit -- the same
   * canonicalization the old raw comma-text fields used to apply, so e.g.
   * "Python" still lands in the same "stack: python" folder as everything
   * else instead of a separate, near-duplicate one. */
  function createTagPicker(container) {
    container.classList.add('tag-picker-wrap');
    container.innerHTML = `
      <div class="tag-picker">
        <span class="tag-picker-chips"></span>
        <input class="tag-picker-input" type="text" placeholder="Type, then Enter or comma&hellip;" />
      </div>
      <div class="tag-picker-suggestions"></div>
    `;
    const chipsEl = container.querySelector('.tag-picker-chips');
    const inputEl = container.querySelector('.tag-picker-input');
    const suggestionsEl = container.querySelector('.tag-picker-suggestions');
    let values = [];
    let suggestions = [];

    function renderTagPickerChips() {
      chipsEl.innerHTML = '';
      for (const value of values) {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.innerHTML =
          '<span class="tag-chip-label"></span>'
          + '<button type="button" class="tag-chip-remove" aria-label="Remove">&times;</button>';
        chip.querySelector('.tag-chip-label').textContent = value;
        chip.querySelector('.tag-chip-remove').addEventListener('click', () => {
          values = values.filter((v) => v !== value);
          renderTagPickerChips();
          renderSuggestions();
        });
        chipsEl.appendChild(chip);
      }
    }

    /** Every known suggestion not already added -- clicking one commits it
     * exactly like typing it and pressing Enter would. */
    function renderSuggestions() {
      suggestionsEl.innerHTML = '';
      const available = suggestions.filter((s) => !values.includes(s));
      for (const value of available) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip tag-picker-suggestion';
        chip.textContent = value;
        chip.addEventListener('click', () => commit(value));
        suggestionsEl.appendChild(chip);
      }
    }

    function commit(raw) {
      const value = raw.trim().toLowerCase();
      inputEl.value = '';
      if (value.length === 0 || values.includes(value)) {
        return;
      }
      values.push(value);
      renderTagPickerChips();
      renderSuggestions();
    }

    inputEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ',') {
        ev.preventDefault();
        commit(inputEl.value);
      } else if (ev.key === 'Backspace' && inputEl.value.length === 0 && values.length > 0) {
        values = values.slice(0, -1);
        renderTagPickerChips();
        renderSuggestions();
      }
    });
    // Committing on blur too -- otherwise text typed but not confirmed with
    // Enter/comma would silently vanish if the user just clicks elsewhere
    // (e.g. straight into Save/Propose).
    inputEl.addEventListener('blur', () => {
      if (inputEl.value.trim().length > 0) {
        commit(inputEl.value);
      }
    });

    return {
      getValues: () => [...values],
      setValues(next) {
        values = [...next];
        renderTagPickerChips();
        renderSuggestions();
      },
      setSuggestions(list) {
        suggestions = list;
        renderSuggestions();
      },
    };
  }

  /** Every distinct value (lowercased, matching how tags are stored) a
   * given tags category has across the whole loaded catalog -- the
   * suggestion source for that category's tag picker(s). */
  function distinctTagValues(category) {
    return Array.from(
      new Set(state.catalog.flatMap((e) => e.manifest.tags?.[category] ?? []).map((v) => v.toLowerCase())),
    ).sort();
  }

  let addNewRolesPicker, addNewStacksPicker, addNewTeamsPicker, addNewComponentTypesPicker;
  let editRolesPicker, editStacksPicker, editTeamsPicker, editComponentTypesPicker;

  /** Builds all 8 tag pickers once, at startup -- their containers are
   * static elements already in index.html, never re-created, so this only
   * ever runs once per app session. */
  function initTagPickers() {
    addNewRolesPicker = createTagPicker($('f-roles-picker'));
    addNewStacksPicker = createTagPicker($('f-stacks-picker'));
    addNewTeamsPicker = createTagPicker($('f-teams-picker'));
    addNewComponentTypesPicker = createTagPicker($('f-component-types-picker'));
    editRolesPicker = createTagPicker($('edit-roles-picker'));
    editStacksPicker = createTagPicker($('edit-stacks-picker'));
    editTeamsPicker = createTagPicker($('edit-teams-picker'));
    editComponentTypesPicker = createTagPicker($('edit-component-types-picker'));

    addNewKindPicker = createSingleChipPicker($('f-kind-picker'));
    addNewKindPicker.onChange((value) => {
      $('f-kind-custom').hidden = value !== NEW_KIND_OPTION;
      if (!$('f-kind-custom').hidden) {
        $('f-kind-custom').focus();
      }
    });
    addNewRemotePicker = createSingleChipPicker($('f-remote-picker'));
  }

  /** Refreshes every tag picker's suggestion list from the current catalog
   * -- called whenever state.catalog changes (loadCatalog), so newly
   * pulled/proposed tags show up as suggestions without needing the app
   * restarted. */
  function refreshTagPickerSuggestions() {
    const roles = distinctTagValues('roles');
    const stacks = distinctTagValues('stacks');
    const teams = distinctTagValues('teams');
    addNewRolesPicker.setSuggestions(roles);
    addNewStacksPicker.setSuggestions(stacks);
    addNewTeamsPicker.setSuggestions(teams);
    const componentTypes = distinctTagValues('componentTypes');
    addNewComponentTypesPicker.setSuggestions(componentTypes);
    editRolesPicker.setSuggestions(roles);
    editStacksPicker.setSuggestions(stacks);
    editTeamsPicker.setSuggestions(teams);
    editComponentTypesPicker.setSuggestions(componentTypes);
  }

  // ---------- single-select chip picker (Kind, Remote) ----------

  /** A single-select equivalent of createTagPicker, styled as clickable
   * `.chip` buttons (the same look Browse's own Kind filter uses) instead
   * of a native <select> -- for low-cardinality fields where seeing every
   * option at a glance beats hiding them behind a dropdown. `container`
   * is taken over entirely. */
  function createSingleChipPicker(container) {
    container.classList.add('chip-picker');
    let options = []; // { value, label }[]
    let selected = null;
    let onChangeCb = null;

    function render() {
      container.innerHTML = '';
      for (const opt of options) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `chip ${selected === opt.value ? 'active' : ''}`;
        chip.textContent = opt.label;
        chip.addEventListener('click', () => {
          selected = opt.value;
          render();
          onChangeCb?.(selected);
        });
        container.appendChild(chip);
      }
    }

    return {
      setOptions(nextOptions, fallbackSelected) {
        options = nextOptions;
        if (!options.some((opt) => opt.value === selected)) {
          selected = fallbackSelected ?? options[0]?.value ?? null;
        }
        render();
      },
      /** Selects `value`, adding it as a real option first if it isn't one
       * already (e.g. a Scan candidate's kind that doesn't exist in the
       * currently-loaded catalog yet). `label` defaults to `value` itself. */
      selectValue(value, label) {
        if (!options.some((opt) => opt.value === value)) {
          options = [...options, { value, label: label ?? value }];
        }
        selected = value;
        render();
      },
      getValue: () => selected,
      onChange(cb) {
        onChangeCb = cb;
      },
    };
  }

  // ---------- add new: kind + remote pickers ----------

  const NEW_KIND_OPTION = '__new_kind__';

  let addNewKindPicker, addNewRemotePicker;

  /** (Re)populates Add New's Kind chip-picker from every distinct kind
   * already in the catalog, plus a trailing "+ New kind..." chip -- kind is
   * open-ended by design (see ARCHITECTURE.md), so this is a convenience
   * for the common case (reusing "agent", "skill", ...) that still allows
   * inventing a brand-new one via the custom text input it reveals. */
  function populateKindPicker() {
    const kinds = Array.from(new Set(state.catalog.map((e) => e.manifest.kind))).sort();
    addNewKindPicker.setOptions(
      [...kinds.map((k) => ({ value: k, label: k })), { value: NEW_KIND_OPTION, label: '+ New kind…' }],
      kinds[0] ?? NEW_KIND_OPTION,
    );
    $('f-kind-custom').hidden = addNewKindPicker.getValue() !== NEW_KIND_OPTION;
  }

  /** Resolves Add New's Kind field to a plain string for submission --
   * either the selected existing kind, or whatever was typed into the
   * custom-kind text input when "+ New kind..." is selected. */
  function resolveKindFieldValue() {
    const value = addNewKindPicker.getValue();
    return value === NEW_KIND_OPTION ? $('f-kind-custom').value.trim() : (value ?? '');
  }

  // ---------- add new ----------

  async function loadRemotesForAddNewSelect() {
    try {
      state.remotes = await call('remote.list', {});
    } catch (err) {
      toastError(err);
      state.remotes = [];
    }
    addNewRemotePicker.setOptions(state.remotes.map((r) => ({ value: r.name, label: r.name })));
    $('f-remote-empty-hint').hidden = state.remotes.length !== 0;
  }

  let pendingPayloadPath = null;

  /** Clears every Add New field back to blank -- shared by the plain "+ Add
   * new" entry point (a fresh proposal) and a successful submit (ready for
   * the next one). Deliberately NOT used by openAddNewFromScanCandidate,
   * which resets the same fields but then immediately re-populates several
   * of them from the scan candidate. */
  function resetAddNewForm() {
    $('addnew-form').reset();
    addNewRolesPicker.setValues([]);
    addNewStacksPicker.setValues([]);
    addNewTeamsPicker.setValues([]);
    addNewComponentTypesPicker.setValues([]);
    $('f-kind-custom').value = '';
    pendingPayloadPath = null;
    $('payload-path-display').textContent = 'No file or folder selected';
  }

  // ---------- add new: field helpers ----------
  //
  // This maps a field's logical name to its actual DOM element, purely so
  // submitAddNew's validation can scroll to and focus whichever one is
  // actually blank/invalid instead of just a toast with nothing to click.
  const ADDNEW_FIELD_ELEMENT_ID = {
    id: 'f-id',
    kind: 'f-kind-picker',
    payload: 'pick-payload-file-btn',
    description: 'f-description',
    owner: 'f-owner',
    remote: 'f-remote-picker',
  };

  function focusAddNewField(fieldName) {
    const el = $(ADDNEW_FIELD_ELEMENT_ID[fieldName]);
    if (!el) {
      return;
    }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus();
  }

  // ---------- add new: wizard mode ----------
  //
  // One shared form, two ways to move through it. A step-by-step wizard
  // (one field/group per screen, Next/Back, a final Review step) was tried
  // for every Add New entry point and then reverted -- real feedback was
  // that it felt like too many steps for filling this out by hand from
  // scratch. But Scan's "Review & propose" already knows most of the
  // answers, so stepping through everything just to reach a Review screen
  // that lets you fix any one thing is genuinely useful there. addNewWizardMode
  // picks which behavior renderWizardStep() below produces; direct entry
  // (showView('addnew')) sets it false, openAddNewFromScanCandidate sets it
  // true. Same fields, same DOM, same submitAddNew -- only how much of the
  // form is visible at once differs.
  let addNewWizardMode = false;
  let wizardStepIndex = 0;

  const ADDNEW_STEPS = [
    'id', 'kind', 'payload', 'description', 'owner',
    'roles', 'stacks', 'teams', 'component-types', 'install-target', 'post-install', 'remote',
    'review',
  ];

  const ADDNEW_STEP_LABELS = {
    id: 'Artifact ID',
    kind: 'Kind',
    payload: 'Payload',
    description: 'Description',
    owner: 'Owner',
    roles: 'Who is this for',
    stacks: 'Stack',
    teams: 'Team / project',
    'component-types': 'Component type',
    'install-target': 'Install target',
    'post-install': 'Setup command',
    remote: 'Remote',
    review: 'Review',
  };

  /** Shows/hides .wizard-step elements and the progress bar/nav to match
   * addNewWizardMode + wizardStepIndex. In flat mode every step but Review
   * is visible at once, nav/progress stay hidden, and Propose is always
   * visible -- Review would just be a redundant restatement of a form
   * that's already fully on screen, so it stays hidden even in flat mode.
   * In wizard mode exactly one step is visible, Propose only appears on
   * Review, and Back/Next/Review-jump reflect where wizardStepIndex is. */
  function renderWizardStep() {
    const stepEls = document.querySelectorAll('#addnew-form .wizard-step');
    const currentStep = ADDNEW_STEPS[wizardStepIndex];

    if (!addNewWizardMode) {
      for (const stepEl of stepEls) {
        stepEl.hidden = stepEl.dataset.step === 'review';
      }
      $('addnew-wizard-progress').hidden = true;
      $('addnew-wizard-nav').hidden = true;
      $('addnew-submit-btn').hidden = false;
      return;
    }

    for (const stepEl of stepEls) {
      stepEl.hidden = stepEl.dataset.step !== currentStep;
    }
    $('addnew-wizard-progress').hidden = false;
    $('addnew-wizard-nav').hidden = false;
    $('addnew-submit-btn').hidden = currentStep !== 'review';

    const stepNumber = wizardStepIndex + 1;
    const totalSteps = ADDNEW_STEPS.length;
    $('wizard-progress-label').textContent =
      `Step ${stepNumber} of ${totalSteps}: ${ADDNEW_STEP_LABELS[currentStep]}`;
    $('wizard-progress-bar').style.width = `${(stepNumber / totalSteps) * 100}%`;

    $('wizard-back-btn').hidden = wizardStepIndex === 0;
    $('wizard-next-btn').hidden = currentStep === 'review';
    $('wizard-review-btn').hidden = currentStep === 'review';

    if (currentStep === 'review') {
      renderAddNewReview();
    }
  }

  /** Resets to the first step and re-renders -- doesn't touch
   * addNewWizardMode itself, since the caller (showView vs.
   * openAddNewFromScanCandidate) already set that to whichever mode this
   * visit needs before calling this. */
  function resetWizard() {
    wizardStepIndex = 0;
    renderWizardStep();
  }

  function goToWizardStep(stepName) {
    const index = ADDNEW_STEPS.indexOf(stepName);
    if (index === -1) {
      return;
    }
    wizardStepIndex = index;
    renderWizardStep();
  }

  /** Validates only the field(s) on the current wizard step, same rules
   * submitAddNew enforces for the whole form -- steps with nothing
   * required (roles/stacks/teams/install-target/post-install) always pass,
   * since Next shouldn't block on optional fields. */
  function validateWizardStep() {
    const step = ADDNEW_STEPS[wizardStepIndex];
    if (step === 'id') {
      const id = $('f-id').value.trim();
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
        toastError(new Error(
          `Artifact ID "${id}" must be lowercase letters, numbers, and hyphens only `
          + '(e.g. "growtharc-brand-guidelines"), no spaces.',
        ));
        return false;
      }
    } else if (step === 'kind') {
      if (!resolveKindFieldValue()) {
        toastError(new Error('Enter a kind (or pick an existing one).'));
        return false;
      }
    } else if (step === 'payload') {
      if (!pendingPayloadPath) {
        toastError(new Error('Choose a payload file or folder first.'));
        return false;
      }
    } else if (step === 'description') {
      if (!$('f-description').value.trim()) {
        toastError(new Error('Enter a description.'));
        return false;
      }
    } else if (step === 'owner') {
      if (!$('f-owner').value.trim()) {
        toastError(new Error('Enter an owner.'));
        return false;
      }
    } else if (step === 'remote') {
      if (!addNewRemotePicker.getValue()) {
        toastError(new Error('Register a remote first (Settings), then pick one.'));
        return false;
      }
    }
    return true;
  }

  function wizardGoNext() {
    if (!validateWizardStep()) {
      return;
    }
    if (wizardStepIndex < ADDNEW_STEPS.length - 1) {
      wizardStepIndex += 1;
      renderWizardStep();
    }
  }

  function wizardGoBack() {
    if (wizardStepIndex > 0) {
      wizardStepIndex -= 1;
      renderWizardStep();
    }
  }

  /** Populates the Review step with every field's current value and an
   * Edit button that jumps straight back to that field's own step --
   * rebuilt fresh each time goToWizardStep('review') runs, since any field
   * may have changed since the last visit to Review. */
  function renderAddNewReview() {
    const container = $('addnew-review');
    container.innerHTML = '';

    const rows = [
      ['id', 'Artifact ID', $('f-id').value.trim()],
      ['kind', 'Kind', resolveKindFieldValue()],
      ['payload', 'Payload', pendingPayloadPath || '(none selected)'],
      ['description', 'Description', $('f-description').value.trim()],
      ['owner', 'Owner', $('f-owner').value.trim()],
      ['roles', 'Who is this for', addNewRolesPicker.getValues().join(', ') || '(none)'],
      ['stacks', 'Stack', addNewStacksPicker.getValues().join(', ') || '(none)'],
      ['teams', 'Team / project', addNewTeamsPicker.getValues().join(', ') || '(none)'],
      ['component-types', 'Component type', addNewComponentTypesPicker.getValues().join(', ') || '(none)'],
      ['install-target', 'Install target', $('f-install-target').value.trim() || '(default)'],
      ['post-install', 'Setup command', $('f-post-install').value.trim() || '(none)'],
      ['remote', 'Remote', addNewRemotePicker.getValue() || '(none selected)'],
    ];

    for (const [step, label, value] of rows) {
      const row = document.createElement('div');
      row.className = 'wizard-review-row';
      row.innerHTML = `
        <span class="wizard-review-label"></span>
        <span class="wizard-review-value"></span>
      `;
      row.querySelector('.wizard-review-label').textContent = label;
      row.querySelector('.wizard-review-value').textContent = value;

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-sm btn-ghost';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => goToWizardStep(step));
      row.appendChild(editBtn);

      container.appendChild(row);
    }
  }

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

  async function submitAddNew(ev) {
    ev.preventDefault();
    const submitBtn = $('addnew-submit-btn');

    if (!state.projectDir) {
      toastError(new Error('Select a project folder first.'));
      return;
    }
    if (!pendingPayloadPath) {
      toastError(new Error('Choose a payload file or folder first.'));
      focusAddNewField('payload');
      return;
    }

    const id = $('f-id').value.trim();
    const kind = resolveKindFieldValue();
    const description = $('f-description').value.trim();
    const owner = $('f-owner').value.trim();
    const roles = addNewRolesPicker.getValues();
    const stacks = addNewStacksPicker.getValues();
    const teams = addNewTeamsPicker.getValues();
    const componentTypes = addNewComponentTypesPicker.getValues();
    const remote = addNewRemotePicker.getValue();
    const installTarget = $('f-install-target').value.trim() || undefined;
    const postInstall = $('f-post-install').value.trim() || undefined;

    // The id becomes a git branch name segment during push (see
    // buildBranchName). Spaces/uppercase/punctuation there produced a real
    // crash ("not a valid branch name") -- caught here, before the push even
    // starts, with a message that says why instead of surfacing a raw git
    // error.
    //
    // Kind and Remote are chip-pickers, not native form controls, so
    // there's no browser constraint validation to lean on for those --
    // each failure scrolls to and focuses the actual offending field
    // (focusAddNewField) instead of just a toast with nothing to click.
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
      toastError(new Error(
        `Artifact ID "${id}" must be lowercase letters, numbers, and hyphens only `
        + '(e.g. "growtharc-brand-guidelines"), no spaces.',
      ));
      focusAddNewField('id');
      return;
    }
    if (!kind) {
      toastError(new Error('Enter a kind (or pick an existing one).'));
      focusAddNewField('kind');
      return;
    }
    if (!description) {
      toastError(new Error('Enter a description.'));
      focusAddNewField('description');
      return;
    }
    if (!owner) {
      toastError(new Error('Enter an owner.'));
      focusAddNewField('owner');
      return;
    }
    if (!remote) {
      toastError(new Error('Register a remote first (Settings), then pick one.'));
      focusAddNewField('remote');
      return;
    }

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
            stacks,
            teams,
            componentTypes,
            installTarget,
            postInstall,
          },
        });
        toastSuccess(`Proposed ${id}: opened PR #${result.number} (${result.url})`);
        resetAddNewForm();
        showView('browse');
      } catch (err) {
        toastError(err);
      }
    });
  }

  // ---------- scan ----------

  /** Setup for the Scan view, called from showView('scan') (the sidebar's
   * "Scan" item) -- resets any leftover results/progress from a previous
   * visit, then loads the remote picker. Doesn't run the scan itself yet;
   * that's a separate, explicit "Scan" button click (a remote fetch every
   * time you open this view, even with nothing changed, would be wasted
   * network activity). The actual view-section toggle already happened in
   * showView() before this runs. */
  async function openScanView() {
    resetProgressPanel();
    $('scan-results').innerHTML = '';
    $('scan-empty').hidden = true;
    await loadRemotesForScanSelect();
  }

  /** Populates Scan's own remote <select> the same way Add New's is loaded
   * -- a separate select since the two views are independent entry points
   * (you might scan against a different remote than the one you'd propose
   * a manually-picked payload against). */
  async function loadRemotesForScanSelect() {
    const select = $('scan-remote-select');
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

  function renderScanResults(candidates) {
    const container = $('scan-results');
    container.innerHTML = '';
    $('scan-empty').hidden = candidates.length !== 0;

    const byKind = new Map();
    for (const candidate of candidates) {
      if (!byKind.has(candidate.kind)) {
        byKind.set(candidate.kind, []);
      }
      byKind.get(candidate.kind).push(candidate);
    }

    for (const kind of Array.from(byKind.keys()).sort()) {
      const group = byKind.get(kind);
      const groupEl = document.createElement('div');
      groupEl.className = 'kind-group';
      groupEl.innerHTML = `
        <div class="kind-group-header">${escapeHtml(kind)} <span class="count">(${group.length})</span></div>
      `;

      const list = document.createElement('div');
      list.className = 'kind-group-list';

      for (const candidate of group) {
        const row = document.createElement('div');
        row.className = 'kind-group-row';
        row.innerHTML = `
          ${kindSwatchHtml(candidate.kind, 'sm')}
          <div class="row-main">
            <span class="name"></span>
            <span class="summary">
              <span class="summary-text"></span>
            </span>
          </div>
        `;
        row.querySelector('.name').textContent = candidate.id;
        row.querySelector('.summary-text').textContent =
          candidate.description || '(no description found -- add one on the next screen)';

        const btn = document.createElement('button');
        btn.className = 'btn btn-sm';
        btn.textContent = 'Review & propose';
        btn.addEventListener('click', () => {
          void openAddNewFromScanCandidate(candidate, $('scan-remote-select').value);
        });
        row.appendChild(btn);

        list.appendChild(row);
      }

      groupEl.appendChild(list);
      container.appendChild(groupEl);
    }
  }

  async function handleRunScan() {
    if (!state.projectDir) {
      toastError(new Error('Select a project folder first.'));
      return;
    }
    const remote = $('scan-remote-select').value;
    if (!remote) {
      toastError(new Error('Register a remote first (Settings).'));
      return;
    }

    const btn = $('scan-run-btn');
    await withBusy(btn, 'Scanning...', async () => {
      await beginProgress();
      try {
        const candidates = await call('scan.run', { cwd: state.projectDir, remote });
        endProgress(true);
        renderScanResults(candidates);
      } catch (err) {
        endProgress(false);
        toastError(err);
      }
    });
  }

  /** Navigates to Add New with id/kind/description/payload pre-filled from
   * a scan candidate -- roles/teams/stacks are deliberately left blank for
   * review (see scanForNewArtifacts's own doc comment for why), same as
   * every other Add New field remains fully editable before Propose. Uses
   * showViewRaw (not showView) so this can await the remote <select>
   * populating BEFORE setting its value -- showView's own fire-and-forget
   * load would otherwise race, leaving the select on its default option. */
  async function openAddNewFromScanCandidate(candidate, remoteName) {
    resetProgressPanel();
    showViewRaw('addnew');
    resetAddNewForm();
    populateKindPicker();
    // Turn wizard mode on and synchronously collapse to just the first
    // step, same as a fresh visit would -- without this, `#view-addnew`
    // becomes visible right above still in flat mode (or with every
    // .wizard-step still unhidden from a previous visit), and the `await`
    // below would leave that fully-stacked view flashing on screen until
    // goToWizardStep('review') finally runs.
    addNewWizardMode = true;
    resetWizard();
    await loadRemotesForAddNewSelect();

    $('f-id').value = candidate.id;
    addNewKindPicker.selectValue(candidate.kind);
    $('f-description').value = candidate.description ?? '';
    $('f-install-target').value = candidate.installTarget;
    addNewRemotePicker.selectValue(remoteName);

    pendingPayloadPath = candidate.payloadPath;
    $('payload-path-display').textContent = candidate.payloadPath;
    // Jump straight to Review -- everything a scan candidate can prefill is
    // already filled in (roles/stacks/teams are deliberately left blank for
    // manual review, same as before), so forcing a click through 9 empty-
    // looking steps just to reach Propose would be worse than the old flat
    // form, not better. The Edit button on any review row still jumps back
    // to fill in something more, roles/stacks/teams included.
    goToWizardStep('review');
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
    list.innerHTML = '';
    if (state.remotes.length === 0) {
      list.innerHTML = '<p class="empty-state">No remotes registered yet.</p>';
      return;
    }
    for (const remote of state.remotes) {
      const row = document.createElement('div');
      row.className = 'settings-row';
      row.innerHTML = `
        <div>
          <div class="n"></div>
          <div class="s"></div>
        </div>
      `;
      row.querySelector('.n').textContent = remote.name;
      row.querySelector('.s').textContent = `${remote.url} · added ${remote.addedAt}`;

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn-sm btn-danger-ghost';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => void handleRemoveRemote(remote, deleteBtn));
      row.appendChild(deleteBtn);

      list.appendChild(row);
    }
  }

  /** Unregisters a remote and deletes its local cache clone. Doesn't touch
   * any project's lockfile/pulled files -- those stay on disk exactly as
   * pulled; only the ability to pull/push against this remote again (until
   * it's re-added) goes away. Confirm-gated since re-adding means a fresh
   * clone, not an instant undo. */
  async function handleRemoveRemote(remote, button) {
    if (
      !window.confirm(
        `Remove remote "${remote.name}"? This deletes its local cache clone. `
        + `Any artifacts already pulled from it stay exactly as they are -- `
        + `you just won't be able to pull/push against it again until you re-add it.`,
      )
    ) {
      return;
    }
    await withBusy(button, 'Removing...', async () => {
      try {
        await call('remote.remove', { name: remote.name });
        toastSuccess(`Removed remote "${remote.name}"`);
        await loadRemotesForSettings();
      } catch (err) {
        toastError(err);
      }
    });
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
    // Every element carrying a data-view -- the sidebar's own nav items,
    // plus every "← Back to ..." button scattered across the other views
    // -- is wired the same way: click it, show that view. showView()
    // itself is what actually decides which sidebar item ends up
    // highlighted active, regardless of which element triggered it.
    for (const btn of document.querySelectorAll('[data-view]')) {
      btn.addEventListener('click', () => showView(btn.dataset.view));
    }

    $('change-folder-btn').addEventListener('click', () => void changeFolder());
    $('refresh-btn').addEventListener('click', () => void refreshCatalogFromRemotes());
    $('check-artifact-updates-btn').addEventListener('click', () => void handleCheckForArtifactUpdates());
    $('add-new-btn').addEventListener('click', () => showView('addnew'));
    $('scan-run-btn').addEventListener('click', () => void handleRunScan());
    $('browse-pull-all-btn').addEventListener('click', () => void handleBrowsePullAll());
    $('tag-folder-pull-all-btn').addEventListener('click', () => void handleTagFolderPullAll());
    $('back-to-browse-btn').addEventListener('click', () => showView('browse'));

    $('search-input').addEventListener('input', (ev) => {
      state.search = ev.target.value;
      renderCards();
    });
    $('sort-select').addEventListener('change', (ev) => {
      state.sortBy = ev.target.value;
      renderCards();
      if (state.view === 'tag-folder') {
        renderTagFolder();
      }
    });
    $('remote-filter-select').addEventListener('change', (ev) => {
      state.activeRemote = ev.target.value;
      renderCards();
      if (state.view === 'tag-folder') {
        renderTagFolder();
      } else if (state.view === 'tags') {
        renderTagsPageList();
      }
    });
    $('tags-value-search').addEventListener('input', (ev) => {
      state.tagValueSearch = ev.target.value;
      renderTagsPageList();
    });
    $('tag-folder-search').addEventListener('input', (ev) => {
      state.tagFolderSearch = ev.target.value;
      renderTagFolder();
    });

    $('addnew-form').addEventListener('submit', (ev) => void submitAddNew(ev));
    $('pick-payload-file-btn').addEventListener('click', () => void pickPayload(false));
    $('pick-payload-dir-btn').addEventListener('click', () => void pickPayload(true));

    $('wizard-next-btn').addEventListener('click', () => wizardGoNext());
    $('wizard-back-btn').addEventListener('click', () => wizardGoBack());
    $('wizard-review-btn').addEventListener('click', () => goToWizardStep('review'));
    // Enter anywhere in the form advances to the next step instead of
    // submitting early -- except inside a tag picker's own text input,
    // where Enter already means "commit this chip, keep typing the next
    // one" (see createTagPicker), and except on the Review step, where
    // Enter doing nothing is safer than accidentally proposing something.
    $('addnew-form').addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') {
        return;
      }
      if (ev.target.classList.contains('tag-picker-input') || ev.target.tagName === 'TEXTAREA') {
        return;
      }
      if (ADDNEW_STEPS[wizardStepIndex] === 'review') {
        return;
      }
      ev.preventDefault();
      wizardGoNext();
    });

    $('remote-form').addEventListener('submit', (ev) => void submitAddRemote(ev));

    $('check-updates-btn').addEventListener('click', () => void handleCheckForUpdates());
  }

  async function init() {
    initTagPickers();
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
    refreshTagPickerSuggestions();
    showViewRaw('browse');
  }

  window.addEventListener('DOMContentLoaded', () => {
    void init();
  });
})();
