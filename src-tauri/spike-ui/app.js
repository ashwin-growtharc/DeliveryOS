// DeliveryOS desktop UI: vanilla JS, single-page, no framework/build step.
// State + view-switching + render functions for Browse / Detail / Add-new /
// Settings. Every engine call goes through `DeliveryOS.call` (sidecar.js),
// which spawns a fresh sidecar process per call -- so every button that
// triggers one is disabled with a "Working..." label for the duration.
(function () {
  const call = window.DeliveryOS.call;
  const { open: openDialog } = window.__TAURI__.dialog;
  const { revealItemInDir, openUrl } = window.__TAURI__.opener;
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
    // Which view Detail was opened FROM ('browse' | 'tag-folder' |
    // 'ui-components') -- captured once, right before switching to Detail
    // (see openDetail), so its own Back button can return to that exact
    // place instead of always Browse. A real, confirmed UX complaint: this
    // used to be hardcoded, so opening Detail from a Tag Folder or the UI
    // Components list and clicking Back always dumped to the plain Browse
    // grid, discarding the actual entry context -- exactly the same class
    // of bug Tag Folder's OWN back button already avoids (it correctly
    // returns to 'tags', not 'browse').
    detailReturnView: null,
    remotes: [],
    // Last real scan.run result, cached so returnToScan can restore the
    // rest of a batch (minus whichever candidate was just proposed, if
    // any) after Add New's wizard finishes, without a second real
    // network scan just to keep reviewing the others.
    lastScanCandidates: [],
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

  /** `linkUrl`, if given, adds a real clickable action to the toast --
   * opened via the opener plugin's `openUrl` (`window.__TAURI__.opener`),
   * NOT a plain `<a href target="_blank">`: inside a Tauri webview, a
   * bare anchor tag has no reliable way to hand off to the system's
   * default browser, which is why every other place this app opens
   * something external (`revealItemInDir` for "Open folder") already goes
   * through this same plugin rather than raw DOM navigation. A toast
   * carrying a link stays up longer (12s vs. the plain 5s) -- long enough
   * to actually read and click, not just glimpse before it vanishes. */
  function showToast(kind, message, linkUrl, linkLabel) {
    const stack = $('toast-stack');
    const toast = document.createElement('div');
    toast.className = `toast ${kind}`;
    toast.innerHTML = `<span class="dot"></span><span class="toast-body"><span class="msg"></span></span>`;
    toast.querySelector('.msg').textContent = message;
    if (linkUrl) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'toast-link';
      link.textContent = linkLabel ?? 'View PR →';
      link.addEventListener('click', () => {
        void openUrl(linkUrl);
      });
      toast.querySelector('.toast-body').appendChild(link);
    }
    stack.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, linkUrl ? 12000 : 5000);
  }

  function toastSuccess(message, linkUrl, linkLabel) {
    showToast('success', message, linkUrl, linkLabel);
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
      $('addnew-top-back-btn').textContent = '← Back to Browse';
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

    renderUiComponentsList(uiComponentEntries);
    renderUiComponentsPullAllButton();
  }

  /** UI Components' own bulk action -- the one real gap this page had
   * relative to Browse and Tag Folder (both already had a "Pull all"),
   * confirmed by a UX pass through the app. Recomputes the same
   * kind+remote+category filtering `renderUiComponentsPage`/
   * `renderUiComponentsList` already do inline, rather than sharing their
   * exact code path, so this stays a pure addition with zero risk to the
   * already-working list rendering. */
  function visibleUiComponentEntries() {
    const byKindAndRemote = applyRemoteFilter(
      state.catalog.filter((entry) => entry.manifest.kind === 'ui-component'),
    );
    const category = state.uiComponentsPageCategory;
    return category
      ? byKindAndRemote.filter((entry) => (entry.manifest.tags?.componentTypes ?? []).includes(category))
      : byKindAndRemote;
  }

  function renderUiComponentsPullAllButton() {
    renderPullAllButton($('ui-components-pull-all-btn'), visibleUiComponentEntries());
  }

  async function handleUiComponentsPullAll() {
    const btn = $('ui-components-pull-all-btn');
    const pullable = visibleUiComponentEntries().filter(isBulkPullable);
    await bulkPull(pullable, btn, () => renderUiComponentsPage());
  }

  /** The active category's rows, each a live sandboxed-iframe preview.
   * Lazy-rendered via IntersectionObserver -- a list of many components
   * shouldn't eagerly call preview.compile for every single one the
   * moment the page opens, only the ones actually scrolled into view. */
  /** Clamps a component-reported content height to a sane range -- a
   * pushed component's own bug (or just an extreme layout) shouldn't be
   * able to blow up the surrounding page by reporting an absurd height;
   * MIN keeps a near-empty component from collapsing to nothing. */
  function clampPreviewHeight(height) {
    const MIN = 80;
    const MAX = 640;
    return Math.min(Math.max(height, MIN), MAX);
  }

  /** Same idea as clampPreviewHeight, for width -- a component whose real
   * content is genuinely narrower than the row's full column (e.g. a
   * fixed-width themed box, not just "a Button" but a whole styled panel
   * around some short text) should get a frame that hugs ITS real width,
   * not a fixed 720px box with dead space camouflaged on both sides by
   * the frame's own background color. MIN keeps a tiny/near-empty
   * component (a lone Badge) from shrinking to something narrower than
   * its own label; MAX matches the row header's own column width
   * (`.ui-component-row-header`'s max-width in style.css) so a
   * genuinely-wide component still reads as part of the same column,
   * not wider than the text above it. */
  function clampPreviewWidth(width) {
    const MIN = 240;
    const MAX = 720;
    return Math.min(Math.max(width, MIN), MAX);
  }

  // A few px of headroom added to a reported max-content width before
  // applying it as a real container size -- see the WIDTH_SAFETY_MARGIN
  // comment at both call sites for why this is needed at all (sub-pixel
  // font metrics rounding differently between measurement and render can
  // otherwise wrap content one word early even at its own reported
  // "never wraps" width).
  //
  // This briefly went to 12 to compensate for a 4px-per-side body padding
  // compile.ts added for an unrelated hover-clipping fix (the measured
  // width comes from the row element itself, inside #root, so it never
  // included body's own padding -- applying it back onto the now-
  // narrower interior left a many-item flex-wrap row a few px short,
  // confirmed by hand against the real button-showcase component). That
  // padding has since been reverted (see compile.ts's html/body rule --
  // it caused a worse regression, a resonant height-growth loop for any
  // component anchored to the iframe's own viewport size), so the 8px
  // it was compensating for no longer exists either. Back to 4.
  const WIDTH_SAFETY_MARGIN = 4;

  // Tracks the list's current IntersectionObserver so a re-render (e.g.
  // clicking a different category tab) can disconnect the previous one
  // first -- without this, every re-render's `container.innerHTML = ''`
  // detaches the old rows from the DOM but leaves the old observer still
  // holding references to them (and their closures) indefinitely, since
  // nothing ever called .disconnect() on it.
  let uiComponentsListObserver = null;

  // Tracks every row's own contentHeight message listener so a re-render
  // can remove them all first -- same reasoning as the IntersectionObserver
  // above: `container.innerHTML = ''` detaches the old rows/iframes from
  // the DOM, but a `window`-level listener wouldn't otherwise be cleaned
  // up on its own.
  let uiComponentsListMessageHandlers = [];

  /** A single full-width row per component: an index number, name +
   * componentTypes tag, description, then a live preview underneath --
   * a plain vertical list, not a packed grid. Components genuinely vary
   * in height (a lone Badge vs. a full animated hero), but with every row
   * the same width there's no bin-packing problem to solve for that --
   * this used to be a Muuri-managed masonry grid; removed entirely once
   * every row become full-width made it pure unnecessary complexity
   * (position:absolute, an item-content-wrapper requirement, explicit
   * repack calls on every resize). */
  function renderUiComponentsList(uiComponentEntries) {
    const container = $('ui-components-list');
    const emptyState = $('ui-components-empty');
    container.innerHTML = '';

    if (uiComponentsListObserver) {
      uiComponentsListObserver.disconnect();
    }
    for (const handler of uiComponentsListMessageHandlers) {
      window.removeEventListener('message', handler);
    }
    uiComponentsListMessageHandlers = [];

    const category = state.uiComponentsPageCategory;
    const filtered = category
      ? uiComponentEntries.filter((entry) => (entry.manifest.tags?.componentTypes ?? []).includes(category))
      : uiComponentEntries;

    emptyState.hidden = filtered.length !== 0;
    $('ui-components-count').textContent = `${filtered.length} component${filtered.length === 1 ? '' : 's'}`;

    const entryByRow = new Map();
    const observer = new IntersectionObserver((observedEntries) => {
      for (const observedEntry of observedEntries) {
        if (!observedEntry.isIntersecting) {
          continue;
        }
        const row = observedEntry.target;
        observer.unobserve(row);
        const entry = entryByRow.get(row);
        void loadUiComponentPreview(row, entry);
      }
    });
    uiComponentsListObserver = observer;

    filtered.forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = 'ui-component-row';
      row.innerHTML = `
        <div class="ui-component-row-header">
          <span class="index"></span>
          <span class="name"></span>
          <span class="meta"></span>
          <p class="description"></p>
        </div>
        <div class="ui-component-preview-frame">
          <span class="ui-component-preview-loading">Loading preview&hellip;</span>
        </div>
      `;
      row.querySelector('.index').textContent = String(index + 1).padStart(2, '0');
      row.querySelector('.name').textContent = entry.manifest.id;
      row.querySelector('.meta').textContent =
        (entry.manifest.tags?.componentTypes ?? []).join(', ') || entry.manifest.kind;
      row.querySelector('.description').textContent = entry.manifest.description;
      // Only the header (index/name/tag/description) opens Detail, not the
      // whole row -- the preview frame below it gets a real, interactive
      // <iframe> once loaded, and clicks landing inside an iframe (a
      // separate browsing context) don't bubble to a listener on an
      // ancestor element anyway. Keeping the live preview fully
      // interactive (hover states etc. actually working) matters more
      // here than the whole row being one giant click target.
      row.querySelector('.ui-component-row-header').addEventListener('click', () => openDetail(entry));
      container.appendChild(row);

      entryByRow.set(row, entry);
      observer.observe(row);
    });
  }

  /** Fetches the compiled preview for one row and drops it into a
   * sandboxed iframe -- sandbox="allow-scripts" only, deliberately never
   * allow-same-origin (see docs/ui-components-feature-design.md §3: that's
   * what keeps the frame's origin opaque, so a pushed component's own code
   * can never reach window.parent, cookies, or localStorage). A compile
   * failure degrades to a text placeholder, never breaks the whole list --
   * same "preview fails soft" principle as every other known limitation
   * in this feature. */
  async function loadUiComponentPreview(row, entry) {
    const frame = row.querySelector('.ui-component-preview-frame');
    try {
      const result = await call('preview.compile', { remote: entry.remoteName, id: entry.manifest.id });
      const iframe = document.createElement('iframe');
      iframe.sandbox = 'allow-scripts';
      iframe.srcdoc = result.html;
      frame.innerHTML = '';
      frame.appendChild(iframe);

      // The frame starts at its CSS default (loading-state) height; once
      // the compiled preview reports its own real content height (every
      // compiled preview does this -- see compile.ts's
      // injectContentHeightReporter, adapter-agnostic), the row grows or
      // shrinks to fit instead of clipping/leaving dead space. event.source,
      // not event.origin, is the only sound check here -- a srcdoc iframe's
      // origin is the opaque literal string "null" for EVERY such iframe on
      // the page at once, so it can't tell this row's iframe apart from
      // any other.
      // A ResizeObserver can fire several times in quick succession while
      // a component's initial render/layout is still settling (fonts,
      // nested reflows, etc.) -- coalescing to one resize per animation
      // frame (using whichever size was reported LAST) avoids a burst of
      // redundant style writes for the same row in a row.
      let pendingRawWidth = null;
      let pendingRawHeight = null;
      let resizeScheduled = false;

      const handler = (event) => {
        if (event.source !== iframe.contentWindow) return;
        const data = event.data;
        if (!data || typeof data !== 'object' || data.type !== 'contentHeight') return;
        pendingRawWidth = data.width;
        pendingRawHeight = data.height;
        if (resizeScheduled) return;
        resizeScheduled = true;
        requestAnimationFrame(() => {
          resizeScheduled = false;
          // +WIDTH_SAFETY_MARGIN: the reported width is the content's true
          // max-content (never-wraps) size, but applying that EXACT pixel
          // value back as the container's width can still wrap it one
          // word early -- sub-pixel font metrics rounding differently
          // between the measurement and the real render (observed by
          // hand: a real compiled preview measured at 572px still wrapped
          // when given exactly 572px of room). A few px of headroom costs
          // nothing visually (the frame is centered either way) and
          // removes the boundary-exact case entirely.
          const clampedWidth = clampPreviewWidth(pendingRawWidth + WIDTH_SAFETY_MARGIN);
          const clampedHeight = clampPreviewHeight(pendingRawHeight);
          frame.style.width = `${clampedWidth}px`;
          frame.style.height = `${clampedHeight}px`;
          // The iframe itself gets the REAL (unclamped, but never bigger
          // than the frame it sits in) size on both axes, not the
          // frame's -- when content is smaller than clampPreviewWidth/
          // clampPreviewHeight's floor (a tiny Badge, a narrow themed
          // box), this is what lets .ui-component-preview-frame's flex
          // centering actually have room to center the iframe within
          // itself on both axes, instead of the iframe filling the whole
          // frame with dead space rendered as part of its own (mostly
          // empty) document.
          iframe.style.width = `${Math.min(pendingRawWidth + WIDTH_SAFETY_MARGIN, clampedWidth)}px`;
          iframe.style.height = `${Math.min(pendingRawHeight, clampedHeight)}px`;
        });
      };
      uiComponentsListMessageHandlers.push(handler);
      window.addEventListener('message', handler);
    } catch (err) {
      frame.innerHTML = '';
      const placeholder = document.createElement('span');
      placeholder.className = 'ui-component-preview-loading';
      placeholder.textContent = `Preview unavailable -- ${err instanceof Error ? err.message : String(err)}`;
      frame.appendChild(placeholder);
    }
  }

  // Tracks the Detail preview's current window-level message listener so
  // opening a different (or the same) artifact's Detail can remove the
  // previous one first -- same disconnect-before-replace discipline
  // uiComponentsListObserver already uses for its IntersectionObserver.
  let detailPreviewMessageHandler = null;

  // A monotonically increasing token identifying the MOST RECENT call to
  // loadDetailPreview -- guards against a real race: loadDetailPreview is
  // invoked from multiple call sites (renderDetail, refreshDetailIfShown),
  // and the removeEventListener-then-await-then-addEventListener shape
  // below has a window where a second call can start before the first
  // one's `await call('preview.compile', ...)` resolves. Without this
  // guard, both calls' completions could each set
  // detailPreviewMessageHandler and call addEventListener, leaving the
  // FIRST one's listener permanently unreachable (the module variable now
  // points at the second) but still attached to `window` forever -- a
  // real leak, and a real risk of a stale iframe's messages driving
  // renderControlsPanel after its own iframe was already replaced.
  // Checked once right after the `await` (the only place this function
  // yields), so only the call that started MOST RECENTLY ever actually
  // creates an iframe or attaches a listener; any superseded call simply
  // stops before touching the DOM.
  let detailPreviewRequestId = 0;

  // Same request-token-guard discipline as detailPreviewRequestId, above,
  // for renderInstallParamsSection's own async README fetch -- switching
  // Detail to a different artifact before an in-flight
  // artifact.readPayloadFile call resolves must never let that stale
  // call overwrite the NOW-current artifact's README with the PREVIOUS
  // one's content.
  let installParamsRequestId = 0;

  // Same request-token-guard discipline, for renderWiringSection's own
  // async artifact.resolveWiringActions call.
  let wiringRequestId = 0;

  // Phase 11 Detail-view task: same request-token-guard discipline, for
  // renderTemplateSection's own async artifact.parseGuidelines/
  // artifact.listPayloadComponents/preview.compilePayloadComponent calls.
  let detailTemplateRequestId = 0;

  // Same request-token-guard discipline, for renderGenericReadmeSection's
  // own async artifact.readPayloadFile call.
  let genericReadmeRequestId = 0;

  // openComponentDetail's own single-iframe listener + request-id guard --
  // a THIRD independent "one active interactive iframe" context, alongside
  // detailPreviewMessageHandler (a whole standalone artifact) and
  // detailTemplateMessageHandlers (the grid's own array of N at once).
  // Needs its own teardown, not reuse of either -- this view shows exactly
  // one component from a design-kit-shaped bundle at a time.
  let componentDetailMessageHandler = null;
  let componentDetailRequestId = 0;

  function clearComponentDetailListener() {
    if (componentDetailMessageHandler) {
      window.removeEventListener('message', componentDetailMessageHandler);
      componentDetailMessageHandler = null;
    }
  }

  // Same array-based teardown discipline as uiComponentsListMessageHandlers
  // above, NOT the single-variable detailPreviewMessageHandler discipline --
  // the template grid hosts one iframe PER component (N at once), so
  // switching Detail to a different artifact must remove every one of
  // them, not just one.
  let detailTemplateMessageHandlers = [];
  // Parallel to the array above: the grid's own live iframes, so the theme
  // toggle can broadcast `setTheme` to every currently-mounted one without
  // needing to re-query the DOM.
  let detailTemplateIframes = [];

  // The template grid's currently-selected theme ('light' or 'dark') --
  // read by each card's handler on the harness's own 'ready' message (see
  // loadTemplateComponentPreview), so a card that finishes loading AFTER
  // the toggle was already flipped still self-syncs correctly with no
  // queuing logic needed.
  let currentTemplateTheme = 'light';

  // Same request-token-guard discipline again, for Phase 10 item 2's
  // "want help fixing this?" rows -- guards against a stale
  // artifact.requestBuildFix response clobbering a newer render if a row
  // is reused or Detail is closed/reopened mid-request.
  let buildFixRequestId = 0;

  /** Clears any live Detail-preview iframe/listener -- called both at the
   * top of loadDetailPreview (about to replace it with a new one) and
   * from renderDetail when switching to a NON-ui-component artifact
   * (which never calls loadDetailPreview at all, so without this the
   * previous artifact's iframe/listener would otherwise just sit there,
   * hidden but still live, until some later ui-component Detail happens
   * to replace it). */
  function clearDetailPreviewListener() {
    if (detailPreviewMessageHandler) {
      window.removeEventListener('message', detailPreviewMessageHandler);
      detailPreviewMessageHandler = null;
    }
  }

  /** Array-based counterpart to clearDetailPreviewListener, for the
   * template grid's N simultaneous iframes -- called both at the top of
   * renderTemplateSection (about to replace them with a new set) and from
   * renderDetail when switching to an artifact with no GUIDELINES.md
   * (which never calls renderTemplateSection's grid-building path at all,
   * so without this the previous artifact's iframes/listeners would
   * otherwise just sit there, hidden but still live). */
  function clearDetailTemplateListeners() {
    for (const handler of detailTemplateMessageHandlers) {
      window.removeEventListener('message', handler);
    }
    detailTemplateMessageHandlers = [];
    detailTemplateIframes = [];
  }

  /** Detail view's live, INTERACTIVE preview (Phase C): variant tabs +
   * a generated props-controls panel, driven entirely by `postMessage`
   * into ONE already-loaded iframe -- no re-fetch, no iframe reload, no
   * extra sidecar round-trip per variant switch or prop edit. Mirrors
   * `loadUiComponentPreview`'s iframe creation exactly (same `sandbox`
   * attribute, same `srcdoc`, same fail-soft-to-placeholder), but wires up
   * variant switching + controls on top -- Detail, unlike the grid, is
   * where a person actually interacts with a component, not just glances
   * at its default state. */
  async function loadDetailPreview(entry) {
    const requestId = ++detailPreviewRequestId;

    const frame = $('detail-preview-frame');
    const tabsContainer = $('detail-preview-tabs');
    const controlsContainer = $('detail-preview-controls');

    tabsContainer.innerHTML = '';
    controlsContainer.innerHTML = '';
    frame.innerHTML = '<span class="ui-component-preview-loading">Loading preview&hellip;</span>';
    clearDetailPreviewListener();

    let result;
    try {
      result = await call('preview.compile', { remote: entry.remoteName, id: entry.manifest.id });
    } catch (err) {
      if (requestId !== detailPreviewRequestId) return; // superseded while awaiting
      frame.innerHTML = '';
      const placeholder = document.createElement('span');
      placeholder.className = 'ui-component-preview-loading';
      placeholder.textContent = `Preview unavailable -- ${err instanceof Error ? err.message : String(err)}`;
      frame.appendChild(placeholder);
      return;
    }
    if (requestId !== detailPreviewRequestId) return; // superseded while awaiting

    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-scripts';
    iframe.srcdoc = result.html;
    frame.innerHTML = '';
    frame.appendChild(iframe);

    // variantName -> tab element, so the message handler below can drive
    // which tab looks "active" from the harness's own variantChanged
    // reply rather than marking a tab active optimistically on click --
    // if a variant's own render throws inside the sandboxed iframe (a
    // pushed component bug, not a DeliveryOS bug), no variantChanged
    // comes back, and the tab UI correctly stays on whichever variant is
    // still actually showing instead of drifting out of sync with it.
    const tabsByVariant = new Map();
    // Only meaningful once variantNames is non-empty (the React adapter);
    // the zero-build HTML adapter always returns [] (see compile.ts), so
    // tabs/controls simply stay empty -- the same graceful-degrade
    // pattern this feature already uses everywhere else.
    result.variantNames.forEach((variantName) => {
      const tab = document.createElement('button');
      tab.className = 'tab';
      tab.textContent = variantName;
      tab.addEventListener('click', () => {
        iframe.contentWindow.postMessage({ type: 'selectVariant', variant: variantName }, '*');
      });
      tabsContainer.appendChild(tab);
      tabsByVariant.set(variantName, tab);
    });

    // event.source, not event.origin, is the only sound check here -- a
    // srcdoc iframe's origin is the opaque literal string "null" for
    // EVERY such iframe on the page (grid cards stay mounted-but-hidden
    // behind Detail), so it can't discriminate between them. Checked
    // against THIS specific iframe's own contentWindow, not any iframe.
    detailPreviewMessageHandler = (event) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'contentHeight') {
        const clampedHeight = clampPreviewHeight(data.height);
        frame.style.height = `${clampedHeight}px`;
        // See the grid's identical comment (loadUiComponentPreview) --
        // the iframe gets the real, unclamped size so short/narrow
        // content centers via the frame's flex rule instead of pinning
        // to the top-left. Detail's own frame keeps `max-width: none`
        // (see .detail-preview-frame in style.css), so width is left at
        // its CSS default here -- unlike the list, Detail has no shared
        // column width to hug, and letting an interactive preview go as
        // wide as the panel allows is the existing, deliberate behavior.
        iframe.style.height = `${Math.min(data.height, clampedHeight)}px`;
        return;
      }
      if (data.type !== 'variantChanged') return;
      for (const [variantName, tab] of tabsByVariant) {
        tab.classList.toggle('active', variantName === data.variant);
      }
      renderControlsPanel(result.propsSchemas, data.componentName, data.initialProps, (changedProps) => {
        iframe.contentWindow.postMessage({ type: 'setProps', props: changedProps }, '*');
      });
    };
    window.addEventListener('message', detailPreviewMessageHandler);
  }

  /** Detail view's non-visual counterpart to loadDetailPreview (Phase 7,
   * kind: backend-plugin): a signed/provenance badge, the artifact's
   * rendered README (if it has one), and a required-config checklist for
   * every declared install_param, collecting the PROJECT's own values --
   * never the artifact's own defaults, which only ever seed the form as a
   * starting point, exactly like Add New's own auto-scaffold placeholders
   * are a starting point, not a finished value. Shown only when
   * `manifest.install_params` is non-empty -- see renderDetail. */
  async function renderInstallParamsSection(entry) {
    const requestId = ++installParamsRequestId;
    const { manifest } = entry;

    // Provenance badge: honest about what's actually been verified. No
    // artifact has a real signature yet (Phase 7's item 3, the actual
    // signing pipeline, isn't built) -- this already renders the "Signed"
    // state correctly for whenever one does, without needing to come back
    // and wire this up again later.
    const badge = $('detail-provenance-badge');
    if (manifest.signature) {
      badge.textContent = `✓ Signed (${manifest.signature.algorithm})`;
      badge.className = 'provenance-badge signed';
    } else {
      badge.textContent = 'Unverified -- no provenance signature yet';
      badge.className = 'provenance-badge unsigned';
    }

    const readmeEl = $('detail-readme');
    readmeEl.hidden = true;
    readmeEl.textContent = '';
    try {
      const { content } = await call('artifact.readPayloadFile', {
        remote: entry.remoteName,
        id: manifest.id,
        path: 'README.md',
      });
      if (requestId !== installParamsRequestId) return; // superseded while awaiting
      if (content) {
        // Shown as plain preformatted text, not rendered HTML -- no
        // markdown renderer is vendored anywhere in this app, and adding
        // one is a bigger scope increase than this item calls for; a
        // real, readable README beats no README, even unstyled.
        readmeEl.textContent = content;
        readmeEl.hidden = false;
      }
    } catch {
      // No README is a normal, common case (most artifacts don't have
      // one) -- fail silent here, the checklist below is the actually
      // required part of this section.
    }

    const fieldsContainer = $('detail-install-params-fields');
    fieldsContainer.innerHTML = '';
    for (const param of manifest.install_params) {
      const field = document.createElement('div');
      field.className = 'field';
      const label = document.createElement('label');
      label.textContent = `${param.key}${param.required ? ' *' : ''}`;
      label.htmlFor = `install-param-${param.key}`;
      const help = document.createElement('div');
      help.className = 'install-param-help';
      help.textContent = param.description;
      const input = document.createElement('input');
      input.id = `install-param-${param.key}`;
      input.name = param.key;
      input.type = param.secret ? 'password' : 'text';
      input.placeholder = param.default ?? (param.secret ? '(secret -- never defaulted)' : '');
      if (param.default !== undefined) {
        input.value = param.default;
      }
      field.appendChild(label);
      field.appendChild(help);
      field.appendChild(input);
      fieldsContainer.appendChild(field);
    }

    const form = $('detail-install-params-form');
    form.onsubmit = (ev) => {
      ev.preventDefault();
      void handleApplyInstallParams(entry);
    };
  }

  /** Generic fallback for any artifact with a real payload-root
   * README.md that isn't a `kind: backend-plugin` (that case renders its
   * README inside its own section, see renderInstallParamsSection above)
   * -- gated on real file presence, never a `kind` check, same
   * convention as every other Detail section. Most artifacts have no
   * README at all; that's the normal case, not a failure, so this fails
   * quietly and just keeps the section hidden. */
  async function renderGenericReadmeSection(entry) {
    const requestId = ++genericReadmeRequestId;
    const section = $('detail-generic-readme-section');
    const readmeEl = $('detail-generic-readme');

    let content;
    try {
      ({ content } = await call('artifact.readPayloadFile', {
        remote: entry.remoteName,
        id: entry.manifest.id,
        path: 'README.md',
      }));
    } catch {
      content = undefined;
    }
    if (requestId !== genericReadmeRequestId) return; // superseded while awaiting

    if (content) {
      readmeEl.textContent = content;
      section.hidden = false;
    } else {
      readmeEl.textContent = '';
      section.hidden = true;
    }
  }

  /** Collects whatever was actually typed into the required-config
   * checklist (blank fields are simply omitted, not sent as empty-string
   * overwrites -- re-opening Detail without retyping an already-configured
   * secret must never blank it back out) and applies it via
   * artifact.applyInstallParams -- no re-pull needed, the real point of
   * that command existing separately from artifact.pull at all. */
  async function handleApplyInstallParams(entry) {
    const values = {};
    for (const param of entry.manifest.install_params) {
      const input = $(`install-param-${param.key}`);
      if (input && input.value.trim().length > 0) {
        values[param.key] = input.value;
      }
    }

    try {
      const result = await call('artifact.applyInstallParams', {
        id: entry.manifest.id,
        remote: entry.remoteName,
        cwd: state.projectDir,
        values,
      });
      if (result.missingRequiredParams.length > 0) {
        toastError(new Error(
          `Still missing required value(s): ${result.missingRequiredParams.join(', ')}.`,
        ));
      } else {
        toastSuccess('Configuration applied.');
      }
    } catch (err) {
      toastError(err);
    }
  }

  /** Tier 2 of the wiring agent (Phase 7 item 6): resolves this artifact's
   * declared `wiring_actions` against the real project at `state.projectDir`
   * and renders one card per action -- description, which real file it
   * targets, whether that file already exists, and the applicable
   * instructions/snippet. Deliberately no "apply" button anywhere here:
   * Tier 2 is inherently "go do this in your own editor," matching the
   * tier's own definition ("shown as a diff; applied only on explicit
   * confirmation" means a PERSON applies it, not that DeliveryOS silently
   * generates and commits one). Hidden entirely when the manifest declares
   * no wiring_actions at all -- the overwhelming majority of artifacts. */
  async function renderWiringSection(entry) {
    const requestId = ++wiringRequestId;
    const section = $('detail-wiring-section');
    const container = $('detail-wiring-actions');

    if (!entry.manifest.wiring_actions || entry.manifest.wiring_actions.length === 0) {
      section.hidden = true;
      return;
    }

    let resolved;
    try {
      resolved = await call('artifact.resolveWiringActions', {
        id: entry.manifest.id,
        remote: entry.remoteName,
        cwd: state.projectDir,
      });
    } catch (err) {
      if (requestId !== wiringRequestId) return; // superseded while awaiting
      section.hidden = false;
      container.innerHTML = '';
      const errorEl = document.createElement('div');
      errorEl.className = 'wiring-action-card';
      errorEl.textContent = `Could not resolve wiring actions -- ${err instanceof Error ? err.message : String(err)}`;
      container.appendChild(errorEl);
      return;
    }
    if (requestId !== wiringRequestId) return; // superseded while awaiting

    section.hidden = false;
    container.innerHTML = '';
    for (const action of resolved) {
      const card = document.createElement('div');
      card.className = 'wiring-action-card';

      const header = document.createElement('div');
      header.className = 'wiring-action-header';
      const fileEl = document.createElement('code');
      fileEl.textContent = action.targetFile;
      const statusEl = document.createElement('span');
      statusEl.className = `wiring-action-status ${action.targetFileExists ? 'exists' : 'absent'}`;
      statusEl.textContent = action.targetFileExists ? 'exists' : 'not found';
      header.appendChild(fileEl);
      header.appendChild(statusEl);

      const descEl = document.createElement('div');
      descEl.className = 'wiring-action-description';
      descEl.textContent = action.description;

      const instructionsEl = document.createElement('div');
      instructionsEl.className = 'wiring-action-instructions';
      instructionsEl.textContent = action.instructions;

      card.appendChild(header);
      card.appendChild(descEl);
      card.appendChild(instructionsEl);

      if (action.snippet) {
        const snippetEl = document.createElement('pre');
        snippetEl.className = 'wiring-action-snippet';
        snippetEl.textContent = action.snippet;
        card.appendChild(snippetEl);
      }

      container.appendChild(card);
    }
  }

  /** Phase 11 Detail-view task: renders design-kit's color tokens, type
   * scale, and a live component grid for a `kind: template` (or any
   * future kind) artifact that has a real `GUIDELINES.md` at its payload
   * root -- gated on that presence, never `manifest.kind`. Sets the
   * section's own visibility once `artifact.parseGuidelines` resolves
   * (renderDetail hides it up front so a previous artifact's content
   * doesn't stay visible in the meantime). */
  async function renderTemplateSection(entry) {
    const requestId = ++detailTemplateRequestId;
    const section = $('detail-template-section');

    let guidelines;
    try {
      guidelines = await call('artifact.parseGuidelines', { remote: entry.remoteName, id: entry.manifest.id });
    } catch {
      if (requestId !== detailTemplateRequestId) return; // superseded while awaiting
      section.hidden = true;
      return;
    }
    if (requestId !== detailTemplateRequestId) return; // superseded while awaiting

    if (!guidelines.present) {
      section.hidden = true;
      return;
    }
    section.hidden = false;

    const tokensContainer = $('detail-template-tokens');
    tokensContainer.innerHTML = '';
    for (const { token, hex } of guidelines.colorTokens) {
      const swatch = document.createElement('div');
      swatch.className = 'token-swatch';
      const colorEl = document.createElement('span');
      colorEl.className = 'token-swatch-color';
      colorEl.style.background = hex;
      const labelEl = document.createElement('span');
      labelEl.className = 'token-swatch-label';
      labelEl.textContent = `${token} ${hex}`;
      swatch.appendChild(colorEl);
      swatch.appendChild(labelEl);
      tokensContainer.appendChild(swatch);
    }

    const typeScaleContainer = $('detail-template-type-scale');
    typeScaleContainer.innerHTML = '';
    for (const row of guidelines.typeScale) {
      const sampleRow = document.createElement('div');
      sampleRow.className = 'type-sample-row';

      const labelEl = document.createElement('span');
      labelEl.className = 'type-sample-label';
      labelEl.textContent = row.Element || '';

      const textEl = document.createElement('span');
      textEl.className = 'type-sample-text';
      // A REAL applied sample, not a data table -- the row's own Element
      // text, rendered in its own real Font/Weight/Size, so this shows
      // what the type actually looks like rather than just naming it.
      textEl.textContent = row.Element || '';
      textEl.style.fontFamily = fontFamilyStack(row.Font || '');
      textEl.style.fontWeight = String(parseLeadingNumber(row.Weight, 400));
      textEl.style.fontSize = `${clamp(parseLeadingNumber(row.Size, 14), 12, 28)}px`;

      sampleRow.appendChild(labelEl);
      sampleRow.appendChild(textEl);
      typeScaleContainer.appendChild(sampleRow);
    }

    const grid = $('detail-template-grid');
    grid.innerHTML = '';
    let components;
    try {
      ({ components } = await call('artifact.listPayloadComponents', {
        remote: entry.remoteName,
        id: entry.manifest.id,
      }));
    } catch {
      components = [];
    }
    if (requestId !== detailTemplateRequestId) return; // superseded while awaiting

    await Promise.all(
      components.map((component) =>
        loadTemplateComponentPreview(grid, entry, component, requestId, guidelines.usageRules || {}),
      ),
    );
    if (requestId !== detailTemplateRequestId) return; // superseded while awaiting

    renderTemplateLayoutRules(guidelines.layoutRules);
  }

  /** Extracts the first integer in a string (e.g. "18–24px" -> 18, "500"
   * -> 500), falling back to `fallback` when nothing parses -- GUIDELINES.md's
   * Size/Weight columns are free-text prose ("400 (never bold)", "18-24px"),
   * not structured data. */
  function parseLeadingNumber(text, fallback) {
    const match = /\d+/.exec(String(text ?? ''));
    return match ? Number(match[0]) : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  /** Maps a GUIDELINES.md Font-column value to a real font-family stack --
   * reuses this app's own already-established stacks (style.css's own
   * heading/mono rules) rather than inventing new fallbacks, so a type
   * sample renders in the SAME real fonts the rest of the app already
   * uses, not a generic system default. */
  function fontFamilyStack(fontName) {
    const lower = fontName.toLowerCase();
    if (lower.includes('garamond')) return `'EB Garamond', Georgia, serif`;
    if (lower.includes('mono')) return `'JetBrains Mono', ui-monospace, Consolas, monospace`;
    if (lower.includes('plex')) return `'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif`;
    return fontName ? `'${fontName}', system-ui, sans-serif` : 'system-ui, sans-serif';
  }

  /** Renders the layout-rules summary strip below the component grid --
   * real radius tokens (a table GUIDELINES.md already documents) plus the
   * Layout grid/Spacing sections' own real prose, never the mockup's
   * fictional "Max width/Section rhythm" labels (those were invented for
   * ITS OWN made-up demo kit, not something this real GUIDELINES.md
   * states). `layoutRules` is `null` when the artifact has no
   * GUIDELINES.md at all (see artifact.parseGuidelines). */
  function renderTemplateLayoutRules(layoutRules) {
    const container = $('detail-template-layout');
    container.innerHTML = '';
    if (!layoutRules) return;

    if (layoutRules.radiusTokens.length > 0) {
      const tokenRow = document.createElement('div');
      tokenRow.className = 'radius-token-row';
      for (const { token, value, usage } of layoutRules.radiusTokens) {
        const chip = document.createElement('div');
        chip.className = 'radius-token-chip';
        const nameEl = document.createElement('code');
        nameEl.textContent = `${token}: ${value}`;
        const usageEl = document.createElement('span');
        usageEl.textContent = usage;
        chip.appendChild(nameEl);
        chip.appendChild(usageEl);
        tokenRow.appendChild(chip);
      }
      container.appendChild(tokenRow);
    }

    for (const note of [layoutRules.layoutNote, layoutRules.spacingNote]) {
      if (!note) continue;
      const noteEl = document.createElement('p');
      noteEl.className = 'layout-rules-note';
      noteEl.textContent = note;
      container.appendChild(noteEl);
    }
  }

  /** Opens a dedicated, full view of ONE component from a design-kit-shaped
   * grid -- every real CSF variant as tabs, a live props-controls panel,
   * and the complete (untruncated) usage-rule text. Clones
   * loadDetailPreview's own tabs/message-handler/controls-panel logic,
   * parameterized for a design-kit sub-component instead of a whole
   * artifact -- kept as its own function rather than forced through a
   * shared helper with loadDetailPreview, since the two contexts differ
   * enough (different DOM ids, this one also needs setTheme support) that
   * merging them would add more indirection than it would save. Reuses
   * the exact same `preview.compilePayloadComponent` RPC the grid card
   * already calls -- no new engine/sidecar work. */
  async function openComponentDetail(entry, component, usageRule) {
    const requestId = ++componentDetailRequestId;

    state.componentDetailReturnEntry = entry;
    $('component-detail-name').textContent = component.name;
    $('component-detail-usage-rule').textContent = usageRule || '';

    const tabsContainer = $('component-detail-tabs');
    const controlsContainer = $('component-detail-controls');
    const frame = $('component-detail-frame');

    tabsContainer.innerHTML = '';
    controlsContainer.innerHTML = '';
    frame.innerHTML = '<span class="ui-component-preview-loading">Loading preview&hellip;</span>';
    clearComponentDetailListener();
    showViewRaw('component-detail');

    let result;
    try {
      result = await call('preview.compilePayloadComponent', {
        remote: entry.remoteName,
        id: entry.manifest.id,
        relativeDir: component.relativeDir,
      });
    } catch (err) {
      if (requestId !== componentDetailRequestId) return; // superseded while awaiting
      frame.innerHTML = '';
      const placeholder = document.createElement('span');
      placeholder.className = 'ui-component-preview-loading';
      placeholder.textContent = `Preview unavailable -- ${err instanceof Error ? err.message : String(err)}`;
      frame.appendChild(placeholder);
      return;
    }
    if (requestId !== componentDetailRequestId) return; // superseded while awaiting

    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-scripts';
    iframe.srcdoc = result.html;
    frame.innerHTML = '';
    frame.appendChild(iframe);

    const tabsByVariant = new Map();
    result.variantNames.forEach((variantName) => {
      const tab = document.createElement('button');
      tab.className = 'tab';
      tab.textContent = variantName;
      tab.addEventListener('click', () => {
        iframe.contentWindow.postMessage({ type: 'selectVariant', variant: variantName }, '*');
      });
      tabsContainer.appendChild(tab);
      tabsByVariant.set(variantName, tab);
    });

    componentDetailMessageHandler = (event) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'ready') {
        // Same theme the grid this component came from is currently
        // showing, so switching between the grid and this view never
        // looks like it silently reset the toggle.
        iframe.contentWindow.postMessage({ type: 'setTheme', theme: currentTemplateTheme }, '*');
        return;
      }
      if (data.type === 'contentHeight') {
        const clampedHeight = clampPreviewHeight(data.height);
        frame.style.height = `${clampedHeight}px`;
        iframe.style.height = `${Math.min(data.height, clampedHeight)}px`;
        return;
      }
      if (data.type !== 'variantChanged') return;
      for (const [variantName, tab] of tabsByVariant) {
        tab.classList.toggle('active', variantName === data.variant);
      }
      renderControlsPanel(
        result.propsSchemas,
        data.componentName,
        data.initialProps,
        (changedProps) => {
          iframe.contentWindow.postMessage({ type: 'setProps', props: changedProps }, '*');
        },
        'component-detail-controls',
      );
    };
    window.addEventListener('message', componentDetailMessageHandler);
  }

  /** Compiles and mounts ONE component's live preview inside the template
   * grid -- clones loadUiComponentPreview's own per-card iframe pattern
   * (own contentHeight resize handler scoped via event.source, no
   * innerHTML for artifact-controlled text) rather than a single shared
   * listener, since the grid hosts N of these at once. Also applies the
   * template section's currently-active theme on the harness's own
   * 'ready' message (see compile.ts's setTheme handling) -- this is what
   * makes a card that finishes loading AFTER the toggle was already
   * flipped self-sync correctly. */
  async function loadTemplateComponentPreview(grid, entry, component, requestId, usageRules) {
    const card = document.createElement('div');
    card.className = 'wiring-action-card template-component-card';

    const header = document.createElement('div');
    header.className = 'wiring-action-header';
    const nameEl = document.createElement('code');
    nameEl.textContent = component.name;
    header.appendChild(nameEl);
    const detailBtn = document.createElement('button');
    detailBtn.type = 'button';
    detailBtn.className = 'btn btn-ghost btn-sm';
    detailBtn.textContent = 'View details';
    detailBtn.addEventListener('click', () => {
      void openComponentDetail(entry, component, usageRules[component.name.toLowerCase()]);
    });
    header.appendChild(detailBtn);
    card.appendChild(header);

    const frame = document.createElement('div');
    frame.className = 'ui-component-preview-frame';
    frame.innerHTML = '<span class="ui-component-preview-loading">Loading preview&hellip;</span>';
    card.appendChild(frame);

    // Real usage-rule text from GUIDELINES.md's own "Per-component usage
    // rules" section, matched case-insensitively by component.name -- a
    // component with no matching bullet (e.g. one not yet documented)
    // simply gets no caption, never a placeholder/invented one.
    const usageRule = usageRules[component.name.toLowerCase()];
    if (usageRule) {
      const captionEl = document.createElement('p');
      captionEl.className = 'template-component-caption';
      captionEl.textContent = usageRule;
      card.appendChild(captionEl);
    }

    if (requestId !== detailTemplateRequestId) return; // superseded before attaching
    grid.appendChild(card);

    try {
      const result = await call('preview.compilePayloadComponent', {
        remote: entry.remoteName,
        id: entry.manifest.id,
        relativeDir: component.relativeDir,
      });
      if (requestId !== detailTemplateRequestId) return; // superseded while awaiting

      const iframe = document.createElement('iframe');
      iframe.sandbox = 'allow-scripts';
      iframe.srcdoc = result.html;
      frame.innerHTML = '';
      frame.appendChild(iframe);
      detailTemplateIframes.push(iframe);

      let pendingRawWidth = null;
      let pendingRawHeight = null;
      let resizeScheduled = false;

      const handler = (event) => {
        if (event.source !== iframe.contentWindow) return;
        const data = event.data;
        if (!data || typeof data !== 'object') return;
        if (data.type === 'ready') {
          iframe.contentWindow.postMessage({ type: 'setTheme', theme: currentTemplateTheme }, '*');
          return;
        }
        if (data.type !== 'contentHeight') return;
        pendingRawWidth = data.width;
        pendingRawHeight = data.height;
        if (resizeScheduled) return;
        resizeScheduled = true;
        requestAnimationFrame(() => {
          resizeScheduled = false;
          const clampedWidth = clampPreviewWidth(pendingRawWidth + WIDTH_SAFETY_MARGIN);
          const clampedHeight = clampPreviewHeight(pendingRawHeight);
          frame.style.width = `${clampedWidth}px`;
          frame.style.height = `${clampedHeight}px`;
          iframe.style.width = `${Math.min(pendingRawWidth + WIDTH_SAFETY_MARGIN, clampedWidth)}px`;
          iframe.style.height = `${Math.min(pendingRawHeight, clampedHeight)}px`;
        });
      };
      detailTemplateMessageHandlers.push(handler);
      window.addEventListener('message', handler);
    } catch (err) {
      frame.innerHTML = '';
      const placeholder = document.createElement('span');
      placeholder.className = 'ui-component-preview-loading';
      placeholder.textContent = `Preview unavailable -- ${err instanceof Error ? err.message : String(err)}`;
      frame.appendChild(placeholder);
    }
  }

  /** Phase 10 item 2: renders one "want help fixing this?" row per
   * candidate file after a real build failure following auto-wiring.
   * Candidates are ALWAYS a subset of `appliedFiles` (item 1's own
   * AppliedWiringResult.applied) -- `buildErrorText` is used only to
   * narrow which of those already-known-safe files get a row shown
   * first, never to expand the candidate set to some other file guessed
   * from the error text. Falls back to showing every applied file if
   * none of their paths/basenames are mentioned in the error at all. */
  function renderBuildFixOffers(appliedFiles, buildErrorText) {
    const container = $('build-fix-offers');
    container.innerHTML = '';

    if (!appliedFiles || appliedFiles.length === 0) {
      container.hidden = true;
      return;
    }

    const mentioned = appliedFiles.filter(
      (f) => buildErrorText.includes(f) || buildErrorText.includes(f.split('/').pop()),
    );
    const candidates = mentioned.length > 0 ? mentioned : appliedFiles;

    container.hidden = false;
    for (const filePath of candidates) {
      container.appendChild(renderBuildFixRow(filePath, buildErrorText));
    }
  }

  /** Builds one row's DOM for a single candidate file: a button that asks
   * for a fix, then either the model's own honest "can't determine a
   * fix" reason, or the proposed content plus Apply/Discard. Nothing is
   * written to disk, and nothing is logged, unless Apply is clicked. */
  function renderBuildFixRow(filePath, buildErrorText) {
    const row = document.createElement('div');
    row.className = 'build-fix-row';

    const askBtn = document.createElement('button');
    askBtn.type = 'button';
    askBtn.className = 'btn btn-sm btn-ghost';
    askBtn.textContent = `Want help fixing "${filePath}"? ✨`;
    row.appendChild(askBtn);

    const resultEl = document.createElement('div');
    resultEl.className = 'build-fix-result';
    resultEl.hidden = true;
    row.appendChild(resultEl);

    askBtn.addEventListener('click', () => {
      void withBusy(askBtn, 'Asking…', async () => {
        const requestId = ++buildFixRequestId;
        let fix;
        try {
          fix = await call('artifact.requestBuildFix', {
            cwd: state.projectDir,
            filePath,
            buildError: buildErrorText,
          });
        } catch (err) {
          if (requestId !== buildFixRequestId) return; // superseded while awaiting
          resultEl.hidden = false;
          resultEl.textContent = `Could not get a fix -- ${err instanceof Error ? err.message : String(err)}`;
          return;
        }
        if (requestId !== buildFixRequestId) return; // superseded while awaiting

        resultEl.hidden = false;
        resultEl.innerHTML = '';

        if (!fix.fixedFile) {
          const reasonEl = document.createElement('div');
          reasonEl.textContent = fix.reason || 'Claude could not determine a fix for this file.';
          resultEl.appendChild(reasonEl);
          return;
        }

        const snippetEl = document.createElement('pre');
        snippetEl.className = 'wiring-action-snippet';
        snippetEl.textContent = fix.fixedFile;
        resultEl.appendChild(snippetEl);

        const actionsEl = document.createElement('div');
        actionsEl.className = 'build-fix-actions';
        const applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'btn btn-sm';
        applyBtn.textContent = 'Apply';
        const discardBtn = document.createElement('button');
        discardBtn.type = 'button';
        discardBtn.className = 'btn btn-sm btn-ghost';
        discardBtn.textContent = 'Discard';
        actionsEl.appendChild(applyBtn);
        actionsEl.appendChild(discardBtn);
        resultEl.appendChild(actionsEl);
        askBtn.hidden = true;

        discardBtn.addEventListener('click', () => {
          // Nothing written, nothing logged -- just clears the offer back
          // to its starting state so it can be asked again if wanted.
          resultEl.hidden = true;
          resultEl.innerHTML = '';
          askBtn.hidden = false;
        });

        applyBtn.addEventListener('click', () => {
          void withBusy(applyBtn, 'Applying…', async () => {
            discardBtn.disabled = true;
            try {
              const outcome = await call('artifact.applyBuildFix', {
                cwd: state.projectDir,
                filePath,
                fixedFile: fix.fixedFile,
                buildError: buildErrorText,
                costUsd: fix.costUsd,
                durationMs: fix.durationMs,
              });
              const outcomeEl = document.createElement('div');
              if (outcome.rolledBack) {
                outcomeEl.textContent = `The fix didn't actually resolve the build -- your original file was restored.${outcome.build.output ? ` (${outcome.build.output})` : ''}`;
              } else if (outcome.build.ran) {
                outcomeEl.textContent = 'Fix applied -- the build now passes.';
              } else {
                outcomeEl.textContent = 'Fix applied (no build command detected to verify it).';
              }
              resultEl.innerHTML = '';
              resultEl.appendChild(outcomeEl);
            } catch (err) {
              const errEl = document.createElement('div');
              errEl.textContent = `Could not apply the fix -- ${err instanceof Error ? err.message : String(err)}`;
              resultEl.innerHTML = '';
              resultEl.appendChild(errEl);
            }
          });
        });
      });
    });

    return row;
  }

  /** Builds the generated props-controls panel for whichever component is
   * currently rendering inside the Detail preview iframe, looked up by
   * `componentName` (as reported by the harness's own `variantChanged`
   * message, matched against docgen's `displayName` -- see
   * src/engine/preview/docgen.ts). Rebuilt from scratch on every variant
   * switch, seeded from that variant's own starting prop values -- this
   * is the "reset to the variant's own args" behavior, driven by the
   * iframe's own reply rather than guessed client-side. Only props with a
   * plain scalar/enum type get a widget at all (string-literal unions,
   * `boolean`, `string`, `number`) -- function-typed, object-typed, and
   * `ReactNode`-typed props (besides `children`, already excluded by
   * docgen's own default filtering) have no generic widget yet and are
   * skipped rather than rendering something broken. */
  /** The value a control should display when first built: whatever the
   * variant's own JSX call literally passed (`initialProps`) if present,
   * else docgen's own extracted `defaultValue` -- otherwise a prop the
   * component defaults internally (never set by the variant at all)
   * would render its control blank/unchecked even though docgen captured
   * exactly what that default really is. `defaultValue` is always a
   * plain string (see docgen.ts's `String(prop.defaultValue.value)`), so
   * boolean/number props need converting back from that string form. */
  function resolveInitialValue(prop, initialProps) {
    if (initialProps[prop.name] !== undefined) {
      return initialProps[prop.name];
    }
    if (prop.defaultValue === undefined) {
      return undefined;
    }
    if (prop.type === 'boolean') {
      return prop.defaultValue === 'true';
    }
    if (prop.type === 'number') {
      return Number(prop.defaultValue);
    }
    return prop.defaultValue;
  }

  function renderControlsPanel(propsSchemas, componentName, initialProps, onChange, containerId = 'detail-preview-controls') {
    const container = $(containerId);
    container.innerHTML = '';

    const schema = propsSchemas[componentName] || [];
    let currentProps = { ...initialProps };

    for (const prop of schema) {
      const isControllable =
        Boolean(prop.enumValues) || prop.type === 'boolean' || prop.type === 'string' || prop.type === 'number';
      if (!isControllable) {
        continue;
      }

      const seedValue = resolveInitialValue(prop, initialProps);
      const field = document.createElement('div');
      field.className = 'field control-row';

      if (prop.type === 'boolean') {
        const checkboxLabel = document.createElement('label');
        checkboxLabel.className = 'control-checkbox';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = Boolean(seedValue);
        checkbox.addEventListener('change', () => {
          currentProps = { ...currentProps, [prop.name]: checkbox.checked };
          onChange(currentProps);
        });
        checkboxLabel.appendChild(checkbox);
        checkboxLabel.appendChild(document.createTextNode(` ${prop.name}`));
        field.appendChild(checkboxLabel);
        container.appendChild(field);
        continue;
      }

      const label = document.createElement('label');
      label.textContent = prop.name;
      field.appendChild(label);

      if (prop.enumValues) {
        const pickerContainer = document.createElement('div');
        field.appendChild(pickerContainer);
        // Reuses createSingleChipPicker verbatim (already used for Add
        // New's Kind/Remote pickers) -- its existing selectValue() method
        // is exactly the "set the selection programmatically, without
        // firing onChange" primitive needed to seed the panel from a
        // variant's own starting value.
        const picker = createSingleChipPicker(pickerContainer);
        picker.setOptions(prop.enumValues.map((value) => ({ value, label: value })));
        if (seedValue !== undefined) {
          picker.selectValue(seedValue);
        }
        picker.onChange((value) => {
          currentProps = { ...currentProps, [prop.name]: value };
          onChange(currentProps);
        });
      } else {
        const input = document.createElement('input');
        input.type = prop.type === 'number' ? 'number' : 'text';
        input.value = seedValue ?? '';
        input.addEventListener('input', () => {
          currentProps = {
            ...currentProps,
            [prop.name]: prop.type === 'number' ? Number(input.value) : input.value,
          };
          onChange(currentProps);
        });
        field.appendChild(input);
      }

      container.appendChild(field);
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
          // Phase 10 item 1: only artifacts that actually declare
          // wiring_actions opt into the auto-apply-and-test path -- every
          // other artifact (the overwhelming majority) keeps using the
          // plain pull command, unchanged, same "gate on field presence,
          // never a kind check" convention every earlier Phase 7/8 piece
          // already established.
          const hasWiring = entry.manifest.wiring_actions && entry.manifest.wiring_actions.length > 0;
          if (hasWiring) {
            const { pullResult, wiring, build } = await call('artifact.pullAndAutoWire', {
              id: entry.manifest.id,
              remote: entry.remoteName,
              cwd: state.projectDir,
            });
            const parts = [`Pulled ${pullResult.manifest.id}`];
            if (wiring.applied.length > 0) {
              parts.push(`applied ${wiring.applied.length} wiring action${wiring.applied.length === 1 ? '' : 's'} automatically`);
            }
            if (wiring.needsReview.length > 0) {
              parts.push(`${wiring.needsReview.length} still need${wiring.needsReview.length === 1 ? 's' : ''} manual review (${wiring.needsReview.join(', ')})`);
            }
            if (build.ran) {
              parts.push(build.success ? 'build passed' : 'build FAILED -- see progress log');
            }
            toastSuccess(parts.join('; '));
            if (build.ran && !build.success) {
              // Surface the real build output where it's actually visible
              // -- reuses the existing progress log rather than inventing
              // a new UI surface for this.
              appendProgressLine('build', build.output || 'Build failed.');
              // Phase 10 item 2: offer to try fixing one of the files this
              // same pull just auto-wired -- never any other file.
              renderBuildFixOffers(wiring.applied, build.output || '');
            }
          } else {
            const result = await call('artifact.pull', {
              id: entry.manifest.id,
              remote: entry.remoteName,
              cwd: state.projectDir,
            });
            toastSuccess(`Pulled ${result.manifest.id}`);
          }
        } else {
          const result = await call('artifact.push', {
            id: entry.manifest.id,
            cwd: state.projectDir,
            options: {},
          });
          toastSuccess(`Pushed ${entry.manifest.id}: opened PR #${result.number}`, result.url);
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

  /** Core work: asks the engine to check every pending-push PR's real
   * GitHub state (open / merged / closed-without-merging) and resync
   * anything that got merged, then merges the result back into
   * state.catalog -- shared by both the manual "Check push status" button
   * (handleCheckPushStatus, below) and the background auto-sync timer
   * (onAutoSyncTick), same "core work only, no button busy/toast" split
   * checkForArtifactUpdatesCore already established for version-drift
   * checks. Returns the raw `results` array so callers decide what, if
   * anything, to tell the user. Rethrows on failure so each caller applies
   * its own error handling. */
  async function resolvePendingPushesCore() {
    const results = await call('sync.resolvePendingPushes', { cwd: state.projectDir });

    // A merge resyncs the pristine snapshot server-side, which changes
    // what localStatus should be (edited_locally -> pulled) -- that can
    // only be recomputed by re-running catalog.list (it's derived from
    // files on disk, not something to fake client-side), so do a full,
    // cheap (local-only, no network) catalog refresh whenever anything
    // merged. A closed-without-merge result only needs pendingPr cleared,
    // which is safe to patch in client-side.
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

    return results;
  }

  /** "Check push status" button handler (Detail view, shown only when the
   * selected entry has a pendingPr): runs resolvePendingPushesCore() (which
   * checks every pending push project-wide, not just this one) and reports
   * what happened for THIS entry specifically via toast. Uses the same
   * progress-panel plumbing as a normal pull/push, since this can be a real
   * network call. */
  async function handleCheckPushStatus(entry) {
    const btn = $('detail-check-push-status-btn');
    await withBusy(btn, 'Checking...', async () => {
      await beginProgress();
      try {
        const results = await resolvePendingPushesCore();
        endProgress(true);

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
    $('build-fix-offers').innerHTML = '';
    $('build-fix-offers').hidden = true;
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
    $('build-fix-offers').innerHTML = '';
    $('build-fix-offers').hidden = true;
    if (progressUnlisten) {
      progressUnlisten();
      progressUnlisten = null;
    }
  }

  /** Detail's Back button label per possible `state.detailReturnView` --
   * kept next to openDetail (the only place that sets detailReturnView)
   * so the two stay in sync by construction. */
  const DETAIL_RETURN_LABELS = {
    browse: '← Back to Browse',
    'tag-folder': '← Back to Tag Folder',
    'ui-components': '← Back to UI Components',
  };

  function openDetail(entry) {
    state.selectedKey = entryKey(entry);
    // Captured BEFORE switching to Detail, while state.view still reflects
    // wherever the user actually is right now -- guarded against
    // overwriting with 'detail' itself in case this is ever called while
    // already on Detail (nothing in this app does that today, but a stale
    // 'detail' here would make the Back button loop back to itself).
    if (state.view !== 'detail') {
      state.detailReturnView = state.view;
    }
    $('back-to-browse-btn').textContent =
      DETAIL_RETURN_LABELS[state.detailReturnView] ?? DETAIL_RETURN_LABELS.browse;
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

    const previewSection = $('detail-preview-section');
    if (manifest.kind === 'ui-component') {
      previewSection.hidden = false;
      void loadDetailPreview(entry);
    } else {
      previewSection.hidden = true;
      // loadDetailPreview is never called for a non-ui-component entry,
      // so without this a previous ui-component Detail's still-live
      // iframe/listener (just hidden, not removed) would otherwise sit
      // around indefinitely instead of being cleaned up here.
      clearDetailPreviewListener();
    }

    // Phase 7 (kind: backend-plugin, or any future kind that declares
    // install_params/wiring_actions): shown purely on whether the manifest
    // HAS any of either -- never a kind check, matching this codebase's
    // own established "file/field presence, not kind" convention
    // (preview.png's own gating in push.ts is the precedent this
    // follows). Gated on EITHER, not just install_params: a hypothetical
    // future artifact with wiring_actions but no install_params should
    // still show the outer section (renderInstallParamsSection/
    // renderWiringSection each independently no-op on their own empty
    // list, via the same convention).
    const backendPluginSection = $('detail-backend-plugin-section');
    const hasInstallParams = manifest.install_params && manifest.install_params.length > 0;
    const hasWiringActions = manifest.wiring_actions && manifest.wiring_actions.length > 0;
    if (hasInstallParams || hasWiringActions) {
      backendPluginSection.hidden = false;
      void renderInstallParamsSection(entry);
      void renderWiringSection(entry);
      $('detail-generic-readme-section').hidden = true;
    } else {
      backendPluginSection.hidden = true;
      // Only this artifact's OWN README (never the backend-plugin
      // section's), and only when that section didn't already claim it --
      // avoids ever rendering the same README twice.
      void renderGenericReadmeSection(entry);
    }

    // Phase 11 Detail-view task (design-kit): gated on real content
    // presence -- whether GUIDELINES.md actually exists at the payload
    // root -- never a `manifest.kind === 'template'` check, same
    // "field/file presence, not kind" convention as the backend-plugin
    // gate above. That check itself requires an RPC round-trip (unlike
    // install_params/wiring_actions, which are already on the manifest in
    // hand), so renderTemplateSection decides visibility itself once it
    // resolves -- hidden here first so a previous artifact's tokens/grid
    // don't stay visible while this one's presence check is in flight.
    $('detail-template-section').hidden = true;
    clearDetailTemplateListeners();
    void renderTemplateSection(entry);

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
    const viewPrBtn = $('detail-view-pr-btn');
    const checkPushBtn = $('detail-check-push-status-btn');
    if (entry.pendingPr) {
      pushStatusBlock.hidden = false;
      // The raw URL used to be inlined into this text itself (inert,
      // impossible to click) -- now a real button, via the opener plugin
      // (see showToast's own doc comment for why a plain <a> won't work
      // inside a Tauri webview).
      pushStatusText.textContent =
        `Pushed — PR #${entry.pendingPr.number} is still open, as far as DeliveryOS knows.`;
      viewPrBtn.onclick = () => void openUrl(entry.pendingPr.url);
      checkPushBtn.onclick = () => void handleCheckPushStatus(entry);
    } else {
      pushStatusBlock.hidden = true;
      viewPrBtn.onclick = null;
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

    // Phase 11 Detail-view task: one Light/Dark pair per template section
    // (section-level, not per-card) -- deliberately real infrastructure
    // even though every current design-kit component is visually inert to
    // it (see the caption next to this toggle in index.html and
    // compile.ts's own setTheme doc comment for why).
    templateThemePicker = createSingleChipPicker($('detail-template-theme-toggle'));
    templateThemePicker.setOptions(
      [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
      'light',
    );
    templateThemePicker.onChange((theme) => {
      currentTemplateTheme = theme;
      for (const iframe of detailTemplateIframes) {
        iframe.contentWindow.postMessage({ type: 'setTheme', theme }, '*');
      }
    });
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

  let addNewKindPicker, addNewRemotePicker, templateThemePicker;

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
  // Scan-time-only warnings (import-escape flags, same-batch id-collision
  // notices -- see scan/types.ts's ScanCandidate.warnings) for whichever
  // candidate openAddNewFromScanCandidate last populated the form from.
  // Always empty for a plain "+ Add New" entry -- there's no scan
  // candidate to have warned about anything.
  let pendingCandidateWarnings = [];

  // Phase 10 item 3: the Add New wizard's editable install_params list --
  // pre-filled from a real deliveryos-side scan of the picked payload's
  // actual `process.env.X` usage (pickPayload triggers the detection call
  // below), then freely editable/addable/removable by hand before
  // proposing. Each entry: {key, description, secret, required}.
  let pendingInstallParams = [];

  function renderInstallParamsList() {
    const container = $('install-params-list');
    container.innerHTML = '';

    pendingInstallParams.forEach((param, index) => {
      const row = document.createElement('div');
      row.className = 'install-param-row';
      row.innerHTML = `
        <input type="text" class="install-param-key" placeholder="KEY_NAME" />
        <input type="text" class="install-param-description" placeholder="What this value is for" />
        <label class="install-param-checkbox"><input type="checkbox" class="install-param-secret" /> Secret</label>
        <label class="install-param-checkbox"><input type="checkbox" class="install-param-required" /> Required</label>
        <button type="button" class="btn btn-sm btn-ghost install-param-remove">Remove</button>
      `;

      const keyInput = row.querySelector('.install-param-key');
      const descInput = row.querySelector('.install-param-description');
      const secretInput = row.querySelector('.install-param-secret');
      const requiredInput = row.querySelector('.install-param-required');

      keyInput.value = param.key;
      descInput.value = param.description;
      secretInput.checked = param.secret;
      requiredInput.checked = param.required;

      keyInput.addEventListener('input', () => { pendingInstallParams[index].key = keyInput.value.trim(); });
      descInput.addEventListener('input', () => { pendingInstallParams[index].description = descInput.value; });
      secretInput.addEventListener('change', () => { pendingInstallParams[index].secret = secretInput.checked; });
      requiredInput.addEventListener('change', () => { pendingInstallParams[index].required = requiredInput.checked; });
      row.querySelector('.install-param-remove').addEventListener('click', () => {
        pendingInstallParams.splice(index, 1);
        renderInstallParamsList();
      });

      container.appendChild(row);
    });
  }

  /** Runs the real detection scan against the payload just picked --
   * called from pickPayload, never blocking form entry if it fails (a
   * detection error here shouldn't stop someone from filling out the rest
   * of the form and proposing by hand instead). Covers install_params,
   * stacks, and description together (Phase 10 item 3, extended) -- for
   * every kind, not just backend-plugin-shaped payloads. install_params
   * and stacks always reflect the just-picked payload (re-picking a
   * payload is already a big change); description only fills in when the
   * field is still blank, so it never clobbers something already typed. */
  async function detectAndPrefillMetadata(payloadPath) {
    try {
      const kind = resolveKindFieldValue();
      const detected = await call('artifact.detectMetadata', { payloadPath, kind });
      pendingInstallParams = detected.installParams;
      renderInstallParamsList();
      addNewStacksPicker.setValues(detected.stacks);
      if (detected.description && !$('f-description').value.trim()) {
        $('f-description').value = detected.description;
      }
    } catch (err) {
      // Non-fatal -- the step just starts with empty, fully-manual fields
      // instead of pre-filled ones.
      console.warn('artifact metadata detection failed', err);
    }
  }

  // "Suggest with Claude" -- the first AI-invoking capability in Add New
  // (everything above is pure static analysis). Explicit-click only,
  // never automatic on payload pick, since it costs real latency and a
  // real API call. Cached per (payloadPath, kind) so clicking the second
  // button (Component Type step) after already suggesting from
  // Description doesn't spend a second real call for the same payload --
  // keyed on kind too, not just payloadPath: the wizard lets someone
  // return to the Kind step via Review's Edit links and change kind
  // after already requesting a suggestion for the same payload, and a
  // payload-only cache key would silently hand back a suggestion
  // generated under the wrong kind's prompt framing.
  let pendingSuggestion = null; // { payloadPath, kind, promise } | null

  function runMetadataSuggestion(payloadPath, kind) {
    if (pendingSuggestion && pendingSuggestion.payloadPath === payloadPath && pendingSuggestion.kind === kind) {
      return pendingSuggestion.promise;
    }
    const promise = call('artifact.suggestMetadata', { payloadPath, kind });
    pendingSuggestion = { payloadPath, kind, promise };
    return promise;
  }

  /** Shared handler for both "Suggest with Claude" buttons -- each button
   * only touches the field(s) it's actually associated with, via `fields`
   * (`{updateDescription, updateComponentTypes}`), never the other one:
   * the Component Type step's button must never reach back and overwrite
   * a Description someone already reviewed and hand-edited after an
   * earlier suggestion, just because this click happens to reuse the same
   * cached suggestion. Whichever field(s) this button does own are always
   * overwritten (unlike the passive autofill's "only if blank" rule --
   * clicking this is an explicit request for a fresh suggestion, so it
   * should actually replace what's there). Never blocks/breaks the form
   * on failure -- a toast error and the button returning to normal is the
   * whole failure mode, same as every other detector here. */
  async function suggestMetadataForCurrentPayload(button, fields) {
    if (!pendingPayloadPath) {
      toastError(new Error('Pick a payload first.'));
      return;
    }
    const kind = resolveKindFieldValue();
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Suggesting…';
    try {
      const suggestion = await runMetadataSuggestion(pendingPayloadPath, kind);
      const appliedDescription = fields.updateDescription && !!suggestion.description;
      const appliedComponentTypes = fields.updateComponentTypes
        && suggestion.componentTypes && suggestion.componentTypes.length > 0;
      if (appliedDescription) {
        $('f-description').value = suggestion.description;
      }
      if (appliedComponentTypes) {
        addNewComponentTypesPicker.setValues(suggestion.componentTypes);
      }
      if (!appliedDescription && !appliedComponentTypes) {
        toastError(new Error('Claude had no suggestion for this payload.'));
      }
    } catch (err) {
      toastError(err);
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }

  // Phase 11 item 3: the subjective counterpart to
  // suggestMetadataForCurrentPayload above -- same "cache the in-flight
  // call per payload, so switching between wizard steps and back doesn't
  // spend a second real API call" shape, keyed on payloadPath alone
  // (this prompt has no kind-dependent framing to invalidate on, unlike
  // the metadata one).
  let pendingAntiPatternSuggestion = null; // { payloadPath, promise } | null

  function runAntiPatternSuggestion(payloadPath) {
    if (pendingAntiPatternSuggestion && pendingAntiPatternSuggestion.payloadPath === payloadPath) {
      return pendingAntiPatternSuggestion.promise;
    }
    const promise = call('artifact.suggestAntiPatterns', { payloadPath });
    pendingAntiPatternSuggestion = { payloadPath, promise };
    return promise;
  }

  /** Handler for the Review step's "Suggest with Claude" button --
   * real design-anti-pattern findings, rendered as `.hint-banner-ai`
   * entries (never `.hint-banner`, which item 2's mechanical warnings
   * already own -- see that class's own CSS comment for why the two
   * stay visually distinct). Never blocks/breaks the form on failure,
   * same as every other detector here: a toast error and the button
   * returning to normal is the whole failure mode. */
  async function suggestAntiPatternsForCurrentPayload(button) {
    if (!pendingPayloadPath) {
      toastError(new Error('Pick a payload first.'));
      return;
    }
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Suggesting…';
    const findingsContainer = $('addnew-review-anti-pattern-findings');
    try {
      const findings = await runAntiPatternSuggestion(pendingPayloadPath);
      findingsContainer.innerHTML = '';
      if (findings.length === 0) {
        const banner = document.createElement('div');
        banner.className = 'hint-banner-ai';
        banner.textContent = 'No design anti-patterns found.';
        findingsContainer.appendChild(banner);
      } else {
        for (const finding of findings) {
          findingsContainer.appendChild(renderDesignFixRow(finding, pendingPayloadPath));
        }
      }
    } catch (err) {
      toastError(err);
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }

  /** Phase 11 item 4, the fix step for one specific finding -- directly
   * mirrors `renderBuildFixRow`'s exact structure and flow (ask ->
   * either the model's own honest "can't determine a fix" reason, or
   * the proposed content plus Apply/Discard). Nothing is written to
   * disk, and nothing is logged, unless Apply is clicked. Captures
   * `payloadPath` at render time (not re-read from `pendingPayloadPath`
   * later) so a fix already in flight stays targeted at the right
   * candidate even if the wizard moves on before it resolves. */
  function renderDesignFixRow(finding, payloadPath) {
    const row = document.createElement('div');
    row.className = 'design-fix-row';

    const banner = document.createElement('div');
    banner.className = 'hint-banner-ai';
    banner.textContent = finding;
    row.appendChild(banner);

    const askBtn = document.createElement('button');
    askBtn.type = 'button';
    askBtn.className = 'btn btn-sm btn-ghost';
    askBtn.textContent = 'Want help fixing this? ✨';
    row.appendChild(askBtn);

    const resultEl = document.createElement('div');
    resultEl.className = 'design-fix-result';
    resultEl.hidden = true;
    row.appendChild(resultEl);

    askBtn.addEventListener('click', () => {
      void withBusy(askBtn, 'Asking…', async () => {
        let fix;
        try {
          fix = await call('artifact.requestAntiPatternFix', { payloadPath, finding });
        } catch (err) {
          resultEl.hidden = false;
          resultEl.textContent = `Could not get a fix -- ${err instanceof Error ? err.message : String(err)}`;
          return;
        }

        resultEl.hidden = false;
        resultEl.innerHTML = '';

        if (!fix.file || !fix.fixedFile) {
          const reasonEl = document.createElement('div');
          reasonEl.textContent = fix.reason || 'Claude could not determine a fix for this.';
          resultEl.appendChild(reasonEl);
          return;
        }

        const snippetEl = document.createElement('pre');
        snippetEl.className = 'wiring-action-snippet';
        snippetEl.textContent = fix.fixedFile;
        resultEl.appendChild(snippetEl);

        const actionsEl = document.createElement('div');
        actionsEl.className = 'design-fix-actions';
        const applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'btn btn-sm';
        applyBtn.textContent = 'Apply';
        const discardBtn = document.createElement('button');
        discardBtn.type = 'button';
        discardBtn.className = 'btn btn-sm btn-ghost';
        discardBtn.textContent = 'Discard';
        actionsEl.appendChild(applyBtn);
        actionsEl.appendChild(discardBtn);
        resultEl.appendChild(actionsEl);
        askBtn.hidden = true;

        discardBtn.addEventListener('click', () => {
          // Nothing written, nothing logged -- just clears the offer
          // back to its starting state so it can be asked again.
          resultEl.hidden = true;
          resultEl.innerHTML = '';
          askBtn.hidden = false;
        });

        applyBtn.addEventListener('click', () => {
          void withBusy(applyBtn, 'Applying…', async () => {
            discardBtn.disabled = true;
            try {
              const outcome = await call('artifact.applyAntiPatternFix', {
                cwd: state.projectDir,
                payloadPath,
                file: fix.file,
                fixedFile: fix.fixedFile,
                finding,
                costUsd: fix.costUsd,
                durationMs: fix.durationMs,
              });
              const outcomeEl = document.createElement('div');
              if (outcome.rolledBack) {
                outcomeEl.textContent = `The fix broke the component's preview -- your original file was restored.${outcome.verification.error ? ` (${outcome.verification.error})` : ''}`;
              } else {
                outcomeEl.textContent = 'Fix applied -- the component still compiles.';
              }
              resultEl.innerHTML = '';
              resultEl.appendChild(outcomeEl);
              // The live preview above only refreshes on wizard
              // step-navigation into Review -- nothing re-triggers it on
              // a file edit on its own, so this needs an explicit call
              // to reflect whichever file just actually changed on disk.
              void loadAddNewReviewPreview();
            } catch (err) {
              const errEl = document.createElement('div');
              errEl.textContent = `Could not apply the fix -- ${err instanceof Error ? err.message : String(err)}`;
              resultEl.innerHTML = '';
              resultEl.appendChild(errEl);
            }
          });
        });
      });
    });

    return row;
  }

  /** Real default for Add New's Owner field -- the local machine's own git
   * identity (`git config user.name`), not a guess. Non-fatal on failure
   * (e.g. `state.projectDir` isn't a git repo yet): the field just stays
   * blank for manual entry, same as before this existed. Never overwrites
   * something already typed (checked at the call site via the blank-field
   * guard, same pattern as description autofill). */
  async function prefillOwnerFromGitIdentity() {
    if (!state.projectDir) {
      return;
    }
    try {
      const identity = await call('git.identity', { cwd: state.projectDir });
      if (identity.name && !$('f-owner').value.trim()) {
        $('f-owner').value = identity.name;
      }
    } catch (err) {
      console.warn('git identity lookup failed', err);
    }
  }

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
    pendingCandidateWarnings = [];
    pendingInstallParams = [];
    renderInstallParamsList();
    pendingSuggestion = null;
    pendingAntiPatternSuggestion = null;
    clearAddNewReviewPreviewListener();
    void prefillOwnerFromGitIdentity();
  }

  // ---------- add new: Review step live preview (Phase 6, Phase D) ----------
  //
  // Only meaningful for kind: ui-component -- every other kind's Review
  // step stays exactly the text-only rows renderAddNewReview already
  // builds. Deliberately simpler than Detail's own live preview
  // (loadDetailPreview): no variant tabs, no generated props-controls
  // panel -- Review is a quick "does this actually render" sanity check
  // before proposing, not a place to interactively explore a component,
  // so there's no reason to pay for docgen/variant-switching machinery
  // here at all.

  // Same disconnect-before-replace discipline as
  // detailPreviewMessageHandler/uiComponentsListMessageHandlers --
  // Review can be (re)visited many times in one Add New session (Back,
  // edit a field, Review again), and each visit's compile is async, so a
  // stale listener from an earlier visit must never outlive it.
  let addNewReviewPreviewMessageHandler = null;
  // Guards the same real race loadDetailPreview's own requestId guards:
  // this function `await`s a sidecar call, and a second call (rapid
  // Back-then-Review-again) can start before the first one resolves.
  let addNewReviewPreviewRequestId = 0;

  function clearAddNewReviewPreviewListener() {
    if (addNewReviewPreviewMessageHandler) {
      window.removeEventListener('message', addNewReviewPreviewMessageHandler);
      addNewReviewPreviewMessageHandler = null;
    }
  }

  /** Shows a real live preview on the Review step for a ui-component
   * candidate, compiled straight from wherever pendingPayloadPath
   * currently points (a real project folder, or Scan's synthetic staged
   * directory for a flat-convention component) -- see
   * `preview.compileLocal` (sidecar.ts) and `compileLocalPreview`
   * (resolveArtifactPreview.ts), which compile directly with no
   * remote/id/version and no cache, since this candidate has never been
   * pushed. Hides the whole preview section for every other kind, or
   * when no payload has been chosen yet. */
  async function loadAddNewReviewPreview() {
    const requestId = ++addNewReviewPreviewRequestId;
    const section = $('addnew-review-preview-section');
    const frame = $('addnew-review-preview-frame');
    // Phase 11 item 3's button lives in its own section, gated the exact
    // same way as the live preview above (kind: ui-component + a real
    // payload picked) -- both need real source on disk to do anything.
    const antiPatternSection = $('addnew-review-anti-pattern-section');

    clearAddNewReviewPreviewListener();

    if (resolveKindFieldValue() !== 'ui-component' || !pendingPayloadPath) {
      section.hidden = true;
      antiPatternSection.hidden = true;
      return;
    }
    section.hidden = false;
    antiPatternSection.hidden = false;
    $('addnew-review-anti-pattern-findings').innerHTML = '';
    frame.innerHTML = '<span class="ui-component-preview-loading">Loading preview&hellip;</span>';
    frame.style.width = '';
    frame.style.height = '';

    let result;
    try {
      result = await call('preview.compileLocal', { payloadPath: pendingPayloadPath });
    } catch (err) {
      if (requestId !== addNewReviewPreviewRequestId) return; // superseded while awaiting
      frame.innerHTML = '';
      const placeholder = document.createElement('span');
      placeholder.className = 'ui-component-preview-loading';
      placeholder.textContent = `Preview unavailable -- ${err instanceof Error ? err.message : String(err)}`;
      frame.appendChild(placeholder);
      return;
    }
    if (requestId !== addNewReviewPreviewRequestId) return; // superseded while awaiting

    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-scripts';
    iframe.srcdoc = result.html;
    frame.innerHTML = '';
    frame.appendChild(iframe);

    // Same rAF-coalesced, dynamic width+height sizing as
    // loadUiComponentPreview -- see that function's own comments
    // (clampPreviewWidth/clampPreviewHeight, WIDTH_SAFETY_MARGIN) for the
    // full history of why this isn't simpler.
    let pendingRawWidth = null;
    let pendingRawHeight = null;
    let resizeScheduled = false;

    const handler = (event) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== 'object' || data.type !== 'contentHeight') return;
      pendingRawWidth = data.width;
      pendingRawHeight = data.height;
      if (resizeScheduled) return;
      resizeScheduled = true;
      requestAnimationFrame(() => {
        resizeScheduled = false;
        const clampedWidth = clampPreviewWidth(pendingRawWidth + WIDTH_SAFETY_MARGIN);
        const clampedHeight = clampPreviewHeight(pendingRawHeight);
        frame.style.width = `${clampedWidth}px`;
        frame.style.height = `${clampedHeight}px`;
        iframe.style.width = `${Math.min(pendingRawWidth + WIDTH_SAFETY_MARGIN, clampedWidth)}px`;
        iframe.style.height = `${Math.min(pendingRawHeight, clampedHeight)}px`;
      });
    };
    addNewReviewPreviewMessageHandler = handler;
    window.addEventListener('message', handler);
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
    'roles', 'stacks', 'teams', 'component-types', 'install-target', 'post-install',
    'install-params', 'remote',
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
    'install-params': 'Install-time config',
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
      void loadAddNewReviewPreview();
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

    // Scan-time-only findings (import-escape flags, same-batch id-
    // collision notices -- see scan/types.ts's ScanCandidate.warnings) --
    // non-fatal, but worth a real glance before proposing. Rendered into
    // their own container, a sibling of #addnew-review, not appended
    // inside it -- .wizard-review's own bordered/overflow:hidden box is
    // sized and styled for review-rows specifically, and a differently-
    // styled hint-banner inside that same box would clip/look inconsistent.
    // Only ever non-empty for a Scan-originated ui-component candidate.
    const warningsContainer = $('addnew-review-warnings');
    warningsContainer.innerHTML = '';
    for (const warning of pendingCandidateWarnings) {
      const banner = document.createElement('div');
      banner.className = 'hint-banner';
      banner.textContent = warning;
      warningsContainer.appendChild(banner);
    }

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
      ['install-params', 'Install-time config', pendingInstallParams.length > 0
        ? pendingInstallParams.map((p) => p.key).join(', ')
        : '(none)'],
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
      await detectAndPrefillMetadata(picked);
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
    // A row with a blank key can't become a real install_param entry --
    // filtered out (someone who added a row and never filled in the key
    // clearly didn't mean to keep it) rather than sent as-is and failing
    // manifest validation with a confusing error.
    const installParams = pendingInstallParams.filter((p) => p.key.trim().length > 0);

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
            installParams,
          },
        });
        toastSuccess(`Proposed ${id}: opened PR #${result.number}`, result.url);
        resetAddNewForm();
        // Return to wherever this proposal actually came from -- Scan
        // (when reviewing a discovered candidate) or Browse (direct entry)
        // -- never unconditionally Browse. A real, confirmed UX complaint:
        // proposing from Scan used to always dump back to Browse, losing
        // the rest of that scan's still-unreviewed candidates and forcing
        // a full re-scan (a real network re-fetch) just to keep going.
        if (addNewWizardMode) {
          returnToScan(id);
        } else {
          showView('browse');
        }
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
        const baseSummary = candidate.description || '(no description found -- add one on the next screen)';
        // Only ui-component candidates carry warnings today (an
        // import-escape flag, a same-batch id-collision disambiguation --
        // see scan/types.ts's own doc comment) -- surfaced right in the
        // row so it's visible before clicking through, not just buried in
        // Review's text rows.
        const warningCount = candidate.warnings?.length ?? 0;
        row.querySelector('.summary-text').textContent =
          warningCount > 0
            ? `${baseSummary} (${warningCount} warning${warningCount === 1 ? '' : 's'} -- see Review)`
            : baseSummary;

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
        // Cached so returnToScan can restore this batch later (minus
        // whichever one was just proposed, if any) without a second real
        // network scan -- see that function's own doc comment.
        state.lastScanCandidates = candidates;
        renderScanResults(candidates);
      } catch (err) {
        endProgress(false);
        toastError(err);
      }
    });
  }

  /** Returns to the Scan view from anywhere inside a wizard-mode Add New
   * session (`addNewWizardMode` true -- entered via Scan's own "Review &
   * propose" button), restoring the rest of that scan batch -- whether
   * leaving via the top "Back" link (`proposedId` omitted, nothing to
   * remove) or after a successful propose (`proposedId` set, removed from
   * the restored list) -- rather than either (a) unconditionally dumping
   * back to Browse (the real, confirmed UX complaint this whole flow
   * exists to fix: it lost the rest of a scan's still-unreviewed
   * candidates, forcing a full real re-scan just to keep going), or (b)
   * going to Scan via the normal `showView('scan')` -> `openScanView()`
   * path, which would itself wipe the results list back to empty (it's
   * built for a fresh sidebar visit, not a "come back mid-review" one).
   * Uses `showViewRaw`, not `showView`, specifically to skip that wipe --
   * `scan-remote-select`'s own value/options are untouched either way, so
   * nothing needs restoring there. */
  function returnToScan(proposedId) {
    showViewRaw('scan');
    resetProgressPanel();
    if (proposedId) {
      state.lastScanCandidates = state.lastScanCandidates.filter((c) => c.id !== proposedId);
    }
    renderScanResults(state.lastScanCandidates);
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
    $('addnew-top-back-btn').textContent = '← Back to Scan';
    await loadRemotesForAddNewSelect();

    $('f-id').value = candidate.id;
    addNewKindPicker.selectValue(candidate.kind);
    $('f-description').value = candidate.description ?? '';
    $('f-install-target').value = candidate.installTarget;
    addNewRemotePicker.selectValue(remoteName);

    pendingPayloadPath = candidate.payloadPath;
    $('payload-path-display').textContent = candidate.payloadPath;
    pendingCandidateWarnings = candidate.warnings ?? [];
    // Real metadata detection (Phase 10 item 3, extended) runs here too,
    // not just from the file-picker's own pickPayload -- a scan candidate
    // already has a real, on-disk payload path, and detection is a
    // payload-driven signal that doesn't care how that path was chosen.
    // Previously this only ran for the plain "+ Add New" -> pick-a-file
    // path, so anything opened via Scan silently skipped install_params/
    // stacks/description/owner autofill entirely -- a real gap, not a
    // deliberate one (unlike roles/teams/componentTypes below, which stay
    // blank on purpose).
    await detectAndPrefillMetadata(candidate.payloadPath);
    // Jump straight to Review -- everything a scan candidate can prefill is
    // already filled in (roles/teams/componentTypes are deliberately left
    // blank for manual review, same as before), so forcing a click through
    // 9 empty-looking steps just to reach Propose would be worse than the
    // old flat form, not better. The Edit button on any review row still
    // jumps back to fill in something more, roles/teams/componentTypes
    // included.
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
   * than nagging the user.
   *
   * Also polls every pending push's real PR status the same way
   * (resolvePendingPushesCore) -- closing a real, named gap: today's loop
   * was Browse -> Pull -> edit -> Push -> go check GitHub by hand -> merge
   * -> Pull again, with that GitHub round-trip being the one manual step
   * version-drift checking never needed. `resolvePendingPushes` returns
   * `[]` immediately (no network call at all) when nothing's pending, so
   * this costs nothing on every tick for a project with no open pushes --
   * no new architecture, just a second thing the same reentrancy-guarded
   * tick checks, exactly as docs/product-roadmap-vision.md's own "closing
   * the GitHub loop" section describes. Only toasts on a real change
   * (something merged or got closed without merging) -- a pending push
   * that's simply still open stays silent, same "don't nag" principle as
   * the version-drift half above. */
  async function onAutoSyncTick() {
    if (autoSyncInFlight) return; // reentrancy guard: skip this tick if a check is already running
    if (!state.projectDir) return; // nothing to check without a project folder
    autoSyncInFlight = true;
    try {
      // Order matters here: resolvePendingPushesCore() runs FIRST because it
      // can trigger a full loadCatalog() reload (on a real merge) that
      // replaces state.catalog wholesale -- catalog.list's own entries carry
      // no availableVersion at all, that's a purely client-side annotation
      // checkForArtifactUpdatesCore patches on afterward. Running the
      // reload-capable call first, then the in-place-patch-only call second,
      // means whichever one runs last is always the one left standing --
      // reversing this order would let a same-tick merge silently wipe that
      // tick's own just-reported drift annotations from state.catalog until
      // the next tick, 20 minutes later, quietly re-populated them.
      const pushResults = await resolvePendingPushesCore();
      const merged = pushResults.filter((r) => r.merged);
      const closed = pushResults.filter((r) => !r.merged && r.state === 'closed');
      if (merged.length > 0) {
        toastSuccess(
          merged.length === 1
            ? `PR #${merged[0].prNumber} for "${merged[0].id}" was merged.`
            : `${merged.length} pending PRs were merged.`,
        );
      }
      if (closed.length > 0) {
        toastError(new Error(
          closed.length === 1
            ? `PR #${closed[0].prNumber} for "${closed[0].id}" was closed without merging.`
            : `${closed.length} pending PRs were closed without merging.`,
        ));
      }

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
    $('ui-components-pull-all-btn').addEventListener('click', () => void handleUiComponentsPullAll());
    $('back-to-browse-btn').addEventListener('click', () => {
      // Tag Folder needs its own dedicated re-open (category + value), not
      // just a generic showView -- 'tags' alone would land on the
      // Browse-by-tag PICKER, not the specific folder Detail was opened
      // from. Every other destination ('browse', 'ui-components') already
      // has its own showView-registered per-view load, so a plain
      // showView(...) is correct for those.
      if (state.detailReturnView === 'tag-folder') {
        openTagFolder(state.activeTagCategory, state.activeTagValue);
      } else {
        showView(state.detailReturnView ?? 'browse');
      }
    });
    // Returns to the SAME design-kit-shaped artifact's own Detail view
    // (never just Browse) -- openComponentDetail always sets
    // state.componentDetailReturnEntry right before navigating here.
    $('back-to-component-grid-btn').addEventListener('click', () => {
      clearComponentDetailListener();
      openDetail(state.componentDetailReturnEntry);
    });
    // Individually wired (not the generic `[data-view]` loop above) since
    // its destination depends on how Add New was entered -- Scan's own
    // "Review & propose" (wizard mode) needs returnToScan's restore-the-
    // batch behavior, not a plain showView('scan') that would wipe the
    // results back to empty (see returnToScan's own doc comment).
    $('addnew-top-back-btn').addEventListener('click', () => {
      if (addNewWizardMode) {
        returnToScan();
      } else {
        showView('browse');
      }
    });

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
    $('install-params-add-btn').addEventListener('click', () => {
      pendingInstallParams.push({ key: '', description: '', secret: false, required: true });
      renderInstallParamsList();
    });
    $('suggest-metadata-btn').addEventListener('click', (ev) => void suggestMetadataForCurrentPayload(
      ev.currentTarget,
      { updateDescription: true, updateComponentTypes: true },
    ));
    $('suggest-component-types-btn').addEventListener('click', (ev) => void suggestMetadataForCurrentPayload(
      ev.currentTarget,
      { updateDescription: false, updateComponentTypes: true },
    ));
    $('addnew-review-suggest-anti-patterns-btn').addEventListener('click', (ev) => void suggestAntiPatternsForCurrentPayload(
      ev.currentTarget,
    ));

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
