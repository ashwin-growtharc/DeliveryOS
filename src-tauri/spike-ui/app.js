// DeliveryOS desktop UI: vanilla JS, single-page, no framework/build step.
// State + view-switching + render functions for Browse / Detail / Add-new /
// Settings. Every engine call goes through `DeliveryOS.call` (sidecar.js),
// which spawns a fresh sidecar process per call -- so every button that
// triggers one is disabled with a "Working..." label for the duration.
(function () {
  const call = window.DeliveryOS.call;
  const { invoke } = window.__TAURI__.core;
  const { open: openDialog, confirm: confirmDialog } = window.__TAURI__.dialog;
  const { revealItemInDir, openUrl } = window.__TAURI__.opener;
  const { listen } = window.__TAURI__.event;
  const { check } = window.__TAURI__.updater;
  const { relaunch } = window.__TAURI__.process;

  const PROJECT_DIR_KEY = 'deliveryos.projectDir';
  const THEME_KEY = 'deliveryos.theme';

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

  /** The human label for a localStatus, never `undefined`.
   *
   * Every call site used to index STATUS_LABELS directly, so any status the
   * engine reports outside these five keys rendered the literal string
   * "undefined" into a badge -- and injected an unknown class alongside it,
   * so the badge lost its styling too. localStatus is computed engine-side
   * and can gain values without this map being updated in the same change,
   * which is exactly the kind of drift a fallback exists for. Showing the raw
   * status is more useful than showing nothing: it is at least the truth, and
   * it names the missing key for whoever has to add it. */
  function statusLabel(status) {
    return STATUS_LABELS[status] ?? String(status ?? 'Unknown');
  }

  // ---------- kind icon (Browse's cards, Detail, Tag Folder/Scan rows) ----------
  //
  // A small, distinct mark per kind, plus a warm accent tint -- never the
  // AI-reserved purple/cyan tokens, matching the rule already applied
  // elsewhere in this app. Kind stays open-ended (z.string() in the
  // manifest schema, not a closed enum -- see ARCHITECTURE.md), so this is
  // a convenience lookup, not a whitelist: any kind not listed here falls
  // back to a neutral diamond glyph rather than a broken/missing icon.
  // skill/command's fg used to be hardcoded hex (#8A5A2B / #2E5E82) --
  // fine paired with sand-100/sky-100's own light-mode value, but those
  // two tokens get a real DARK tint for dark mode (style.css's dark-mode
  // blocks) while a fixed medium-brown/medium-blue text does not, dropping
  // to ~2.2-2.5:1 contrast against the now-dark background (confirmed).
  // --icon-fg-warm/--icon-fg-cool are the adaptive counterparts, defined
  // alongside sand-100/sky-100 in style.css so the pairing stays legible
  // in both themes. template/rust/javascript's fg stays hardcoded (below,
  // and in STACK_ICON) since their bg (--gold-500) is a fixed, standalone
  // saturated accent left unchanged across themes on purpose -- the fixed
  // dark text pairs with it fine regardless of theme.
  const KIND_ICON = {
    agent: { icon: 'i-kind-agent', bg: 'var(--sage-100)', fg: 'var(--icon-fg-sage)' },
    skill: { icon: 'i-kind-skill', bg: 'var(--sand-100)', fg: 'var(--icon-fg-warm)' },
    command: { icon: 'i-kind-command', bg: 'var(--sky-100)', fg: 'var(--icon-fg-cool)' },
    // Uses --ink for the same reason `doc` below does: --primary-700 is
    // deliberately FIXED (brand-fill only), so pairing it with a background
    // that adapts leaves this one swatch unreadable in the other theme.
    // --sage-50 had additionally never been given a dark value at all, so
    // this tile rendered near-white with navy text on a dark page.
    rule: { icon: 'i-kind-rule', bg: 'var(--sage-50)', fg: 'var(--ink)' },
    template: { icon: 'i-kind-template', bg: 'var(--gold-500)', fg: '#6B4A00' },
    // A shade deeper than skill's own sand-100 -- stays in the same warm
    // family (backend-plugin reads as "a utility kind," same spirit as
    // skill) while remaining visually distinct at a glance, without
    // introducing a new bg/fg token pair just for this one entry.
    'backend-plugin': { icon: 'i-kind-backend-plugin', bg: 'var(--sand-200)', fg: 'var(--icon-fg-warm)' },
    // Uses --ink (adaptive text), not --primary-700 (deliberately FIXED,
    // brand-fill-only) -- surface-inset itself adapts to dark mode, and
    // pairing it with fixed navy text has the exact same contrast problem
    // skill/command's fg had, just via a token reference instead of a
    // hardcoded hex.
    doc: { icon: 'i-kind-doc', bg: 'var(--surface-inset)', fg: 'var(--ink)' },
  };
  const KIND_ICON_FALLBACK = { icon: 'i-kind-default', bg: 'var(--surface-inset)', fg: 'var(--ink)' };

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
    java: { icon: 'i-lang-java', bg: 'var(--sand-100)', fg: 'var(--icon-fg-warm)' },
    rust: { icon: 'i-lang-rust', bg: 'var(--gold-500)', fg: '#6B4A00' },
    typescript: { text: 'TS', bg: 'var(--sky-100)', fg: 'var(--icon-fg-cool)' },
    javascript: { text: 'JS', bg: 'var(--gold-500)', fg: '#6B4A00' },
    go: { text: 'Go', bg: 'var(--sky-100)', fg: 'var(--icon-fg-cool)' },
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
      return { bg: 'var(--surface-inset)', fg: 'var(--ink)', html: '<svg><use href="#i-tag"/></svg>' };
    }
    if (category === 'roles') {
      return { bg: 'var(--sage-100)', fg: 'var(--sage-700)', html: '<svg><use href="#i-role"/></svg>' };
    }
    // 'teams' (displayed as "project")
    return { bg: 'var(--sky-100)', fg: 'var(--icon-fg-cool)', html: '<svg><use href="#i-folder"/></svg>' };
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

  /** Scrolls the content region back to its top.
   *
   * Both view-switching paths used to call window.scrollTo(0, 0). That worked
   * while the whole PAGE scrolled -- but the page no longer scrolls: the shell
   * is pinned to the viewport and `.content-scroll` is the one scrolling
   * region, so scrolling the window is now a silent no-op. Without this,
   * switching views would land you wherever the previous view was scrolled to,
   * which is exactly the bug showView's own comment records having fixed
   * once already. */
  function scrollContentToTop() {
    const region = document.querySelector('.content-scroll');
    if (region) region.scrollTop = 0;
    // Belt and braces for any context where the page itself can still scroll.
    window.scrollTo(0, 0);
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

  /** Renders a real error state into `container`, replacing its contents.
   *
   * The app had no error state at all. Every failed load fired a toast and
   * then set its list to [], so the screen showed "No artifacts match." --
   * a failure was indistinguishable from an empty catalog, and the toast
   * carrying the actual reason vanished after five seconds. The design kit
   * this product ships says exactly this is wrong: "EmptyState is for
   * 'nothing here yet', never for a failure -- a failed fetch is ErrorState."
   *
   * `detail` is the engine's own message, shown verbatim rather than
   * paraphrased -- the whole point of the sidecar's error contract is that a
   * real git or filesystem error reaches the user intact. `onRetry`, when
   * given, renders the one action that can actually help; the kit's guidance
   * is to omit it when retrying cannot (a 404), so callers decide. */
  function renderErrorState(container, title, detail, onRetry) {
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'error-state';
    wrap.setAttribute('role', 'alert');

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'glyph');
    icon.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-alert');
    icon.appendChild(use);
    wrap.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'error-state-body';
    const titleEl = document.createElement('div');
    titleEl.className = 'error-state-title';
    titleEl.textContent = title;
    body.appendChild(titleEl);

    if (detail) {
      const detailEl = document.createElement('div');
      detailEl.className = 'error-state-detail';
      // textContent, not innerHTML: this string comes from the engine and can
      // contain anything a git or filesystem error contains.
      detailEl.textContent = detail;
      body.appendChild(detailEl);
    }

    if (onRetry) {
      const actions = document.createElement('div');
      actions.className = 'error-state-actions';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn btn-sm';
      retry.textContent = 'Try again';
      retry.addEventListener('click', () => void onRetry());
      actions.appendChild(retry);
      body.appendChild(actions);
    }

    wrap.appendChild(body);
    container.appendChild(wrap);
  }

  /** Fills `container` with a shape-matched loading skeleton.
   *
   * `shape` names what is coming, so the placeholder resembles it:
   *   'chips'  a row of short status pills   (connection status)
   *   'fields' stacked label + input pairs   (install params / configuration)
   *   'cards'  a few tall blocks             (wiring actions)
   *
   * This replaces three separate "spinner + Loading..." blocks that used to
   * appear simultaneously when opening one artifact. Their markup was
   * identical -- the code comments even say "same pattern" -- but they
   * rendered into three differently-styled containers, so a single action
   * produced three competing spinners in three places and no sense of what
   * was actually loading. Skeletons recede instead of competing, and because
   * they are shaped like the real content nothing jumps when it arrives. */
  function renderSkeleton(container, shape, count = 3) {
    container.innerHTML = '';
    const group = document.createElement('div');
    group.className = 'skeleton-group';
    // Announced as busy rather than as content: a screen reader should hear
    // "loading", not read out a pile of empty placeholder boxes.
    group.setAttribute('aria-busy', 'true');
    group.setAttribute('aria-live', 'polite');
    group.setAttribute('aria-label', 'Loading');

    if (shape === 'chips') {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = 'var(--space-2)';
      for (let i = 0; i < count; i += 1) {
        const chip = document.createElement('span');
        chip.className = 'skeleton skeleton-line';
        chip.style.width = `${70 + i * 24}px`;
        chip.style.height = '20px';
        chip.style.marginBottom = '0';
        row.appendChild(chip);
      }
      group.appendChild(row);
    } else if (shape === 'fields') {
      for (let i = 0; i < count; i += 1) {
        const label = document.createElement('div');
        label.className = 'skeleton skeleton-line';
        label.style.width = '120px';
        group.appendChild(label);
        const input = document.createElement('div');
        input.className = 'skeleton skeleton-block';
        input.style.height = '36px';
        group.appendChild(input);
      }
    } else {
      for (let i = 0; i < count; i += 1) {
        const block = document.createElement('div');
        block.className = 'skeleton skeleton-block';
        group.appendChild(block);
      }
    }
    container.appendChild(group);
  }

  /** The message text out of any thrown value, for display. */
  function errorText(err) {
    return err instanceof Error ? err.message : String(err);
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
    // The button KEEPS its own label and gains a spinner. It used to have its
    // label replaced with a generic word, which is why several buttons in
    // flight at once all read "Working..." and you could not tell which action
    // was actually running -- reported directly as "3 different loading
    // buttons in a single screen which I don't know what is loading".
    //
    // There were 28 call sites using 11 different busy labels, five of them
    // the contentless "Working...", and the same word spelled two ways
    // ('Checking...' four times, 'Checking…' once). Keeping the real
    // label makes all of that moot: "Pull" stays "Pull" and simply shows it is
    // working, so the running action names itself.
    //
    // `busyLabel` is still accepted -- every call site passes one -- but it is
    // now used only for assistive tech, via aria-label, rather than being
    // shown. That keeps a screen reader's announcement specific without
    // making the visible UI ambiguous.
    if (button.dataset.idleLabel === undefined) {
      button.dataset.idleLabel = button.textContent;
    }
    button._busyCount = (button._busyCount || 0) + 1;

    if (button._busyCount === 1) {
      button.disabled = true;
      // aria-busy is the standard signal that this control's content is being
      // updated; the label stays readable rather than being swapped out.
      button.setAttribute('aria-busy', 'true');
      if (busyLabel) {
        button.dataset.idleAriaLabel = button.getAttribute('aria-label') ?? '';
        button.setAttribute('aria-label', `${button.dataset.idleLabel.trim()} — ${busyLabel}`);
      }
      const spinner = document.createElement('span');
      spinner.className = 'spinner btn-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      button.prepend(spinner);
    }

    try {
      return await fn();
    } finally {
      button._busyCount -= 1;
      if (button._busyCount <= 0) {
        button._busyCount = 0;
        button.disabled = false;
        button.removeAttribute('aria-busy');
        const restored = button.dataset.idleAriaLabel;
        if (restored !== undefined) {
          if (restored) button.setAttribute('aria-label', restored);
          else button.removeAttribute('aria-label');
          delete button.dataset.idleAriaLabel;
        }
        button.querySelector('.btn-spinner')?.remove();
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
    hideProgressPanel();
    for (const section of document.querySelectorAll('.view')) {
      section.hidden = section.id !== `view-${view}`;
    }
    for (const btn of document.querySelectorAll('.sidebar-item')) {
      btn.classList.toggle('active', btn.dataset.view === view);
    }
    // Neither this nor showViewRaw ever reset scroll position -- found
    // by direct user report: if the previous view was scrolled down,
    // whatever's just been switched to opens still scrolled to that same
    // position instead of at its own top (most visible on Detail, whose
    // content is now much shorter per-tab than the old one-long-scroll
    // layout, so landing mid-page reads as genuinely broken rather than
    // just "a bit off").
    scrollContentToTop();
    if (view === 'browse') {
      void loadCatalog();
    } else if (view === 'tags') {
      renderTagsPage();
    } else if (view === 'ui-components') {
      renderUiComponentsPage();
    } else if (view === 'starter-kits') {
      renderStarterKitsPage();
    } else if (view === 'backend-plugins') {
      renderBackendPluginsPage();
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
        // Cleared on success, so a recovered load stops showing the old error.
        state.catalogError = null;
      } catch (err) {
        toastError(err);
        // Recorded, not just toasted. Setting the catalog to [] and relying on
        // a 5-second toast to explain why is how a failed load ended up
        // looking exactly like an empty catalog.
        state.catalogError = errorText(err);
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
        state.catalogError = null;
      } catch (err) {
        toastError(err);
        state.catalogError = errorText(err);
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
        const labelA = statusLabel(displayStatus(a));
        const labelB = statusLabel(displayStatus(b));
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

  // ---------- Starter Kits / Backend Plugins (single-kind sidebar pages) ----------
  //
  // Same idea as UI Components -- a sidebar shortcut into one kind of the
  // catalog -- but neither `template` nor `backend-plugin` has a live-
  // preview story or a sub-dimension worth its own tab row, so both share
  // one plain-grid renderer instead of two more bespoke pages.

  function visibleKindEntries(kind) {
    return applyRemoteFilter(state.catalog.filter((entry) => entry.manifest.kind === kind));
  }

  /** Populates one kind-scoped page (count, grid, empty state, Pull all)
   * from `ids`, an { noFolder, count, grid, empty, pullAllBtn } map of
   * element ids -- see view-starter-kits/view-backend-plugins in
   * index.html for the two real call sites. */
  function renderKindListPage(kind, ids) {
    $(ids.noFolder).hidden = Boolean(state.projectDir);

    const entries = sortEntries(visibleKindEntries(kind));
    $(ids.count).textContent = `${entries.length} artifact${entries.length === 1 ? '' : 's'}`;

    const grid = $(ids.grid);
    grid.innerHTML = '';
    $(ids.empty).hidden = entries.length !== 0;

    for (const entry of entries) {
      grid.appendChild(buildResCard(entry));
    }

    renderPullAllButton($(ids.pullAllBtn), entries);
  }

  const STARTER_KITS_IDS = {
    noFolder: 'starter-kits-no-folder',
    count: 'starter-kits-count',
    grid: 'starter-kits-grid',
    empty: 'starter-kits-empty',
    pullAllBtn: 'starter-kits-pull-all-btn',
  };
  const BACKEND_PLUGINS_IDS = {
    noFolder: 'backend-plugins-no-folder',
    count: 'backend-plugins-count',
    grid: 'backend-plugins-grid',
    empty: 'backend-plugins-empty',
    pullAllBtn: 'backend-plugins-pull-all-btn',
  };

  function renderStarterKitsPage() {
    renderKindListPage('template', STARTER_KITS_IDS);
  }

  function renderBackendPluginsPage() {
    renderKindListPage('backend-plugin', BACKEND_PLUGINS_IDS);
  }

  async function handleStarterKitsPullAll() {
    const btn = $(STARTER_KITS_IDS.pullAllBtn);
    const pullable = visibleKindEntries('template').filter(isBulkPullable);
    await bulkPull(pullable, btn, () => renderStarterKitsPage());
  }

  async function handleBackendPluginsPullAll() {
    const btn = $(BACKEND_PLUGINS_IDS.pullAllBtn);
    const pullable = visibleKindEntries('backend-plugin').filter(isBulkPullable);
    await bulkPull(pullable, btn, () => renderBackendPluginsPage());
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
      // `row` can have been detached from the DOM (a category-tab switch
      // re-renders the whole list via renderUiComponentsList's own
      // `container.innerHTML = ''`) while this call was still in flight --
      // without this check, a stale resolution would still spawn a real,
      // live iframe and register a real window-level message listener for
      // a row nothing shows anymore, which then keeps running and firing
      // resize messages until some LATER re-render happens to sweep it up
      // via uiComponentsListMessageHandlers. Nothing useful to attach to
      // anymore, so just stop here.
      if (!row.isConnected) {
        return;
      }
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

  // Same request-token-guard discipline, for renderWiringSection's own
  // async artifact.resolveWiringActions call.
  let wiringRequestId = 0;

  // Phase 11 Detail-view task: same request-token-guard discipline, for
  // renderDesignAndComponentsSections's own async artifact.parseGuidelines/
  // artifact.listPayloadComponents/preview.compilePayloadComponent calls.
  let detailTemplateRequestId = 0;

  // Same request-token-guard discipline, for renderDocumentationTab's own
  // async artifact.readPayloadFile calls (README.md and GUIDELINES.md).
  let documentationRequestId = 0;

  // Same request-token-guard discipline, for renderRoutesSection's own
  // async artifact.parseRoutes call.
  let routesRequestId = 0;

  // Same request-token-guard discipline, for renderSourceDriftSection's
  // own async artifact.readPayloadFile presence check (a separate,
  // independent check from any of the drift check's own button-click
  // calls, which use withBusy on the button itself instead).
  let sourceDriftRequestId = 0;

  // Same request-token-guard discipline, for renderActivitySection's own
  // async artifact.readWiringMergeLog call (Phase 12: a visible audit
  // trail for the wiring-merge log).
  let activityRequestId = 0;

  // Same request-token-guard discipline, for renderInstallParamsSection's
  // own async artifact.readInstallParamValues call (Phase 13: pre-filling
  // the Configuration form from a REAL already-existing .env.local value,
  // not just the manifest's own default).
  let installParamsRequestId = 0;

  // Same request-token-guard discipline, for renderConnectionStatusPanel's
  // own async artifact.readInstallParamValues/resolveWiringActions calls
  // (Phase 21).
  let connectionStatusRequestId = 0;

  // Array-based counterpart to detailPreviewMessageHandler, for
  // renderMarkdownToSandboxedIframe's own iframes -- a single Documentation
  // tab can hold more than one (README.md AND GUIDELINES.md's own prose,
  // each in its own iframe), same "one listener per live iframe, torn down
  // before the next render" discipline as clearDetailTemplateListeners.
  let markdownIframeMessageHandlers = [];

  /** Every markdown iframe currently on screen, as { container, markdownText }.
   *
   * buildMarkdownDocument bakes the theme into the iframe's srcdoc at RENDER
   * time -- it has to, because a sandboxed document cannot read the parent
   * page's custom properties (see that function's own comment). So toggling
   * the app theme did nothing to an already-open README: it stayed in the old
   * theme until you navigated away and came back. Keeping the source markdown
   * here lets toggleTheme re-render them in place. */
  let mountedMarkdownIframes = [];

  function clearMarkdownIframeListeners() {
    mountedMarkdownIframes = [];
    for (const handler of markdownIframeMessageHandlers) {
      window.removeEventListener('message', handler);
    }
    markdownIframeMessageHandlers = [];
  }

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
  // Lazy-loads the grid the same way uiComponentsListObserver already does
  // for the main UI Components list: a card's own compile call only fires
  // once it actually scrolls into view, instead of every component in the
  // design kit compiling at once the moment the tab opens. Re-created (via
  // clearDetailTemplateListeners) each time the grid is rebuilt, same
  // "disconnect the old one before observing a new set of cards" discipline
  // as uiComponentsListObserver.
  let detailTemplateObserver = null;

  // The template grid's currently-selected theme ('light' or 'dark') --
  // read by each card's handler on the harness's own 'ready' message (see
  // loadTemplateComponentPreview), so a card that finishes loading AFTER
  // the toggle was already flipped still self-syncs correctly with no
  // queuing logic needed.
  // Initialised from the app's REAL current theme, not a hardcoded 'light'.
  // Hardcoding it meant that running the app in dark mode and opening a
  // template's Components tab rendered every preview light -- sitting right
  // next to its own second Light/Dark switch, which is how the mismatch was
  // visible without being obviously a bug. Assigned in initTheme() rather
  // than here, since getEffectiveTheme reads the DOM.
  let currentTemplateTheme = 'light';

  // Note: renderBuildFixRow/renderWiringMergeRow each keep their OWN
  // request-id counter as a variable local to that specific row's closure
  // (declared inside the render function itself, not here) -- a single
  // shared module-level counter used to guard EVERY row on the page at
  // once, which meant clicking "Ask" on one row while a DIFFERENT row's
  // request was still in flight silently discarded that other row's
  // result the moment it resolved (both rows increment the same counter,
  // so the first row's captured requestId immediately goes stale) --
  // even though the two rows target unrelated files with nothing to do
  // with each other. A per-row counter still protects against the
  // original, intended case (the SAME row's own request being superseded
  // by a second click before the first reply arrives) without that
  // cross-row collision.

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
   * renderDesignAndComponentsSections (about to replace them with a new
   * set) and from renderDetail when switching to an artifact with no
   * GUIDELINES.md (which never calls that function's grid-building path
   * at all, so without this the previous artifact's iframes/listeners
   * would otherwise just sit there, hidden but still live). */
  function clearDetailTemplateListeners() {
    for (const handler of detailTemplateMessageHandlers) {
      window.removeEventListener('message', handler);
    }
    detailTemplateMessageHandlers = [];
    detailTemplateIframes = [];
    if (detailTemplateObserver) {
      detailTemplateObserver.disconnect();
      detailTemplateObserver = null;
    }
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
   * kind: backend-plugin): a required-config checklist for every declared
   * install_param, collecting the PROJECT's own values -- never the
   * artifact's own defaults, which only ever seed the form as a starting
   * point, exactly like Add New's own auto-scaffold placeholders are a
   * starting point, not a finished value. Shown only when
   * `manifest.install_params` is non-empty -- see renderDetail. (The
   * provenance badge and README used to render here too -- the former is
   * now always-visible regardless of kind, the latter lives in the
   * Documentation tab alongside every other kind's README, see
   * renderDetail/renderDocumentationTab.) */
  /** Phase 12: the persistent counterpart to the pullAndAutoWire toast --
   * that toast (see runArtifactAction) fades after a few seconds, so
   * without this the healthSummary it showed would be gone the moment a
   * user navigated away and back into Configuration to actually act on
   * it (e.g. to fill in a still-missing install param). Only ever shows
   * `lastAutoWireSummary` when its stashed key matches THIS entry -- a
   * stale summary from a previously-viewed artifact must never leak into
   * a different one's Detail view. */
  function renderPostInstallHealthBanner(entry) {
    const banner = $('detail-post-install-health-banner');
    if (lastAutoWireSummary && lastAutoWireSummary.key === entryKey(entry)) {
      banner.textContent = lastAutoWireSummary.summary;
      banner.hidden = false;
    } else {
      banner.hidden = true;
      banner.textContent = '';
    }
  }

  /** Phase 21: "is this thing actually connected and working" at a glance,
   * any time Detail is reopened -- not just in the moment right after a
   * pull/merge/fix, which is the only time renderPostInstallHealthBanner
   * above ever has anything to show (it's keyed off an in-memory value
   * from THIS session's last action, gone the moment the app restarts or
   * a different artifact was viewed in between). This recomputes the real
   * current state from scratch every time: signed status straight off the
   * manifest already in hand, install_params fulfillment and wiring
   * resolution via the same RPCs the Configuration/Wiring sections already
   * call. Only shown for a PULLED artifact that actually has
   * install_params or wiring_actions to report on -- see renderDetail.
   *
   * Deliberately does NOT run the project's build automatically on every
   * Detail open (a real build isn't free, and this can be reopened far
   * more often than a pull happens) -- "Verify build" is an explicit,
   * on-demand action via the new artifact.verifyBuild RPC, same
   * runProjectBuild every other build-verify step already uses. */
  /**
   * "How this works": a plain-language, always-the-same-shape walkthrough
   * of the install lifecycle, written for someone who has never used
   * DeliveryOS before and doesn't know what a chip reading "Wired (0/4)"
   * even means. Deliberately separate from renderConnectionStatusPanel
   * right below it: that panel is the LIVE, numeric status ("3/3
   * configured"); this one is the static, always-true explanation of
   * what those numbers are even about. Keeping them apart means this
   * function needs no RPC calls at all -- every row is either always true
   * for an artifact with this shape, or true-when-it-happens (a build
   * break, a file that already existed), never something that needs a
   * live check to phrase correctly.
   *
   * Gated on real presence (install_params/wiring_actions/post_install),
   * same "data, not kind" convention as every other Detail section --
   * a plain `ui-component`/`template` pull has none of this lifecycle at
   * all, so the panel simply doesn't apply.
   */
  function renderLifecycleExplainer(entry) {
    const { manifest } = entry;
    const panel = $('detail-lifecycle-explainer');
    const hasInstallParams = manifest.install_params && manifest.install_params.length > 0;
    const hasWiringActions = manifest.wiring_actions && manifest.wiring_actions.length > 0;
    const hasSecrets = hasInstallParams && manifest.install_params.some((p) => p.secret);
    const hasLifecycle = hasInstallParams || hasWiringActions || !!manifest.post_install;

    if (!hasLifecycle) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;

    const jump = (tab, scrollTo) => () => {
      goToDetailTab(tab);
      $(scrollTo)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    // Plain language throughout -- no "install_params"/"wiring_actions"/
    // "manifest," the same words a non-technical reader would use for
    // what's actually happening, not this codebase's own internal names
    // for it.
    const steps = [
      {
        show: hasInstallParams || !!manifest.signature,
        title: 'Before anything is copied in',
        description: manifest.signature
          ? "Its signature is checked first -- if it's been tampered with, nothing lands. Then you're asked for anything it needs (like a password or a URL) through a plain form, not a config file you have to hand-edit."
          : "You're asked for anything it needs (like a password or a URL) through a plain form, not a config file you have to hand-edit.",
        goTo: hasInstallParams ? jump('configuration', 'detail-install-params-fields') : null,
      },
      {
        show: hasWiringActions,
        title: 'New files get added for you',
        description: 'Any new file this needs gets created automatically. If it changes how your project builds, that gets checked right away.',
        goTo: jump('configuration', 'detail-wiring-actions'),
      },
      {
        show: hasWiringActions,
        title: "If a change breaks your build",
        description: "You'll be shown a suggested fix in plain text. Nothing is applied until you say so, and if the fix doesn't actually fix it, your original file comes right back automatically.",
        goTo: null,
      },
      {
        show: hasWiringActions,
        title: 'If a file already exists',
        description: "It's never silently overwritten -- you're shown a suggested merge to review first, with the same automatic undo if it doesn't work out.",
        goTo: jump('configuration', 'detail-wiring-actions'),
      },
      {
        show: hasInstallParams || hasWiringActions,
        title: 'A plain summary afterward',
        description: "You'll see one summary of what worked and what's still on you -- not a wall of logs to decode.",
        goTo: null,
      },
      {
        show: hasWiringActions,
        title: 'Everything is recorded',
        description: 'Every suggested fix or merge -- applied or not -- is saved, so you can look back later at exactly what happened and why.',
        goTo: jump('activity', 'detail-activity-entries'),
      },
      {
        show: true,
        title: 'Removing it later',
        description: 'One click cleanly removes what this added -- it never leaves orphaned files behind.',
        goTo: null,
      },
      {
        show: hasSecrets,
        title: 'Your secrets stay yours',
        description: "If a value you type isn't excluded from git yet, you're warned immediately -- it's never silently left exposed.",
        goTo: null,
      },
      {
        show: hasInstallParams,
        title: 'Changing a value later',
        description: 'Go to Configuration any time to update what you typed in -- no need to remove and pull again.',
        goTo: jump('configuration', 'detail-install-params-fields'),
      },
      {
        show: hasInstallParams,
        title: 'Reopening this form',
        description: "It remembers what you already filled in -- you won't have to retype anything that's already set.",
        goTo: jump('configuration', 'detail-install-params-fields'),
      },
      {
        show: true,
        title: 'When a new version comes out',
        description: "Updating applies the real changes -- including removing files the new version no longer needs -- and refuses instead of guessing if you've edited something yourself.",
        goTo: null,
      },
    ];

    const list = $('detail-lifecycle-steps');
    list.innerHTML = '';
    for (const step of steps.filter((s) => s.show)) {
      const li = document.createElement('li');
      li.className = 'lifecycle-step';
      const titleRow = document.createElement('div');
      titleRow.className = 'lifecycle-step-title';
      titleRow.textContent = step.title;
      if (step.goTo) {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'lifecycle-step-link';
        link.textContent = 'View →';
        link.addEventListener('click', step.goTo);
        titleRow.appendChild(link);
      }
      const descEl = document.createElement('div');
      descEl.className = 'lifecycle-step-description';
      descEl.textContent = step.description;
      li.appendChild(titleRow);
      li.appendChild(descEl);
      list.appendChild(li);
    }
  }

  async function renderConnectionStatusPanel(entry) {
    const { manifest } = entry;
    const panel = $('detail-connection-status');

    if (entry.localStatus === 'not_pulled') {
      // Bumps the counter too, not just hides the panel -- found by review:
      // without this, a slow in-flight request for a previously-viewed
      // PULLED artifact isn't caught by the stale-response check below (its
      // captured requestId still matches the live counter), so it can
      // render stale chips onto whatever not-pulled artifact the user has
      // since navigated to, even though this exact branch just hid the
      // panel for it.
      ++connectionStatusRequestId;
      panel.hidden = true;
      panel.innerHTML = '';
      return;
    }

    const requestId = ++connectionStatusRequestId;
    const chips = [];

    // A real loading cue while the two RPCs below are in flight -- same
    // spinner+text pattern #detail-tabs-loading already uses, not a new
    // one. Previously this panel just sat in whatever state it was until
    // both awaits resolved, a real inconsistency next to every other
    // async wait in Detail that DOES show this. Cleared the moment real
    // chips are ready to render (panel.innerHTML = '' below).
    renderSkeleton(panel, 'chips', 3);
    panel.hidden = false;

    // Signed/unsigned is deliberately NOT repeated here -- detail-provenance-badge
    // right above already shows it, for every artifact regardless of kind
    // or pulled state; this panel only adds what that badge doesn't cover.
    if (manifest.install_params && manifest.install_params.length > 0) {
      let configuredChip = { ok: null, label: 'Configuration -- could not check' };
      try {
        const { values } = await call('artifact.readInstallParamValues', {
          id: manifest.id,
          remote: entry.remoteName,
          cwd: state.projectDir,
        });
        const filled = manifest.install_params.filter((p) => values[p.key]).length;
        const total = manifest.install_params.length;
        configuredChip = {
          ok: filled === total,
          label: `Configured (${filled}/${total})`,
          // Only actionable when something's actually missing -- a fully
          // configured chip has nowhere useful to jump to.
          goTo: filled < total ? { tab: 'configuration', scrollTo: 'detail-install-params-fields' } : null,
        };
      } catch {
        // Keep the "could not check" chip rather than silently omitting it.
      }
      if (requestId !== connectionStatusRequestId) return; // superseded while awaiting
      chips.push(configuredChip);
    }

    if (manifest.wiring_actions && manifest.wiring_actions.length > 0) {
      let wiredChip = { ok: null, label: 'Wiring -- could not check' };
      try {
        const resolved = await call('artifact.resolveWiringActions', {
          id: manifest.id,
          remote: entry.remoteName,
          cwd: state.projectDir,
        });
        const total = resolved.length;
        // alreadyWired excluded from "needs review" -- its real content
        // already matches what this artifact would have written, so
        // there's genuinely nothing to look at, same reasoning as why the
        // Wiring section itself no longer offers "Merge with Claude" for it.
        const needsReview = resolved.filter((a) => a.targetFileExists && !a.alreadyWired).length;
        wiredChip = needsReview === 0
          ? { ok: true, label: `Wired (${total}/${total})`, goTo: null }
          : {
            ok: false,
            label: `Wired (${total - needsReview}/${total}, ${needsReview} need${needsReview === 1 ? 's' : ''} review) →`,
            goTo: { tab: 'configuration', scrollTo: 'detail-wiring-actions' },
          };
      } catch {
        // Keep the "could not check" chip rather than silently omitting it.
      }
      if (requestId !== connectionStatusRequestId) return; // superseded while awaiting
      chips.push(wiredChip);
    }

    panel.innerHTML = '';
    panel.hidden = false;
    for (const chip of chips) {
      // A chip with somewhere real to jump to is a real button, not just
      // text -- found by direct user feedback: naming "4 need review"
      // with no way to get there from this panel (which sits above the
      // tabs, visible from Documentation same as any other tab) left
      // people unable to find what it was talking about.
      const el = document.createElement(chip.goTo ? 'button' : 'span');
      if (chip.goTo) el.type = 'button';
      el.className = `status-chip ${chip.ok === true ? 'ok' : chip.ok === false ? 'warn' : 'neutral'}${chip.goTo ? ' clickable' : ''}`;
      el.textContent = chip.label;
      if (chip.goTo) {
        el.title = 'View details';
        el.addEventListener('click', () => {
          goToDetailTab(chip.goTo.tab);
          // The tab switch above is synchronous DOM work; scrollIntoView
          // needs the target's section to already be un-hidden, which it
          // is by the time this next line runs.
          $(chip.goTo.scrollTo)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
      panel.appendChild(el);
    }

    const buildChip = document.createElement('span');
    buildChip.className = 'status-chip neutral';
    buildChip.textContent = 'Build -- not checked yet';
    panel.appendChild(buildChip);

    const verifyBtn = document.createElement('button');
    verifyBtn.type = 'button';
    verifyBtn.className = 'btn btn-sm btn-ghost';
    verifyBtn.textContent = 'Verify build';
    verifyBtn.addEventListener('click', () => {
      void withBusy(verifyBtn, 'Checking…', async () => {
        // A chip that quietly changes text, next to a button whose own
        // label goes right back to "Verify build" once it's done, reads
        // as "I clicked it and nothing happened" if you were watching the
        // button rather than the chip beside it -- direct user feedback.
        // The toast is the same "something just happened" signal every
        // other action in this app already uses; the chip stays too, as
        // the persistent record for next time.
        try {
          const build = await call('artifact.verifyBuild', { cwd: state.projectDir });
          if (!build.ran) {
            buildChip.className = 'status-chip neutral';
            buildChip.textContent = 'Build -- no build command found';
            showToast('success', 'No build command was found for this project -- nothing to verify.');
          } else if (build.success) {
            buildChip.className = 'status-chip ok';
            buildChip.textContent = 'Build passing';
            showToast('success', 'Build passing.');
          } else if (build.timedOut) {
            buildChip.className = 'status-chip warn';
            buildChip.textContent = 'Build timed out (may just be slow)';
            showToast('error', 'The build was killed for running too long -- it may just be slow, or genuinely stuck.');
          } else if (build.toolNotFound) {
            buildChip.className = 'status-chip warn';
            buildChip.textContent = 'Build tool not found on PATH';
            showToast('error', "The build tool this project needs isn't installed or on PATH.");
          } else {
            buildChip.className = 'status-chip warn';
            buildChip.textContent = 'Build failing';
            showToast('error', `Build failing${build.output ? `: ${build.output.slice(0, 200)}` : '.'}`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          buildChip.className = 'status-chip warn';
          buildChip.textContent = `Could not check -- ${message}`;
          showToast('error', `Could not check the build -- ${message}`);
        }
      });
    });
    panel.appendChild(verifyBtn);
  }

  async function renderInstallParamsSection(entry) {
    const { manifest } = entry;
    const requestId = ++installParamsRequestId;
    const fieldsContainer = $('detail-install-params-fields');

    // A REAL value already sitting in .env.local (from an earlier partial
    // fill, or a prior pull) is more authoritative than the manifest
    // author's own generic default -- same provided > existing > default
    // precedence resolveInstallParamValues's own doc comment establishes,
    // just applied to what the form DISPLAYS rather than what it writes.
    // Skipped entirely when there are no install_params to prefill at all
    // (e.g. an artifact with only wiring_actions) -- no point resolving
    // the artifact and reading .env.local for nothing.
    let existingValues = {};
    if (manifest.install_params.length > 0) {
      // Same spinner+text pattern renderConnectionStatusPanel/
      // renderWiringSection already use -- this section previously showed
      // nothing at all while the RPC below was in flight (or, worse, a
      // PREVIOUS artifact's still-rendered fields), the one gap left when
      // that pattern was applied to its two siblings.
      renderSkeleton(fieldsContainer, 'fields', 2);
      try {
        const result = await call('artifact.readInstallParamValues', {
          id: manifest.id,
          remote: entry.remoteName,
          cwd: state.projectDir,
        });
        existingValues = result.values ?? {};
      } catch {
        // Degrade to today's default-only prefill -- never let a failure
        // to resolve the artifact/remote (or read .env.local) break the
        // Configuration tab from rendering at all.
      }
      if (requestId !== installParamsRequestId) return; // superseded while awaiting
    }

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
      const prefill = existingValues[param.key] ?? param.default;
      if (prefill !== undefined) {
        input.value = prefill;
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

  /** Real markdown rendering (vendored `marked`, loaded as a plain global
   * via vendor/marked.min.js -- spike-ui has no build step, so this is a
   * classic <script> tag, not an import) for README.md/GUIDELINES.md
   * content -- replaces the old `textContent` raw-text dump (headers/
   * bold/tables/links/code-fences used to show up as literal `#`/`**`/`|`
   * characters). Rendered inside a SANDBOXED iframe, never injected into
   * the host page's own DOM directly: a pushed artifact's README is real
   * but still less-trusted content, matching this codebase's existing
   * "sandbox anything less-trusted" discipline (loadDetailPreview's
   * component-preview iframes, compile.ts's directory-sandboxed esbuild
   * import plugin). `marked` does NOT sanitize by design (its own docs
   * say so) -- a README's raw `<script>`/`<img onerror>` would otherwise
   * reach the DOM verbatim, so the renderer below is overridden to ESCAPE
   * raw HTML rather than pass it through, using the same `escapeHtml`
   * helper already used for tag pills, and link/image URLs are checked
   * against an allowlist of schemes that can't execute script (see
   * isSafeMarkdownUrl) -- marked's own link/image renderers otherwise
   * pass a `javascript:` href straight through unmodified. The iframe
   * sandbox is real
   * defense in depth on top of that (a strict CSP with no `img-src`
   * beyond `data:` blocks a malicious README from embedding a remote
   * tracking-pixel image, even for a Detail view someone is just
   * browsing before deciding whether to pull anything). Falls back to
   * plain preformatted text if `marked` throws for any reason --
   * best-effort, never a hard failure, matching
   * parseRoutesTree/parseGuidelinesTokens's own established posture. */
  /** Allows only URL schemes that can't execute script when clicked/loaded
   * -- http(s)/mailto for links, plus data:image/* for images (needed for
   * inline base64 screenshots a real README might embed), and any
   * relative/anchor/query-only path. `javascript:`/`vbscript:`/etc. are
   * rejected. Found by review: `marked`'s own link/image renderers pass
   * href/src through untouched (verified directly against the vendored
   * build -- a `[text](javascript:...)` link rendered as a live,
   * clickable `javascript:` URL), so escaping raw HTML tokens alone (the
   * original fix) left this one path still able to run script on click,
   * contradicting this function's own stated security model.
   *
   * The relative-path check deliberately excludes a leading `//` --
   * `//evil.com/phish` starts with `/` (so a naive `/^[#/?]/` test wrongly
   * treats it as a same-site relative path) but is actually a
   * protocol-relative URL that navigates cross-origin, resolving to
   * whatever scheme the iframe currently has (e.g. `https://evil.com/
   * phish`). A crafted README link in that shape would otherwise be
   * clickable and swap the iframe's own displayed content for an
   * attacker-controlled page -- not script execution (no
   * allow-same-origin/allow-top-navigation on this iframe), but a real
   * phishing vector inside what reads as trusted DeliveryOS chrome. */
  function isSafeMarkdownUrl(href, allowDataImage) {
    const trimmed = String(href ?? '').trim();
    if (/^(https?:|mailto:)/i.test(trimmed)) return true;
    if (allowDataImage && /^data:image\//i.test(trimmed)) return true;
    if (/^[#?]/.test(trimmed)) return true;
    if (/^\/(?!\/)/.test(trimmed)) return true;
    return false;
  }

  function renderMarkdownToSandboxedIframe(container, markdownText) {
    container.innerHTML = '';

    let html;
    try {
      const renderer = new marked.Renderer();
      renderer.html = (token) => escapeHtml(token.text ?? '');
      const defaultLink = renderer.link.bind(renderer);
      const defaultImage = renderer.image.bind(renderer);
      renderer.link = (token) =>
        isSafeMarkdownUrl(token.href, false) ? defaultLink(token) : escapeHtml(token.text ?? token.href ?? '');
      renderer.image = (token) => (isSafeMarkdownUrl(token.href, true) ? defaultImage(token) : '');
      html = marked.parse(markdownText, { renderer, gfm: true });
    } catch {
      const pre = document.createElement('pre');
      pre.className = 'markdown-fallback';
      pre.textContent = markdownText;
      container.appendChild(pre);
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-scripts';
    iframe.className = 'markdown-frame';
    // A real, confirmed dark-mode gap: this document's own <style> used to
    // be hardcoded light-only colors with no background set at all (so it
    // rendered on the browser's default white iframe canvas) -- harmless
    // in light mode (the surrounding .markdown-frame container is white
    // too) but a stark white rectangle inside an otherwise dark Detail
    // card once dark mode shipped. Reflects the CURRENT theme at render
    // time, same "syncs once, not live-reactive to a later toggle" scope
    // as the template preview iframes' own theme sync.
    iframe.srcdoc = buildMarkdownDocument(html, getEffectiveTheme());
    container.appendChild(iframe);

    const handler = (event) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== 'object' || data.type !== 'contentHeight') return;
      // No upper clamp (unlike clampPreviewHeight) -- documentation is
      // legitimately much longer than a component preview, and the
      // whole point of this feature is no nested inner scrollbar; #main
      // already scrolls the outer page normally.
      iframe.style.height = `${Math.max(data.height, 40)}px`;
    };
    window.addEventListener('message', handler);
    markdownIframeMessageHandlers.push(handler);
    mountedMarkdownIframes.push({ container, markdownText });
  }

  /** Re-renders every open markdown iframe in the current theme. Called from
   * toggleTheme, because the theme is baked into each iframe's srcdoc rather
   * than inherited. Rebuilding is cheap (the markdown is already in memory)
   * and is the only way to re-theme a sandboxed document. */
  function refreshMarkdownIframeThemes() {
    if (mountedMarkdownIframes.length === 0) return;
    const open = mountedMarkdownIframes.slice();
    clearMarkdownIframeListeners();
    for (const { container, markdownText } of open) {
      if (container.isConnected) renderMarkdownToSandboxedIframe(container, markdownText);
    }
  }

  /** Wraps already-rendered (HTML-escaped-raw-HTML) markdown output into
   * a small, self-contained document -- same CSP-meta-tag convention as
   * compile.ts's injectPreviewCsp (`img-src data:` only), real
   * typographic styling matching this app's own heading/body/code font
   * conventions (soft font-family preferences only, same as every other
   * component preview in this app -- no @import/<link> Google Fonts
   * fetch, which the CSP below would block anyway and which this
   * codebase already avoids for less-trusted content), and a small
   * inline content-height-reporter script -- simpler than compile.ts's
   * injectContentHeightReporter (that one tracks a React #root's mount/
   * remount lifecycle; a static markdown document has no such lifecycle,
   * just a plain ResizeObserver on <body>). */
  function buildMarkdownDocument(bodyHtml, theme) {
    // A real, confirmed dark-mode gap this closes: this document used to
    // be hardcoded light-only colors with no explicit body background at
    // all, so it rendered on the browser's default white iframe canvas
    // regardless of the app's own theme -- fine in light mode (the
    // surrounding .markdown-frame container is white too) but a stark
    // white rectangle inside an otherwise dark Detail card in dark mode.
    // Same exact hex values as style.css's own dark-mode token overrides
    // (this sandboxed document can't reach the parent page's CSS custom
    // properties, so the values are duplicated here rather than shared).
    const isDark = theme === 'dark';
    const colors = isDark
      ? { bg: '#211C15', ink: '#F0EAE0', border: '#3A3226', codeBg: '#241F18', tableStripe: '#191510', accent: '#7A9955' }
      : { bg: '#FFFCF2', ink: '#1E3C53', border: '#E0D9CE', codeBg: '#F6F1E9', tableStripe: '#FFFCF2', accent: '#ACC384' };
    return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;">
<style>
  * { box-sizing: border-box; }
  /* No inner scrollbar, ever -- the whole point of auto-sizing the
     iframe to its real content height is that content never needs its
     OWN scroll container; #main (the outer app view) already scrolls
     normally. Same convention compile.ts's injectContentHeightReporter
     already established for component previews. */
  html, body { margin: 0; padding: 0; overflow: hidden; }
  body {
    font-family: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-size: 14px;
    line-height: 1.65;
    background: ${colors.bg};
    color: ${colors.ink};
    padding: 4px 2px 20px;
    max-width: 760px;
    /* Found by review: a long unbroken token (a URL, hash, or path with
       no spaces) wider than max-width used to just get silently clipped
       -- overflow:hidden above hides it rather than showing a scrollbar,
       so the clipped tail was genuinely unreadable, not just ugly. */
    overflow-wrap: break-word;
    word-break: break-word;
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: 'EB Garamond', Georgia, serif;
    font-weight: 400;
    line-height: 1.25;
    margin: 1.4em 0 .5em;
  }
  h1 { font-size: 26px; margin-top: 0; }
  h2 { font-size: 21px; border-bottom: 1px solid ${colors.border}; padding-bottom: .3em; }
  h3 { font-size: 17px; }
  p, ul, ol { margin: 0 0 1em; }
  ul, ol { padding-left: 1.4em; }
  li { margin-bottom: .3em; }
  a { color: ${colors.ink}; text-decoration: underline; text-decoration-color: ${colors.border}; }
  a:hover { text-decoration-color: ${colors.ink}; }
  code {
    font-family: 'JetBrains Mono', ui-monospace, Consolas, monospace;
    font-size: 12.5px;
    background: ${colors.codeBg};
    border: 1px solid ${colors.border};
    border-radius: 4px;
    padding: 1px 5px;
  }
  pre {
    background: ${colors.codeBg};
    border: 1px solid ${colors.border};
    border-radius: 8px;
    padding: 12px 14px;
    overflow-x: auto;
  }
  pre code { background: none; border: none; padding: 0; }
  blockquote {
    margin: 0 0 1em;
    padding: .2em 1em;
    border-left: 3px solid ${colors.accent};
    color: ${colors.ink};
    opacity: .85;
  }
  table { border-collapse: collapse; margin: 0 0 1em; width: 100%; }
  th, td { border: 1px solid ${colors.border}; padding: 6px 10px; text-align: left; font-size: 13px; }
  th { background: ${colors.codeBg}; font-weight: 600; }
  tr:nth-child(even) td { background: ${colors.tableStripe}; }
  hr { border: none; border-top: 1px solid ${colors.border}; margin: 1.5em 0; }
  img { max-width: 100%; }
</style>
</head><body>
${bodyHtml}
<script>
  (function () {
    function report() {
      var height = document.body.scrollHeight;
      if (window.parent) window.parent.postMessage({ type: 'contentHeight', height: height }, '*');
    }
    new ResizeObserver(report).observe(document.body);
    report();
  })();
</script>
</body></html>`;
  }

  /** Documentation tab: real rendered markdown for README.md and/or
   * GUIDELINES.md's own full prose -- gated on real file presence, never
   * a `kind` check, one shared render regardless of artifact kind (a
   * `kind: backend-plugin` artifact's README used to render in a
   * separate section from every other kind's; there's no real reason for
   * that split once every kind's README lands in the same tab). Most
   * artifacts have no README at all, or a README but no GUIDELINES.md;
   * both are normal, not failures -- each block independently hides
   * itself when its own file is absent, and the whole tab drops out of
   * detailTabState.documentation only if BOTH are absent. GUIDELINES.md's
   * own structured tokens/usage-rules are rendered separately (see
   * renderDesignAndComponentsSections) -- this only shows its raw prose,
   * which today is never shown anywhere else in the app at all. */
  async function renderDocumentationTab(entry) {
    const requestId = ++documentationRequestId;
    const readmeBlock = $('detail-readme-block');
    const readmeEl = $('detail-readme');
    const guidelinesBlock = $('detail-guidelines-doc-block');
    const guidelinesEl = $('detail-guidelines-doc');

    const [readmeResult, guidelinesResult] = await Promise.allSettled([
      call('artifact.readPayloadFile', { remote: entry.remoteName, id: entry.manifest.id, path: 'README.md' }),
      call('artifact.readPayloadFile', { remote: entry.remoteName, id: entry.manifest.id, path: 'GUIDELINES.md' }),
    ]);
    if (requestId !== documentationRequestId) return; // superseded while awaiting

    const readmeContent = readmeResult.status === 'fulfilled' ? readmeResult.value.content : undefined;
    const guidelinesContent = guidelinesResult.status === 'fulfilled' ? guidelinesResult.value.content : undefined;

    if (readmeContent) {
      renderMarkdownToSandboxedIframe(readmeEl, readmeContent);
      readmeBlock.hidden = false;
    } else {
      readmeEl.innerHTML = '';
      readmeBlock.hidden = true;
    }

    if (guidelinesContent) {
      renderMarkdownToSandboxedIframe(guidelinesEl, guidelinesContent);
      guidelinesBlock.hidden = false;
    } else {
      guidelinesEl.innerHTML = '';
      guidelinesBlock.hidden = true;
    }

    detailTabState.documentation = Boolean(readmeContent) || Boolean(guidelinesContent);
    refreshDetailTabs();
  }

  /** Real route/page map for whole-app templates (like the starter kit),
   * parsed straight from the artifact's own src/routes.tsx via
   * artifact.parseRoutes -- gated on real file presence, never a
   * `kind: template` check, same convention as every other Detail
   * tab. Coexists with the Documentation tab's README, doesn't replace
   * it -- an artifact can legitimately have both. */
  async function renderRoutesSection(entry) {
    const requestId = ++routesRequestId;
    const treeEl = $('detail-routes-tree');

    let result;
    try {
      result = await call('artifact.parseRoutes', {
        remote: entry.remoteName,
        id: entry.manifest.id,
      });
    } catch {
      result = { present: false, routes: [] };
    }
    if (requestId !== routesRequestId) return; // superseded while awaiting

    treeEl.innerHTML = '';
    const hasRoutes = result.present && result.routes.length > 0;
    if (hasRoutes) {
      for (const route of result.routes) {
        treeEl.appendChild(buildRouteNodeEl(route));
      }
    }
    detailTabState.routes = hasRoutes;
    refreshDetailTabs();
  }

  function buildRouteNodeEl(route) {
    const nodeEl = document.createElement('div');
    nodeEl.className = 'route-node';

    const row = document.createElement('div');
    row.className = 'route-node-row';

    const pathEl = document.createElement('span');
    pathEl.className = 'route-node-path';
    pathEl.textContent = route.path;
    row.appendChild(pathEl);

    if (route.element) {
      const pill = document.createElement('span');
      pill.className = 'tag-pill';
      pill.textContent = route.element;
      row.appendChild(pill);
    }

    if (route.errorElement) {
      const note = document.createElement('span');
      note.className = 'route-node-error-note';
      note.textContent = `errorElement: ${route.errorElement}`;
      row.appendChild(note);
    }

    nodeEl.appendChild(row);

    if (route.children && route.children.length > 0) {
      const childrenEl = document.createElement('div');
      childrenEl.className = 'route-node-children';
      for (const child of route.children) {
        childrenEl.appendChild(buildRouteNodeEl(child));
      }
      nodeEl.appendChild(childrenEl);
    }

    return nodeEl;
  }

  /** Source-drift-detection's Detail affordance: shown only when the
   * artifact's payload root has a real SOURCES.json (written once, at
   * extraction time, by the starter-kit-extractor/ui-component-extractor
   * skills) -- never a `kind` check, same "file presence, not kind"
   * convention as every other Detail section here. Reuses the already-
   * existing artifact.readPayloadFile RPC just to check presence (no new
   * RPC needed for that); the actual check happens on-demand, once the
   * user picks a local source folder, via the new
   * artifact.checkSourceDrift RPC. */
  async function renderSourceDriftSection(entry) {
    const requestId = ++sourceDriftRequestId;
    const resultsEl = $('detail-source-drift-results');
    const button = $('detail-check-source-drift-btn');

    let content;
    try {
      ({ content } = await call('artifact.readPayloadFile', {
        remote: entry.remoteName,
        id: entry.manifest.id,
        path: 'SOURCES.json',
      }));
    } catch {
      content = undefined;
    }
    if (requestId !== sourceDriftRequestId) return; // superseded while awaiting

    detailTabState.sourceDrift = Boolean(content);
    refreshDetailTabs();
    if (!content) return;

    resultsEl.innerHTML = '';
    button.onclick = () => void handleCheckSourceDrift(entry, button);
  }

  /** Runs once, on demand, when the user clicks "Check for source drift" --
   * unlike every other Detail RPC call above, this deliberately does NOT
   * run automatically on open: it requires a local folder pick every time
   * (no destination is remembered), since the real external source lives
   * wherever it happens to sit on THIS machine, which DeliveryOS has no
   * other way to know. */
  async function handleCheckSourceDrift(entry, button) {
    let source;
    try {
      source = await openDialog({ directory: true });
    } catch (err) {
      toastError(err);
      return;
    }
    if (!source) {
      return; // user cancelled
    }

    const resultsEl = $('detail-source-drift-results');
    await withBusy(button, 'Checking...', async () => {
      let results;
      try {
        ({ results } = await call('artifact.checkSourceDrift', {
          remote: entry.remoteName,
          id: entry.manifest.id,
          source,
        }));
      } catch (err) {
        toastError(err);
        return;
      }
      renderSourceDriftResults(resultsEl, results);
    });
  }

  function renderSourceDriftResults(resultsEl, results) {
    resultsEl.innerHTML = '';

    const drifted = results.filter((r) => r.status === 'drifted');
    const sourceMissing = results.filter((r) => r.status === 'source-missing');
    const unchanged = results.filter((r) => r.status === 'unchanged');

    const summary = document.createElement('div');
    summary.className = 'source-drift-summary';
    summary.textContent =
      `${drifted.length} drifted, ${sourceMissing.length} source missing, ${unchanged.length} unchanged`;
    resultsEl.appendChild(summary);

    // Worth seeing at a glance (drifted/source-missing), listed first;
    // "unchanged" is the expected common case and doesn't need the same
    // prominence, but is still listed so the check reads as complete
    // (not silently dropping files), same "show the whole picture"
    // instinct as check-updates's own report.
    for (const result of [...drifted, ...sourceMissing, ...unchanged]) {
      const item = document.createElement('div');
      item.className = `source-drift-item ${result.status}`;
      const pathEl = document.createElement('span');
      pathEl.className = 'source-drift-path';
      pathEl.textContent = result.payloadPath;
      item.appendChild(pathEl);
      const statusEl = document.createElement('span');
      statusEl.textContent =
        result.status === 'source-missing' ? 'source missing' : result.status;
      item.appendChild(statusEl);
      resultsEl.appendChild(item);
    }
  }

  /** Phase 12's "visible audit trail": the wiring-merge log
   * (.deliveryos/wiring-merge-log.jsonl) already existed on disk the
   * moment a merge was first applied, with nowhere in the UI to see it
   * short of opening a dotfile by hand. Gated on real log entries
   * existing for THIS artifact -- never a `kind` check, same "data
   * presence, not kind" convention as every other Detail section here --
   * resolved via artifact.readWiringMergeLog, already filtered to this
   * artifact and ordered newest-first server-side. */
  async function renderActivitySection(entry) {
    if (!state.projectDir) {
      detailTabState.activity = false;
      return;
    }

    const requestId = ++activityRequestId;
    // Two separate log files (merges vs. build-fixes -- see
    // fixBuildFailure.ts/requestWiringMerge.ts's own doc comments for why
    // they're not one), each read independently and merged here into one
    // chronological feed -- a person watching this tab shouldn't need to
    // know DeliveryOS happens to keep two files internally. One failing
    // independently of the other still shows whatever the other one has,
    // rather than losing the whole tab.
    const [mergeEntries, buildFixEntries] = await Promise.all([
      call('artifact.readWiringMergeLog', { cwd: state.projectDir, remote: entry.remoteName, id: entry.manifest.id })
        .then((r) => r.entries)
        .catch(() => []),
      call('artifact.readBuildFixLog', { cwd: state.projectDir, remote: entry.remoteName, id: entry.manifest.id })
        .then((r) => r.entries)
        .catch(() => []),
    ]);
    if (requestId !== activityRequestId) return; // superseded while awaiting

    const entries = [
      ...mergeEntries.map((r) => ({ kind: 'merge', ...r })),
      ...buildFixEntries.map((r) => ({ kind: 'build-fix', ...r })),
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    detailTabState.activity = entries.length > 0;
    refreshDetailTabs();
    if (entries.length === 0) return;

    const container = $('detail-activity-entries');
    container.innerHTML = '';
    for (const record of entries) {
      container.appendChild(renderActivityEntry(record));
    }
  }

  /** One wiring-merge log entry's own card. before/after are full file
   * contents that could be long, so they're collapsed by default behind a
   * real <details>/<summary> disclosure rather than more custom
   * click-to-expand JS -- nothing like it exists yet in this codebase and
   * it's the correct minimal-JS way to do this. */
  /** `record.kind` is 'merge' (an existing file's AI-proposed merge,
   * `.targetFile`/`.description`) or 'build-fix' (an AI-proposed fix for
   * a build a plain auto-write just broke, `.filePath`/`.buildError`) --
   * see renderActivitySection's merge of the two log files above. Same
   * card shape either way; only the file-name field and the "why this
   * happened" line differ. */
  function renderActivityEntry(record) {
    const isBuildFix = record.kind === 'build-fix';
    const card = document.createElement('div');
    card.className = 'wiring-action-card';

    const header = document.createElement('div');
    header.className = 'wiring-action-header';
    const kindEl = document.createElement('span');
    kindEl.className = 'wiring-action-kind';
    kindEl.textContent = isBuildFix ? 'Build fix' : 'Merge';
    const fileEl = document.createElement('code');
    fileEl.textContent = isBuildFix ? record.filePath : record.targetFile;
    const statusEl = document.createElement('span');
    // No dedicated success/failure pill exists yet -- .exists/.absent are
    // the closest read: "rolled back" is the one worth flagging (a real
    // build failure reverted the write), same warning tone .exists
    // already carries; "applied" is the unremarkable common case, same
    // neutral tone .absent already carries.
    statusEl.className = `wiring-action-status ${record.rolledBack ? 'exists' : 'absent'}`;
    statusEl.textContent = record.rolledBack ? 'rolled back' : 'applied';
    header.appendChild(kindEl);
    header.appendChild(fileEl);
    header.appendChild(statusEl);

    const timeEl = document.createElement('div');
    timeEl.className = 'wiring-action-instructions';
    timeEl.textContent = new Date(record.timestamp).toLocaleString();

    const descEl = document.createElement('div');
    descEl.className = 'wiring-action-description';
    // A build-fix record's "why" is the real build error it was reacting
    // to; a merge record's is the wiring_action's own plain-language
    // description -- both are the honest answer to "why did this happen,"
    // just sourced from different places.
    descEl.textContent = isBuildFix ? `Build error: ${record.buildError}` : record.description;

    card.appendChild(header);
    card.appendChild(timeEl);
    card.appendChild(descEl);
    card.appendChild(renderActivityDiffDisclosure('Before', record.before, 'After', record.after));

    if (record.rolledBack && record.rebuildOutput) {
      card.appendChild(renderActivitySnippetDisclosure('Rebuild output', record.rebuildOutput));
    }

    return card;
  }

  /** A single <details> holding both Before/After <pre> blocks together --
   * one disclosure per entry, not two, since they're only ever meaningful
   * read side by side. */
  function renderActivityDiffDisclosure(beforeLabel, before, afterLabel, after) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Before / After';
    details.appendChild(summary);

    for (const [label, content] of [[beforeLabel, before], [afterLabel, after]]) {
      const labelEl = document.createElement('div');
      labelEl.className = 'wiring-section-label';
      labelEl.textContent = label;
      const pre = document.createElement('pre');
      pre.className = 'wiring-action-snippet';
      pre.textContent = content;
      details.appendChild(labelEl);
      details.appendChild(pre);
    }

    return details;
  }

  function renderActivitySnippetDisclosure(label, content) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = label;
    const pre = document.createElement('pre');
    pre.className = 'wiring-action-snippet';
    pre.textContent = content;
    details.appendChild(summary);
    details.appendChild(pre);
    return details;
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
        // Same real scope-boundary note the CLI's own `config` command has
        // always printed on every call -- the app's Configuration tab had
        // no way to tell a person the same thing until this was added.
        toastSuccess(`Configuration applied. ${result.note ?? ''}`.trim());
      }
      // A real secrets-exposure risk -- this is specifically the "you just
      // typed in a secret" moment, so it gets its own distinct toast, never
      // folded quietly into the message above where it could be missed.
      if (result.gitignoreWarning) {
        toastError(new Error(result.gitignoreWarning));
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

    renderWireWithClaudeLauncher(entry);

    // Same real loading cue as renderConnectionStatusPanel's own fix --
    // #detail-tabs-loading's exact spinner+text pattern, not a new one.
    // Previously this section stayed exactly as it was (hidden, or
    // showing a PREVIOUS artifact's stale cards) until resolveWiringActions
    // resolved, with no indication anything was happening.
    section.hidden = false;
    renderSkeleton(container, 'cards', 2);

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
    const mergeControllers = [];
    for (const action of resolved) {
      const card = document.createElement('div');
      card.className = 'wiring-action-card';

      const header = document.createElement('div');
      header.className = 'wiring-action-header';
      const fileEl = document.createElement('code');
      fileEl.textContent = action.targetFile;
      const statusEl = document.createElement('span');
      statusEl.className = `wiring-action-status ${action.alreadyWired ? 'ok' : action.placementAmbiguous ? 'ambiguous' : action.targetFileExists ? 'exists' : 'absent'}`;
      statusEl.textContent = action.alreadyWired
        ? 'already wired ✓'
        : action.placementAmbiguous
          ? 'placement ambiguous'
          : action.targetFileExists ? 'exists' : 'not found';
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
        // Collapsed by default. A backend-plugin routinely declares three or
        // four wiring actions, and rendering every snippet expanded turned
        // this section into an undifferentiated wall of code you had to scroll
        // past to reach the actions -- the file path and status, which are the
        // things you actually scan, were lost in it. The summary line carries
        // the useful facts (which file, how many lines) so the code is one
        // click away rather than always in the way.
        const lineCount = action.snippet.split('\n').length;
        const disclosure = document.createElement('details');
        disclosure.className = 'wiring-action-code';
        const summary = document.createElement('summary');
        summary.textContent = `Show the ${lineCount}-line snippet`;
        disclosure.appendChild(summary);
        const snippetEl = document.createElement('pre');
        snippetEl.className = 'wiring-action-snippet';
        snippetEl.textContent = action.snippet;
        disclosure.appendChild(snippetEl);
        card.appendChild(disclosure);
      }

      // Backend plug-and-play: the target file already existing used to
      // be a dead end -- "review it yourself," nothing else. Now offers
      // a real, opt-in "Merge with Claude" row for exactly this case
      // (never for a fresh file, which already got a safe, deterministic
      // full-content whenAbsent.snippet with no ambiguity to resolve).
      // Also never for a file that's already wired correctly (its real
      // content already matches what this artifact would have written) --
      // found via direct user testing: offering the button here just meant
      // a wasted click and a wasted `claude` call for an outcome
      // resolveWiringActions already knew in advance.
      if (action.targetFileExists && !action.alreadyWired) {
        const controller = renderWiringMergeRow(
          action.targetFile,
          action.description,
          action.instructions,
          action.snippet,
          Boolean(action.snippetIsFullFileReference),
          entry.remoteName,
          entry.manifest.id,
        );
        card.appendChild(controller.row);
        mergeControllers.push(controller);
      }

      // adaptSrcDirPath's own deterministic check (src/ vs. not) already
      // resolved every OTHER case -- this is only reached when neither a
      // root app/pages nor a src/app/src/pages exists yet to check
      // against, a genuinely ambiguous placement no heuristic should
      // silently guess at. `action.snippet` is still the real, fully-known
      // whenAbsent content (see resolveWiringActions's own doc comment on
      // why that's safe here) -- only the DESTINATION path is undecided.
      if (action.placementAmbiguous) {
        card.appendChild(
          renderWiringPlacementRow(action.targetFile, action.description, action.snippet, entry.remoteName, entry.manifest.id),
        );
      }

      container.appendChild(card);
    }

    // "Merge all with Claude" only earns its own row once there's more
    // than one file to merge -- for exactly one, the per-file button
    // above is already the whole interaction, and a second identical
    // button next to it would just be noise.
    const mergeAllContainer = $('detail-wiring-merge-all');
    mergeAllContainer.innerHTML = '';
    if (mergeControllers.length > 1) {
      mergeAllContainer.appendChild(renderMergeAllControls(mergeControllers));
    }
  }

  /** Builds one row's DOM for a single Tier-2 wiring_action whose target
   * file already existed at pull time: a button that asks Claude to
   * propose a merge, then either its own honest "can't determine a
   * merge" reason, or the proposed full file content plus Apply/Discard.
   * Mirrors renderBuildFixRow's exact ask/apply/discard shape. Nothing
   * is written to disk, and nothing is logged, unless Apply is clicked.
   *
   * Returns a controller, not just the row element -- `renderMergeAllControls`
   * drives `askForMerge`/`applyProposal` on every row in a batch, reusing
   * this exact same ask/apply logic (same prompt, same audit-log entry,
   * same rebuild-and-rollback) rather than a second, parallel code path
   * that could drift from the single-file one. Clicking the row's own
   * buttons and the batch controls calling these functions are genuinely
   * the same call, not two implementations of the same idea. */
  function renderWiringMergeRow(
    targetFile,
    description,
    instructions,
    guidanceSnippet,
    guidanceSnippetIsFullFile,
    remoteName,
    artifactId,
  ) {
    const row = document.createElement('div');
    row.className = 'build-fix-row';

    // Scoped to THIS row alone (see the note above renderBuildFixRow's own
    // shared-counter removal) -- guards only against this row's own second
    // click superseding its first in-flight request, never a different row.
    let wiringMergeRequestId = 0;
    // The most recent successfully-proposed merge, if any -- what
    // `applyProposal` (whether triggered by this row's own Apply button or
    // by "Apply all") actually writes. Cleared on Discard or once applied.
    let pendingMerge = null;
    // Found by review: this row's own Apply button and "Apply all"
    // (renderMergeAllControls) can both call `applyProposal` -- the
    // button's own click handler disables ITSELF for the duration via
    // `withBusy`, but a batch call bypasses that entirely, so without this
    // flag a click on the row's own Apply button while a batch apply for
    // the SAME row is still in flight would fire a second, concurrent
    // `applyWiringMerge` for the same file (two racing build-verify runs,
    // two audit-log entries for one real change).
    let applyInFlight = false;

    const askBtn = document.createElement('button');
    askBtn.type = 'button';
    askBtn.className = 'btn btn-sm btn-ghost';
    askBtn.textContent = 'Merge with Claude ✨';
    row.appendChild(askBtn);

    const resultEl = document.createElement('div');
    resultEl.className = 'build-fix-result';
    resultEl.hidden = true;
    row.appendChild(resultEl);

    let applyBtn = null;
    let discardBtn = null;

    async function askForMerge() {
      await withBusy(askBtn, 'Asking…', async () => {
        const requestId = ++wiringMergeRequestId;
        let merge;
        try {
          merge = await call('artifact.requestWiringMerge', {
            cwd: state.projectDir,
            targetFile,
            description,
            instructions,
            guidanceSnippet,
            guidanceSnippetIsFullFile,
          });
        } catch (err) {
          if (requestId !== wiringMergeRequestId) return; // superseded while awaiting
          resultEl.hidden = false;
          resultEl.textContent = `Could not get a merge -- ${err instanceof Error ? err.message : String(err)}`;
          return;
        }
        if (requestId !== wiringMergeRequestId) return; // superseded while awaiting

        resultEl.hidden = false;
        resultEl.innerHTML = '';

        if (!merge.mergedFile) {
          pendingMerge = null;
          const reasonEl = document.createElement('div');
          reasonEl.textContent = merge.reason || 'Claude could not determine a merge for this file.';
          resultEl.appendChild(reasonEl);
          return;
        }

        pendingMerge = merge;

        const snippetEl = document.createElement('pre');
        snippetEl.className = 'wiring-action-snippet';
        snippetEl.textContent = merge.mergedFile;
        resultEl.appendChild(snippetEl);

        const actionsEl = document.createElement('div');
        actionsEl.className = 'build-fix-actions';
        applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'btn btn-sm';
        applyBtn.textContent = 'Apply';
        discardBtn = document.createElement('button');
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
          pendingMerge = null;
          resultEl.hidden = true;
          resultEl.innerHTML = '';
          askBtn.hidden = false;
        });

        applyBtn.addEventListener('click', () => void withBusy(applyBtn, 'Applying…', applyProposal));
      });
    }

    async function applyProposal() {
      // Returns `null` (not an error) when there's nothing to do OR when
      // another call is already applying this exact row -- the caller
      // (this row's own click handler, or a batch loop) treats `null` as
      // "skip, no outcome to count," never as a failure.
      if (!pendingMerge || !pendingMerge.mergedFile || applyInFlight) return null;
      applyInFlight = true;
      const merge = pendingMerge;
      if (discardBtn) discardBtn.disabled = true;
      try {
        const outcome = await call('artifact.applyWiringMerge', {
          cwd: state.projectDir,
          targetFile,
          mergedFile: merge.mergedFile,
          description,
          remote: remoteName,
          id: artifactId,
          costUsd: merge.costUsd,
          durationMs: merge.durationMs,
        });
        pendingMerge = null;
        const outcomeEl = document.createElement('div');
        if (outcome.rolledBack) {
          outcomeEl.textContent = `The merge didn't actually keep the project building -- your original file was restored.${outcome.build.output ? ` (${outcome.build.output})` : ''}`;
        } else if (outcome.build.ran) {
          outcomeEl.textContent = 'Merge applied -- the build still passes.';
        } else {
          outcomeEl.textContent = 'Merge applied (no build command detected to verify it).';
        }
        resultEl.innerHTML = '';
        resultEl.appendChild(outcomeEl);
        return outcome;
      } catch (err) {
        const errEl = document.createElement('div');
        errEl.textContent = `Could not apply the merge -- ${err instanceof Error ? err.message : String(err)}`;
        resultEl.innerHTML = '';
        resultEl.appendChild(errEl);
        throw err;
      } finally {
        applyInFlight = false;
      }
    }

    askBtn.addEventListener('click', () => void askForMerge());

    return {
      row,
      targetFile,
      askForMerge,
      hasProposal: () => Boolean(pendingMerge && pendingMerge.mergedFile),
      applyProposal,
    };
  }

  /** Builds one row's DOM for a single Tier-2 wiring_action reporting
   * `placementAmbiguous` -- a button that asks Claude where this specific
   * file should really go in THIS project, then either its own honest
   * "no signal either way" reasoning, or the proposed path plus
   * Apply/Discard. Mirrors `renderWiringMergeRow`'s exact ask/apply/discard
   * shape, adapted for "decide a destination" instead of "propose a
   * merge" -- `snippet` is already fully known (the manifest's own
   * `whenAbsent.snippet`, never AI-generated here), so Apply only ever
   * writes it to wherever Claude suggested, it never asks Claude to
   * reproduce file content itself. Nothing is written to disk, and
   * nothing is logged, unless Apply is clicked. */
  function renderWiringPlacementRow(declaredPath, description, snippet, remoteName, artifactId) {
    const row = document.createElement('div');
    row.className = 'build-fix-row';

    let placementRequestId = 0;
    let pendingPlacement = null;

    const askBtn = document.createElement('button');
    askBtn.type = 'button';
    askBtn.className = 'btn btn-sm btn-ghost';
    askBtn.textContent = 'Ask Claude where this goes ✨';
    row.appendChild(askBtn);

    const resultEl = document.createElement('div');
    resultEl.className = 'build-fix-result';
    resultEl.hidden = true;
    row.appendChild(resultEl);

    askBtn.addEventListener('click', () => void withBusy(askBtn, 'Asking…', async () => {
      const requestId = ++placementRequestId;
      let placement;
      try {
        placement = await call('artifact.requestWiringPlacement', {
          cwd: state.projectDir,
          declaredPath,
          description,
        });
      } catch (err) {
        if (requestId !== placementRequestId) return; // superseded while awaiting
        resultEl.hidden = false;
        resultEl.textContent = `Could not get a placement suggestion -- ${err instanceof Error ? err.message : String(err)}`;
        return;
      }
      if (requestId !== placementRequestId) return; // superseded while awaiting

      resultEl.hidden = false;
      resultEl.innerHTML = '';

      if (!placement.suggestedPath) {
        pendingPlacement = null;
        const reasonEl = document.createElement('div');
        reasonEl.textContent = placement.reasoning || 'Claude could not determine where this file should go.';
        resultEl.appendChild(reasonEl);
        return;
      }

      pendingPlacement = placement;

      const pathEl = document.createElement('code');
      pathEl.textContent = placement.suggestedPath;
      resultEl.appendChild(pathEl);
      if (placement.reasoning) {
        const reasoningEl = document.createElement('div');
        reasoningEl.className = 'wiring-action-instructions';
        reasoningEl.textContent = placement.reasoning;
        resultEl.appendChild(reasoningEl);
      }

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
        pendingPlacement = null;
        resultEl.hidden = true;
        resultEl.innerHTML = '';
        askBtn.hidden = false;
      });

      applyBtn.addEventListener('click', () => void withBusy(applyBtn, 'Applying…', async () => {
        if (!pendingPlacement || !pendingPlacement.suggestedPath) return;
        const placementToApply = pendingPlacement;
        discardBtn.disabled = true;
        try {
          const outcome = await call('artifact.applyWiringPlacement', {
            cwd: state.projectDir,
            declaredPath,
            suggestedPath: placementToApply.suggestedPath,
            snippet,
            description,
            remote: remoteName,
            id: artifactId,
            reasoning: placementToApply.reasoning,
            costUsd: placementToApply.costUsd,
            durationMs: placementToApply.durationMs,
          });
          pendingPlacement = null;
          const outcomeEl = document.createElement('div');
          if (outcome.rolledBack) {
            outcomeEl.textContent = `That placement didn't actually keep the project building -- the file was removed again.${outcome.build.output ? ` (${outcome.build.output})` : ''}`;
          } else if (outcome.build.ran) {
            outcomeEl.textContent = `Written to ${placementToApply.suggestedPath} -- the build still passes.`;
          } else {
            outcomeEl.textContent = `Written to ${placementToApply.suggestedPath} (no build command detected to verify it).`;
          }
          resultEl.innerHTML = '';
          resultEl.appendChild(outcomeEl);
        } catch (err) {
          const errEl = document.createElement('div');
          errEl.textContent = `Could not write the file -- ${err instanceof Error ? err.message : String(err)}`;
          resultEl.innerHTML = '';
          resultEl.appendChild(errEl);
        }
      }));
    }));

    return row;
  }

  /** "Merge all with Claude": batches the exact same ask/apply calls every
   * per-file row already makes, just orchestrated across all of them from
   * one button instead of N. Proposals are requested SEQUENTIALLY, not in
   * parallel -- each is a real `claude` subprocess call, and running many
   * at once is the same avoidable concurrent-heavy-process cost this app
   * already moved away from for the template preview grid (Phase 18).
   * Applying is sequential for a second, load-bearing reason: each
   * `applyWiringMerge` reruns the WHOLE project's build to verify itself,
   * and two of those racing at once against the same project would give
   * an unreliable verify/rollback signal for both. One failure never stops
   * the rest -- same "one artifact's failure doesn't abort the batch"
   * rule `applyAvailableUpdates` already uses -- so a merge Claude can't
   * figure out for one file doesn't block proposing or applying the
   * others. Still requires exactly one human click before ANYTHING is
   * written, same as the single-file flow; it just covers every file that
   * click applies to. */
  function renderMergeAllControls(controllers) {
    const wrap = document.createElement('div');
    wrap.className = 'build-fix-row';

    const askAllBtn = document.createElement('button');
    askAllBtn.type = 'button';
    askAllBtn.className = 'btn btn-sm btn-ghost';
    askAllBtn.textContent = `Merge all with Claude ✨ (${controllers.length} files)`;
    wrap.appendChild(askAllBtn);

    const statusEl = document.createElement('div');
    statusEl.className = 'build-fix-result';
    statusEl.hidden = true;
    wrap.appendChild(statusEl);

    const applyAllBtn = document.createElement('button');
    applyAllBtn.type = 'button';
    applyAllBtn.className = 'btn btn-sm';
    applyAllBtn.textContent = 'Apply all proposed merges';
    applyAllBtn.hidden = true;
    wrap.appendChild(applyAllBtn);

    askAllBtn.addEventListener('click', () => {
      void withBusy(askAllBtn, 'Asking…', async () => {
        // Hidden for the whole re-ask sweep, not just while genuinely
        // empty -- found by review: re-running "Merge all" while a
        // PREVIOUS sweep's "Apply all" was still showing left it clickable
        // throughout the new sweep, so it could batch-apply a stale,
        // pre-refresh proposal for a row the new sweep hadn't reached yet.
        applyAllBtn.hidden = true;
        statusEl.hidden = false;
        let asked = 0;
        for (const controller of controllers) {
          statusEl.textContent = `Asking for ${controller.targetFile} (${asked + 1}/${controllers.length})…`;
          await controller.askForMerge();
          asked += 1;
        }
        const proposedCount = controllers.filter((c) => c.hasProposal()).length;
        statusEl.textContent = `${proposedCount} of ${controllers.length} file${controllers.length === 1 ? '' : 's'} got a real proposed merge -- review each below.`;
        applyAllBtn.hidden = proposedCount === 0;
      });
    });

    applyAllBtn.addEventListener('click', () => {
      void withBusy(applyAllBtn, 'Applying…', async () => {
        let applied = 0;
        let rolledBack = 0;
        let failed = 0;
        for (const controller of controllers) {
          if (!controller.hasProposal()) continue;
          try {
            const outcome = await controller.applyProposal();
            // null means "already being applied elsewhere" (this row's own
            // Apply button, most likely) -- not counted here at all; the
            // call that's actually doing the work reports the real outcome
            // on that row itself.
            if (!outcome) continue;
            if (outcome.rolledBack) rolledBack += 1;
            else applied += 1;
          } catch {
            failed += 1;
          }
        }
        statusEl.textContent =
          `${applied} merge${applied === 1 ? '' : 's'} applied, ${rolledBack} rolled back `
          + `(broke the build), ${failed} failed to apply -- see each file's own result above.`;
        applyAllBtn.hidden = true;
      });
    });

    return wrap;
  }

  // --- Embedded terminal ("Wire with Claude") ---------------------------
  //
  // Hands off to a REAL interactive `claude` session, rendered inside the
  // app's own window via xterm.js + a real PTY (src-tauri/src/pty.rs) --
  // the in-app counterpart to `deliveryos wire-with-claude <id>`, which
  // this literally runs: the Rust side knows nothing about DeliveryOS,
  // Claude, or wiring at all, it just streams whatever command is asked
  // to run in a real pseudo-terminal. See pty.rs's own doc comments for
  // why this hands off to claude's own normal, already-trusted
  // interactive permission model rather than a restricted, tool-granted
  // subprocess (that was already tried once for a different feature and
  // walked back after finding real security problems with it).
  //
  // v1 scope: one session at a time, matching pty.rs's own PtyState
  // invariant -- opening a new one while another is running kills the
  // old one first (the same thing a second `pty_spawn` call already does
  // on the Rust side; wireTerminalState mirrors that on the JS side so
  // the UI can't get out of sync with it).
  let wireTerminalState = null; // { term, fitAddon, resizeObserver, unlistenOutput, unlistenExit, sessionActive }

  function uint8ToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function base64ToUint8(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /** Builds the artifact-level "Wire with Claude" launcher -- not tied to
   * any single resolved wiring_action (unlike the merge/placement rows
   * above), so rendered once per artifact rather than once per action. */
  function renderWireWithClaudeLauncher(entry) {
    const container = $('detail-wiring-terminal-launcher');
    container.innerHTML = '';

    const row = document.createElement('div');
    row.className = 'build-fix-row';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm';
    btn.textContent = 'Wire with Claude →';
    row.appendChild(btn);
    container.appendChild(row);

    btn.addEventListener('click', () => void withBusy(btn, 'Opening…', () => openWireTerminal(entry)));
  }

  /** Confirms, then opens the terminal overlay and starts a real PTY
   * session running `deliveryos wire-with-claude <id>` in the real
   * project. Nothing is spawned until the user explicitly confirms --
   * same "one human click before anything real happens" rule every
   * other AI-assist flow in this app already follows, just phrased as a
   * native dialog here since this hands off to a session with real write
   * access, not a single bounded proposal to review afterward. */
  async function openWireTerminal(entry) {
    const proceed = await confirmDialog(
      'This hands off to a real, interactive claude session with real write access to '
        + `"${state.projectDir}". Make sure any work you care about is committed or backed up first.`,
      { title: 'Wire with Claude', kind: 'warning', okLabel: 'Continue', cancelLabel: 'Cancel' },
    );
    if (!proceed) return;

    if (wireTerminalState) {
      await closeWireTerminal({ silent: true });
    }

    const overlay = $('wire-terminal-overlay');
    const statusEl = $('wire-terminal-status');
    const container = $('wire-terminal-container');
    container.innerHTML = '';
    // Remember where focus came from so closing can put it back, and start
    // listening for Escape/Tab only while the overlay is actually open.
    wireTerminalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.addEventListener('keydown', handleWireTerminalKeydown, true);
    overlay.hidden = false;
    statusEl.textContent = 'Starting…';

    const term = new Terminal({
      // A fixed dark theme, not synced to the app's own light/dark mode
      // -- every mainstream embedded-terminal UI does this; simpler than
      // keeping a second theme system in sync, and not what this feature
      // is about.
      theme: { background: '#181a20', foreground: '#e6e6e6' },
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();

    const unlistenOutput = await listen('pty-output', (event) => {
      term.write(base64ToUint8(event.payload));
    });
    const unlistenExit = await listen('pty-exit', () => {
      if (!wireTerminalState) return;
      wireTerminalState.sessionActive = false;
      statusEl.textContent = 'Session ended';
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      void invoke('pty_resize', { rows: term.rows, cols: term.cols }).catch(() => {});
    });
    resizeObserver.observe(container);

    term.onData((data) => {
      const bytes = new TextEncoder().encode(data);
      void invoke('pty_write', { data: uint8ToBase64(bytes) }).catch(() => {});
    });

    wireTerminalState = { term, fitAddon, resizeObserver, unlistenOutput, unlistenExit, sessionActive: true };

    const args = ['wire-with-claude', entry.manifest.id];
    if (entry.remoteName) args.push('--remote', entry.remoteName);

    try {
      await invoke('pty_spawn', {
        cwd: state.projectDir,
        command: 'deliveryos',
        args,
        rows: term.rows,
        cols: term.cols,
      });
      statusEl.textContent = 'Running';
      term.focus();
    } catch (err) {
      statusEl.textContent = 'Could not start';
      term.write(`\r\nCould not start: ${err instanceof Error ? err.message : String(err)}\r\n`);
      wireTerminalState.sessionActive = false;
    }
  }

  /** Tears down the terminal overlay -- confirms first if a session is
   * still genuinely running (closing mid-session kills a real process,
   * same "confirm before a real, hard-to-undo action" rule as opening
   * one). `silent` skips both the confirm and the fade-out, used when
   * `openWireTerminal` replaces an already-finished/already-confirmed
   * previous session rather than the user explicitly closing one. */
  /** The element focus should return to when the terminal overlay closes.
   * Captured at open time, because focus is inside the overlay by then and
   * the browser will drop it to <body> otherwise -- which silently loses a
   * keyboard user's place in the page. */
  let wireTerminalReturnFocus = null;

  /** Keeps Tab inside the open overlay.
   *
   * The overlay covers the viewport at z-index 2000, but nothing stopped Tab
   * walking out of it into the page behind -- which is still fully
   * interactive, just visually dimmed. A keyboard user could tab to controls
   * they cannot see and act on the app underneath a modal shell running a
   * live terminal. */
  function trapWireTerminalFocus(ev) {
    if (ev.key !== 'Tab') return;
    const overlay = $('wire-terminal-overlay');
    if (overlay.hidden) return;
    const focusable = overlay.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]),'
      + ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    // The xterm canvas takes focus itself and is not in the list above, so
    // only wrap when focus is genuinely on an edge control.
    if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    } else if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    }
  }

  /** Escape closes the overlay, the way every modal is expected to.
   * Deliberately routed through closeWireTerminal so it still asks for
   * confirmation when a claude session is genuinely still running -- Escape
   * should be an exit, not a way to skip a warning. */
  function handleWireTerminalKeydown(ev) {
    if (ev.key === 'Escape' && !$('wire-terminal-overlay').hidden) {
      ev.preventDefault();
      void closeWireTerminal();
      return;
    }
    trapWireTerminalFocus(ev);
  }

  async function closeWireTerminal(opts = {}) {
    if (!wireTerminalState) return;
    if (wireTerminalState.sessionActive && !opts.silent) {
      const proceed = await confirmDialog('A claude session is still running. Close it and end the session?', {
        title: 'Wire with Claude',
        kind: 'warning',
        okLabel: 'End session',
        cancelLabel: 'Keep it open',
      });
      if (!proceed) return;
    }

    const { term, resizeObserver, unlistenOutput, unlistenExit } = wireTerminalState;
    resizeObserver.disconnect();
    unlistenOutput();
    unlistenExit();
    term.dispose();
    wireTerminalState = null;

    await invoke('pty_kill', {}).catch(() => {});

    $('wire-terminal-overlay').hidden = true;
    $('wire-terminal-container').innerHTML = '';
    document.removeEventListener('keydown', handleWireTerminalKeydown, true);
    // Put focus back where it was, rather than letting it fall to <body>.
    if (wireTerminalReturnFocus && wireTerminalReturnFocus.isConnected) {
      wireTerminalReturnFocus.focus();
    }
    wireTerminalReturnFocus = null;
  }

  /** Phase 11 Detail-view task: renders design-kit's color tokens/type
   * scale/layout-rules (Design tab) and a live component grid (Components
   * tab) for any artifact with a real `GUIDELINES.md` at its payload root
   * -- gated on that presence, never `manifest.kind`. Both tabs share this
   * one `artifact.parseGuidelines` fetch (split into two DOM targets, not
   * two RPC round-trips) and both flip their `detailTabState` key together
   * once it resolves -- an artifact with GUIDELINES.md always gets both,
   * same behavior as the single combined section this replaces. */
  async function renderDesignAndComponentsSections(entry) {
    const requestId = ++detailTemplateRequestId;

    let guidelines;
    try {
      guidelines = await call('artifact.parseGuidelines', { remote: entry.remoteName, id: entry.manifest.id });
    } catch {
      if (requestId !== detailTemplateRequestId) return; // superseded while awaiting
      detailTabState.design = false;
      detailTabState.components = false;
      refreshDetailTabs();
      return;
    }
    if (requestId !== detailTemplateRequestId) return; // superseded while awaiting

    detailTabState.design = guidelines.present;
    detailTabState.components = guidelines.present;
    refreshDetailTabs();
    if (!guidelines.present) return;

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

      // Different real design kits name their Type scale table's own
      // label column differently -- the original design-kit's own
      // convention calls it "Element"; kortix-design-kit's real,
      // Suna-derived convention calls it "Role" instead (and has no
      // "Element" column at all). parseTypeScale deliberately keys rows
      // by whatever headers the table actually has (see its own doc
      // comment: "a header rename doesn't require a matching code
      // change") -- reading only `row.Element` broke that contract and
      // silently rendered every row blank for any kit using a different
      // label header. Falls back to the row's own first value for a
      // convention that uses neither name.
      const label = row.Element || row.Role || Object.values(row)[0] || '';

      const labelEl = document.createElement('span');
      labelEl.className = 'type-sample-label';
      labelEl.textContent = label;

      const textEl = document.createElement('span');
      textEl.className = 'type-sample-text';
      // A REAL applied sample, not a data table -- the row's own label
      // text, rendered in its own real Font/Weight/Size, so this shows
      // what the type actually looks like rather than just naming it.
      textEl.textContent = label;
      textEl.style.fontFamily = fontFamilyStack(row.Font || '');
      textEl.style.fontWeight = String(parseLeadingNumber(row.Weight, 400));
      textEl.style.fontSize = `${clamp(parseSizeInPx(row.Size), 12, 28)}px`;

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

    // Lazy, same as the main UI Components list: build every card's shell
    // now (so the grid lays out immediately), but only actually compile a
    // component's preview once its card scrolls into view -- opening a
    // ~30-component design kit no longer fires that many concurrent
    // compiles at once just because the tab was opened.
    if (detailTemplateObserver) {
      detailTemplateObserver.disconnect();
    }
    const contextByFrame = new Map();
    const observer = new IntersectionObserver((observedEntries) => {
      for (const observedEntry of observedEntries) {
        if (!observedEntry.isIntersecting) {
          continue;
        }
        const frame = observedEntry.target;
        observer.unobserve(frame);
        const ctx = contextByFrame.get(frame);
        if (ctx) {
          void mountTemplateComponentPreview(frame, ctx.entry, ctx.component, ctx.requestId);
        }
      }
    });
    detailTemplateObserver = observer;

    for (const component of components) {
      const frame = buildTemplateComponentCard(grid, entry, component, requestId, guidelines.usageRules || {});
      if (!frame) continue; // superseded while building
      contextByFrame.set(frame, { entry, component, requestId });
      observer.observe(frame);
    }
    if (requestId !== detailTemplateRequestId) return; // superseded while building

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

  /** GUIDELINES.md Size values show up in two real, legitimate shapes --
   * a plain px number (design-kit's own convention: "18-24px",
   * "13-14px") or a real rem value (kortix-design-kit's Suna-derived
   * convention: "0.875rem", "1.5rem"). `parseLeadingNumber`'s plain
   * `\d+` match breaks on both: it stops at the decimal point ("0.875"
   * matches only the leading "0"), and never converts a rem value to a
   * real pixel size at all. Both kits' own GUIDELINES.md explicitly keep
   * the root font-size at 100% (16px) by convention, so `rem * 16` is a
   * real, documented conversion here, not a guess. */
  function parseSizeInPx(text) {
    const match = /(\d+(?:\.\d+)?)\s*(rem|px)?/.exec(String(text ?? ''));
    if (!match) return 14;
    const number = Number(match[1]);
    return match[2] === 'rem' ? number * 16 : number;
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
    state.componentDetailComponent = component;
    // Contextual, not a fixed "← Back" label -- names the specific
    // artifact this component grid belongs to, the same way Detail's own
    // back button names its specific return destination
    // (DETAIL_RETURN_LABELS) rather than a single generic label
    // regardless of context.
    $('back-to-component-grid-btn').textContent = `← Back to ${entry.manifest.id}`;
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

  /** Pulls just ONE component -- not tracked like a whole artifact (no
   * lockfile entry, no pristine snapshot; a component isn't its own
   * artifact, there's no install_target for "just Header"). Shared by
   * the Components-tab grid card's own "Pull" button and the component-
   * detail view's header button -- same action, two entry points. The
   * person picks the destination via a real native folder dialog, same
   * as every other destination-picking action in this app (Add New's
   * payload picker, Settings' Change folder) -- never a fixed convention
   * path guessed on their behalf. */
  async function pullComponentToFolder(button, entry, component) {
    await withBusy(button, 'Pulling...', async () => {
      let destDir;
      try {
        destDir = await openDialog({ directory: true, title: `Choose a folder for ${component.name}` });
      } catch (err) {
        toastError(err);
        return;
      }
      if (!destDir) return; // user cancelled
      try {
        const result = await call('artifact.pullPayloadComponent', {
          remote: entry.remoteName,
          id: entry.manifest.id,
          relativeDir: component.relativeDir,
          destDir,
        });
        toastSuccess(`Pulled ${component.name} (${result.copiedFiles.join(', ')}) to ${result.destDir}`);
      } catch (err) {
        toastError(err);
      }
    });
  }

  /** Builds and appends ONE component's card shell -- header, "View
   * details" button, usage-rule caption, and an empty "Loading preview…"
   * frame -- WITHOUT compiling or mounting its preview yet. Split out of
   * what used to be loadTemplateComponentPreview so the grid can lay out
   * and show every card's shell immediately while deferring the actual
   * compile (mountTemplateComponentPreview) until each card scrolls into
   * view. Returns the frame element to observe, or null if superseded
   * before attaching. */
  function buildTemplateComponentCard(grid, entry, component, requestId, usageRules) {
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

    if (requestId !== detailTemplateRequestId) return null; // superseded before attaching
    grid.appendChild(card);
    return frame;
  }

  /** Compiles and mounts ONE component's live preview into an already-built
   * card's frame (see buildTemplateComponentCard) once it has actually
   * scrolled into view -- clones loadUiComponentPreview's own per-card
   * iframe pattern (own contentHeight resize handler scoped via
   * event.source, no innerHTML for artifact-controlled text) rather than a
   * single shared listener, since the grid hosts N of these at once. Also
   * applies the template section's currently-active theme on the harness's
   * own 'ready' message (see compile.ts's setTheme handling) -- this is
   * what makes a card that finishes loading AFTER the toggle was already
   * flipped self-sync correctly. */
  async function mountTemplateComponentPreview(frame, entry, component, requestId) {
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
  function renderBuildFixOffers(appliedFiles, buildErrorText, entry) {
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
      container.appendChild(renderBuildFixRow(filePath, buildErrorText, entry));
    }
  }

  /** Builds one row's DOM for a single candidate file: a button that asks
   * for a fix, then either the model's own honest "can't determine a
   * fix" reason, or the proposed content plus Apply/Discard. Nothing is
   * written to disk, and nothing is logged, unless Apply is clicked.
   * `entry` (the artifact this fix offer came from) is threaded through
   * only so Apply can attribute the resulting audit-log entry to it --
   * same reasoning as applyWiringMerge's own remote/id params. */
  function renderBuildFixRow(filePath, buildErrorText, entry) {
    const row = document.createElement('div');
    row.className = 'build-fix-row';

    // Scoped to THIS row alone -- a shared module-level counter here used
    // to let clicking "Ask" on one file's row silently discard a
    // DIFFERENT file's row's still-in-flight result the moment it
    // resolved (both rows incremented the same counter, immediately
    // staling the other's captured requestId), even though the two rows
    // target unrelated files. This still guards the originally-intended
    // case -- this row's own second click superseding its first request.
    let buildFixRequestId = 0;

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
                remote: entry ? entry.remoteName : undefined,
                id: entry ? entry.manifest.id : undefined,
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
      // A real, confirmed bug in the old "Update is just a pull under a
      // friendlier label" shortcut: pull always OVERWRITES/ADDS files from
      // the new payload, but never DELETES a file the new version actually
      // REMOVED -- that stale file would silently survive in the project
      // forever. artifact.applyUpdate (Phase 16) fixes this (diffs the old
      // pristine snapshot against the new payload to find removed files)
      // and re-verifies no local edit snuck in since the last check, rather
      // than trusting this button's own client-side state. Artifacts that
      // declare wiring_actions keep going through the existing
      // pullAndAutoWire path instead (below) -- applyUpdate deliberately
      // doesn't attempt to auto-apply a NEW wiring_action a version bump
      // might have added, so the wiring-aware path stays how it already
      // was rather than losing that behavior.
      const hasWiring = entry.manifest.wiring_actions && entry.manifest.wiring_actions.length > 0;
      return { label: 'Update', action: hasWiring ? 'pull' : 'applyUpdate' };
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
      const opKey = await beginProgress();
      let succeeded = 0;
      const failures = [];
      // Every artifact pulled here shares the same `cwd`/`.gitignore`, so a
      // warning from one is the exact same warning every other would also
      // produce -- a single aggregated toast at the end is the right call,
      // not one per artifact (which would just be the same message N times).
      let gitignoreWarning;
      for (let i = 0; i < pullable.length; i += 1) {
        const entry = pullable[i];
        // Same real bug fix as the single-artifact "Update" button: an
        // already-pulled entry here means displayStatus is 'update_available'
        // (isBulkPullable's only other eligible status besides 'not_pulled'),
        // and a plain pull never deletes a file the new version removed --
        // applyUpdate does. Bulk pull already doesn't special-case
        // wiring_actions even for 'not_pulled' entries (a deliberate existing
        // simplification, not something this changes).
        const isUpdate = displayStatus(entry) === 'update_available';
        btn.textContent = `${isUpdate ? 'Updating' : 'Pulling'} ${i + 1}/${pullable.length}: ${entry.manifest.id}`;
        try {
          if (isUpdate) {
            const [result] = await call('artifact.applyUpdate', { id: entry.manifest.id, cwd: state.projectDir });
            if (result && !result.applied) {
              failures.push(`${entry.manifest.id}: ${result.reason}`);
              continue;
            }
            succeeded += 1;
          } else {
            const result = await call('artifact.pull', {
              id: entry.manifest.id,
              remote: entry.remoteName,
              cwd: state.projectDir,
            });
            succeeded += 1;
            gitignoreWarning = gitignoreWarning || result.gitignoreWarning;
          }
        } catch (err) {
          failures.push(`${entry.manifest.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      endProgress(failures.length === 0, opKey);

      if (succeeded > 0) {
        // "Pulled" (not "processed"/"handled") stays the right word even
        // for the update_available entries in this batch -- pulling IS
        // literally what applyUpdate does under the hood, just more safely.
        toastSuccess(`Pulled/updated ${succeeded} artifact${succeeded === 1 ? '' : 's'}`);
      }
      if (gitignoreWarning) {
        toastError(new Error(gitignoreWarning));
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
    hideProgressPanel();
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
            <span class="badge ${status}">${statusLabel(status)}</span>
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

  /** Builds one Browse-style `.res-card` element for `entry` -- shared by
   * Browse's own grid and the kind-scoped Starter Kits/Backend Plugins
   * pages (see renderKindListPage) so all three stay visually identical
   * by construction rather than three copies that can silently drift.
   * The whole card is the click target -- Pull/Push moved into Detail,
   * so there's no inner action button to carve out a stopPropagation()
   * exception for anymore. */
  function buildResCard(entry) {
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
    card.querySelector('.badge').textContent = statusLabel(status);
    card.addEventListener('click', () => openDetail(entry));
    return card;
  }

  function renderCards() {
    const grid = $('card-grid');
    renderBrowsePullAllButton();

    const entries = filteredEntries();
    grid.innerHTML = '';

    // A failed load is NOT an empty catalog. Showing "No artifacts match."
    // after `catalog.list` threw is actively misleading -- it reads as "your
    // remote has nothing in it" when the truth is "we could not reach it".
    const errorHost = $('browse-error');
    if (state.catalogError) {
      errorHost.hidden = false;
      renderErrorState(
        errorHost,
        'Could not load the catalog',
        state.catalogError,
        () => refreshCatalogFromRemotes(),
      );
      $('browse-empty').hidden = true;
      return;
    }
    errorHost.hidden = true;
    errorHost.innerHTML = '';

    $('browse-empty').hidden = entries.length !== 0;
    $('browse-empty').textContent =
      state.search.trim() || state.activeKinds.size > 0
        ? 'No artifacts match the current filters.'
        : 'No artifacts match.';

    for (const entry of entries) {
      grid.appendChild(buildResCard(entry));
    }
  }

  /** Runs `action` ('pull', 'push', or 'applyUpdate') for `entry`, driving
   * the shared progress/log panel (see beginProgress/endProgress) around
   * the call. The single call site for all three actions everywhere they
   * can be triggered one-at-a-time: Detail's action button, and a row's
   * own inline button inside a Tag Folder view. */
  async function runArtifactAction(entry, action, button) {
    await withBusy(button, 'Working...', async () => {
      await beginProgress(entry);
      try {
        if (action === 'applyUpdate') {
          const [result] = await call('artifact.applyUpdate', {
            id: entry.manifest.id,
            cwd: state.projectDir,
          });
          if (!result) {
            // Its own client-side availableVersion was stale (someone/
            // something else already resolved it) -- nothing to report as
            // an error, just nothing left to do.
            toastSuccess(`"${entry.manifest.id}" is already up to date.`);
          } else if (result.applied) {
            toastSuccess(
              `Updated "${entry.manifest.id}" ${result.previousVersion} -> ${result.availableVersion}.`
                + (result.note ? ` ${result.note}` : ''),
            );
          } else {
            toastError(new Error(result.reason));
          }
        } else if (action === 'pull') {
          // Phase 10 item 1: only artifacts that actually declare
          // wiring_actions opt into the auto-apply-and-test path -- every
          // other artifact (the overwhelming majority) keeps using the
          // plain pull command, unchanged, same "gate on field presence,
          // never a kind check" convention every earlier Phase 7/8 piece
          // already established.
          const hasWiring = entry.manifest.wiring_actions && entry.manifest.wiring_actions.length > 0;
          if (hasWiring) {
            const { pullResult, wiring, build, healthSummary } = await call('artifact.pullAndAutoWire', {
              id: entry.manifest.id,
              remote: entry.remoteName,
              cwd: state.projectDir,
            });
            // Phase 12: one coherent plain-language read of everything
            // that happened (wiring applied/needsReview, build outcome,
            // AND any still-missing install params -- the toast this
            // replaces silently never mentioned that last one at all),
            // computed once in the engine so this and the persistent
            // Detail banner below always agree.
            toastSuccess(healthSummary);
            lastAutoWireSummary = { key: entryKey(entry), summary: healthSummary };
            // A real secrets-exposure risk gets its OWN toast, additional
            // to the calm health summary above -- never folded into it,
            // where it could easily get missed among routine wiring/build
            // news.
            if (pullResult.gitignoreWarning) {
              toastError(new Error(pullResult.gitignoreWarning));
            }
            if (build.ran && !build.success) {
              // Surface the real build output where it's actually visible
              // -- reuses the existing progress log rather than inventing
              // a new UI surface for this.
              recordProgress(entry, 'build', build.output || 'Build failed.');
              // Phase 10 item 2: offer to try fixing one of the files this
              // same pull just auto-wired -- never any other file. Never
              // offered for a timeout or a missing build tool (Phase 13's
              // timeout work) -- neither is a real code problem an AI
              // file-edit could fix (it can't repair a hung process or
              // make a missing tool exist on this machine), so offering it
              // here would just waste a real API call on something it
              // fundamentally can't address.
              if (!build.timedOut && !build.toolNotFound) {
                renderBuildFixOffers(wiring.applied, build.output || '', entry);
              }
            }
          } else {
            const result = await call('artifact.pull', {
              id: entry.manifest.id,
              remote: entry.remoteName,
              cwd: state.projectDir,
            });
            toastSuccess(`Pulled ${result.manifest.id}`);
            if (result.gitignoreWarning) {
              toastError(new Error(result.gitignoreWarning));
            }
          }
        } else {
          const result = await call('artifact.push', {
            id: entry.manifest.id,
            cwd: state.projectDir,
            options: {},
          });
          toastSuccess(`Pushed ${entry.manifest.id}: opened PR #${result.number}`, result.url);
        }
        endProgress(true, entry);
        await loadCatalog();
      } catch (err) {
        endProgress(false, entry);
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
    const opKey = await beginProgress();
    try {
      const updates = await call('sync.checkForUpdates', { cwd: state.projectDir });
      endProgress(true, opKey);

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
      endProgress(false, opKey);
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
      await beginProgress(entry);
      try {
        const results = await resolvePendingPushesCore();
        endProgress(true, entry);

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
        endProgress(false, entry);
        toastError(err);
      }
    });
  }

  /** Detail's Remove button handler (Phase 13's uninstall): confirm-gated,
   * same tone as the "discard local edit and re-sync" confirm above --
   * names the artifact and says plainly what's about to happen, since
   * deleting real installed files is not reversible from inside the app.
   * Uses the same withBusy/beginProgress/loadCatalog+refreshDetailIfShown
   * shape as runArtifactAction/handleCheckPushStatus, so this artifact's
   * card and Detail view both reflect its now-not_pulled status the exact
   * same way a fresh pull's own catalog refresh already does. The
   * manual-review follow-up (filesNeedingManualReview/envParamsStillSet)
   * gets its OWN toast, same posture as pullResult.gitignoreWarning
   * elsewhere in this file -- never folded into the success toast, where
   * it could easily get missed among routine "removed" news. */
  async function handleRemoveArtifact(entry) {
    if (
      !window.confirm(
        `This will delete ${entry.manifest.id}'s installed files from this project and stop ` +
          `tracking it in DeliveryOS. This cannot be undone. Continue?`,
      )
    ) {
      return;
    }

    const btn = $('detail-remove-btn');
    await withBusy(btn, 'Removing...', async () => {
      await beginProgress(entry);
      try {
        const result = await call('artifact.remove', {
          id: entry.manifest.id,
          cwd: state.projectDir,
        });
        endProgress(true, entry);
        toastSuccess(`Removed ${entry.manifest.id}.`);

        const followUps = [];
        if (result.filesNeedingManualReview.length > 0) {
          followUps.push(`files needing manual review: ${result.filesNeedingManualReview.join(', ')}`);
        }
        if (result.envParamsStillSet.length > 0) {
          followUps.push(`.env.local values still set: ${result.envParamsStillSet.join(', ')}`);
        }
        if (followUps.length > 0) {
          toastError(new Error(`Not fully cleaned up automatically -- ${followUps.join('; ')}.`));
        }

        await loadCatalog();
        refreshDetailIfShown(entry);
      } catch (err) {
        endProgress(false, entry);
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
      await beginProgress(entry);
      try {
        const result = await call('artifact.push', {
          id: entry.manifest.id,
          cwd: state.projectDir,
          options: { metadataEdit },
        });
        endProgress(true, entry);
        toastSuccess(`Updated ${entry.manifest.id} metadata: opened PR #${result.number} (${result.url})`);
        $('detail-edit-form').hidden = true;
        await loadCatalog();
        refreshDetailIfShown(entry);
      } catch (err) {
        endProgress(false, entry);
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
  /** ---- in-flight operation store ----
   *
   * Pull/push/update run in the sidecar and keep running whether or not you
   * stay on the screen that started them. Progress used to be written STRAIGHT
   * TO THE DOM by a listener that `resetProgressPanel()` tore down -- and
   * `resetProgressPanel()` ran on every view switch. So navigating away
   * mid-pull broke things in four separate ways, all of which show up as
   * "if I go back while pulling, things are broken":
   *
   *   1. The listener was unsubscribed, so every remaining progress event for
   *      a still-running pull was silently dropped.
   *   2. Nothing anywhere indicated an operation was still running.
   *   3. Coming back to the artifact showed an EMPTY panel, because the log
   *      lived only in the DOM that had just been cleared.
   *   4. Worst: `endProgress()` wrote "Done"/"Failed" into whatever panel
   *      happened to be on screen. Start a pull, go back, open a different
   *      artifact -- and the first pull's completion stamped the second
   *      artifact's panel.
   *
   * The fix is to stop treating the DOM as the source of truth. An operation's
   * stages accumulate here, keyed by artifact; the panel becomes a pure render
   * of whichever record belongs to the artifact you are currently looking at.
   * Navigating away now costs nothing, and coming back replays the log.
   *
   * Keyed by artifact: the engine's progress events carry no operation id, and
   * `withBusy` already prevents two actions on one artifact at once, so one
   * record per artifact is exactly the granularity available.
   */
  const operations = new Map();

  /** The artifact whose operation is currently receiving progress events.
   * Needed because `sidecar-progress` events are global and carry no id. */
  let activeOperationId = null;

  /** The single, session-long progress subscription. Installed once and never
   * torn down -- the old code subscribed per action and unsubscribed on view
   * change, which is precisely what lost events. */
  let progressUnlistenGlobal = null;

  async function installProgressListener() {
    if (progressUnlistenGlobal) return;
    try {
      progressUnlistenGlobal = await listen('sidecar-progress', (event) => {
        const { stage, message } = event.payload;
        const op = activeOperationId ? operations.get(activeOperationId) : null;
        if (!op) return;
        op.lines.push({ stage, message });
        // Only touch the DOM when this operation's artifact is on screen.
        // Otherwise the record just accumulates, ready to be replayed.
        if (isOperationDisplayed(op)) appendProgressLine(stage, message);
      });
    } catch {
      // listen() failing is rare and non-fatal: operations still run and still
      // reach completion, they just will not stream live stages.
      progressUnlistenGlobal = null;
    }
  }

  /** The operation the panel is currently rendering, or null. This is the
   * single source of truth for "does the panel on screen belong to this
   * operation".
   *
   * An earlier version asked `state.view === 'detail' && detailShownEntryKey
   * === op.entryKey` instead, which was wrong twice over: `#detail-progress`
   * is a PAGE-LEVEL panel (index.html:940, outside every `.view` section)
   * deliberately shared by Browse's card buttons, Tag Folder rows and bulk
   * pulls -- so every operation not started from Detail rendered a panel that
   * then refused to accept its own progress lines or its own "Done", and sat
   * frozen on "Working…" with an empty log. A bulk pull, keyed `__global__`,
   * could never match a `detailShownEntryKey` at all, so it was dead by
   * definition. */
  let displayedOperationKey = null;

  /** Appends a stage to an operation's record, and to the panel only if that
   * operation is the one on screen.
   *
   * The engine's own progress events go through the listener above; this is
   * for stages the FRONTEND generates -- currently the post-install build
   * result. That line used to be written straight to `$('progress-log')`,
   * which meant it appeared under whatever artifact happened to be displayed
   * (so artifact A's build error showed up in artifact B's log), and it was
   * never stored, so navigating away and back lost it permanently. */
  function recordProgress(entry, stage, message) {
    const key = entry ? entryKey(entry) : activeOperationId;
    const op = key ? operations.get(key) : null;
    if (op) op.lines.push({ stage, message });
    if (!op || isOperationDisplayed(op)) appendProgressLine(stage, message);
  }

  /** True when the panel currently on screen genuinely belongs to `op`. */
  function isOperationDisplayed(op) {
    return displayedOperationKey === op.entryKey;
  }

  /** Renders an operation record into the panel from scratch. Used when
   * opening a Detail view for an artifact that has one, so a log built while
   * you were elsewhere is not lost. */
  function renderOperationPanel(op) {
    displayedOperationKey = op.entryKey;
    const panel = $('detail-progress');
    $('progress-log').innerHTML = '';
    $('build-fix-offers').innerHTML = '';
    $('build-fix-offers').hidden = true;
    panel.hidden = false;
    panel.classList.remove('done', 'error');
    for (const line of op.lines) appendProgressLine(line.stage, line.message);
    if (op.status === 'running') {
      $('progress-status').textContent = 'Working…';
    } else {
      panel.classList.add(op.status === 'done' ? 'done' : 'error');
      $('progress-status').textContent = op.status === 'done' ? 'Done' : 'Failed';
    }
  }

  /** Shows the panel for whichever artifact Detail is about to display, or
   * hides it when that artifact has no operation. Replaces the old
   * "always wipe on navigate" behaviour. */
  function syncProgressPanelToDetail(entry) {
    const op = entry ? operations.get(entryKey(entry)) : null;
    if (op) renderOperationPanel(op);
    else hideProgressPanel();
  }

  /** Hides and empties the panel WITHOUT touching any operation record or the
   * global listener -- the two things the old resetProgressPanel destroyed. */
  function hideProgressPanel() {
    displayedOperationKey = null;
    const panel = $('detail-progress');
    panel.hidden = true;
    panel.classList.remove('done', 'error');
    $('progress-log').innerHTML = '';
    $('build-fix-offers').innerHTML = '';
    $('build-fix-offers').hidden = true;
  }

  /** Starts (or restarts) the operation record for `entry` and shows it.
   *
   * RETURNS the operation key. Callers must hand that key back to
   * `endProgress` rather than relying on `activeOperationId` still pointing at
   * them: with two operations overlapping (a bulk pull running while the user
   * opens an artifact and pulls it individually), whichever finishes first
   * cleared `activeOperationId`, so the second one's `endProgress` found no
   * key at all and never marked its record done -- leaving the "Working…"
   * indicator stuck on screen for the rest of the session with nothing able to
   * clear it. */
  async function beginProgress(entry) {
    await installProgressListener();
    const key = entry ? entryKey(entry) : `__op-${operationSeq += 1}`;
    activeOperationId = key;
    const op = { entryKey: key, status: 'running', lines: [], startedAt: Date.now() };
    operations.set(key, op);
    renderOperationPanel(op);
    renderRunningIndicator();
    return key;
  }

  /** Counter behind the synthetic keys used by operations with no single
   * artifact (a bulk pull, an update check, Scan's propose). A fixed
   * `'__global__'` string meant two such operations shared one record and
   * overwrote each other. */
  let operationSeq = 0;

  /** Marks the operation finished. Only writes to the DOM if its artifact is
   * still on screen -- otherwise a pull finishing in the background would
   * stamp "Done" onto whatever unrelated artifact you navigated to. */
  function endProgress(success, entryOrKey) {
    const key = typeof entryOrKey === 'string'
      ? entryOrKey
      : (entryOrKey ? entryKey(entryOrKey) : activeOperationId);
    const op = key ? operations.get(key) : null;
    if (op) {
      op.status = success ? 'done' : 'failed';
      if (isOperationDisplayed(op)) {
        const panel = $('detail-progress');
        panel.classList.add(success ? 'done' : 'error');
        $('progress-status').textContent = success ? 'Done' : 'Failed';
      }
    }
    if (activeOperationId === key) activeOperationId = null;
    renderRunningIndicator();
  }

  /** A persistent, app-wide "work is still running" affordance in the context
   * strip. Without it, navigating away from a pull left NO indication anywhere
   * that anything was happening -- the operation simply finished later and a
   * toast appeared out of nowhere. Clicking it returns to that artifact. */
  function renderRunningIndicator() {
    const host = $('running-indicator');
    if (!host) return;
    const running = [];
    for (const op of operations.values()) {
      if (op.status === 'running') running.push(op);
    }
    host.hidden = running.length === 0;
    if (running.length === 0) return;
    host.textContent = running.length === 1 ? 'Working…' : `Working… (${running.length})`;
    // Only offer navigation when there is somewhere to navigate TO. A bulk
    // pull or update check has no single artifact, and the click used to be
    // silently swallowed -- worst on exactly the long-running batch operations
    // you are most likely to have navigated away from.
    const target = state.catalog.find((e) => entryKey(e) === running[0].entryKey);
    host.onclick = target ? () => void openDetail(target) : null;
    host.style.cursor = target ? 'pointer' : 'default';
    host.title = target
      ? `Working on ${target.manifest.id} -- click to open`
      : `${running.length} operation(s) still running`;
  }

  /** Detail's Back button label per possible `state.detailReturnView` --
   * kept next to openDetail (the only place that sets detailReturnView)
   * so the two stay in sync by construction. */
  const DETAIL_RETURN_LABELS = {
    browse: '← Back to Browse',
    'tag-folder': '← Back to Tag Folder',
    'ui-components': '← Back to UI Components',
    'starter-kits': '← Back to Starter Kits',
    'backend-plugins': '← Back to Backend Plugins',
  };

  function openDetail(entry) {
    state.selectedKey = entryKey(entry);
    // Captured BEFORE switching to Detail, while state.view still reflects
    // wherever the user actually is right now -- guarded against
    // overwriting with 'detail' OR 'component-detail'. 'detail' guards
    // against a stale self-loop if this is ever called while already on
    // Detail. 'component-detail' guards a REAL, confirmed loop:
    // back-to-component-grid-btn calls openDetail(...) to return to the
    // SAME artifact's Detail view while state.view is still
    // 'component-detail' at that moment -- without this guard,
    // detailReturnView got overwritten to 'component-detail' (not a real
    // DETAIL_RETURN_LABELS key, and not a valid showView destination
    // either), so the NEXT "Back to Browse" click bounced back into
    // component-detail instead of Browse, forever.
    if (state.view !== 'detail' && state.view !== 'component-detail') {
      state.detailReturnView = state.view;
    }
    $('back-to-browse-btn').textContent =
      DETAIL_RETURN_LABELS[state.detailReturnView] ?? DETAIL_RETURN_LABELS.browse;
    // Show whatever operation belongs to THIS artifact, replaying a log
    // built while you were elsewhere. This used to wipe the panel
    // unconditionally, which is why coming back mid-pull showed nothing.
    syncProgressPanelToDetail(entry);
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
    // Same scroll-reset showView already does -- openDetail/
    // openComponentDetail both navigate via THIS function, not showView.
    scrollContentToTop();
  }

  /** Detail's top-level content tabs -- reuses the exact `.tab-row`/`.tab`/
   * `.tab.active` convention already established for switching preview
   * variants (loadDetailPreview), generalized into top-level sections.
   * Two of these (`preview`/`configuration`) are known synchronously, the
   * rest only resolve after an RPC round-trip -- each section's own
   * render function flips its flag in `detailTabState` and calls
   * `refreshDetailTabs()` once it knows whether it applies, same
   * "decide visibility once it resolves" posture those sections already
   * had; this just adds a shared tab UI on top instead of each section
   * showing/hiding independently in a fixed vertical order. */
  // Order here is display order, left to right -- Design/Components/
  // Documentation lead (per direct user feedback: the concrete, visual
  // "what does this look like" content first), Preview/Configuration/
  // Routes follow.
  // 'configuration' sits first -- for a backend-plugin it's the entire
  // point of the artifact (install_params + Wiring), yet it used to sit
  // 5th, behind three tabs that are frequently irrelevant to a plugin
  // (Design/Components/Documentation are template/ui-component-oriented).
  // Every other tab's relative order is unchanged.
  const DETAIL_TAB_DEFS = [
    { key: 'configuration', label: 'Configuration', panelId: 'detail-configuration-section' },
    { key: 'design', label: 'Design', panelId: 'detail-design-section' },
    { key: 'components', label: 'Components', panelId: 'detail-components-section' },
    { key: 'documentation', label: 'Documentation', panelId: 'detail-documentation-section' },
    { key: 'preview', label: 'Preview', panelId: 'detail-preview-section' },
    { key: 'routes', label: 'Routes', panelId: 'detail-routes-section' },
    { key: 'sourceDrift', label: 'Source drift', panelId: 'detail-source-drift-section' },
    { key: 'activity', label: 'Activity', panelId: 'detail-activity-section' },
  ];

  // The only keys that resolve via an RPC round-trip -- preview/
  // configuration are always known synchronously from the manifest
  // already in hand. Used to show a real loading indicator while any of
  // these is still pending, so a tab that ends up applicable doesn't
  // just silently pop in with no warning it was coming.
  const DETAIL_ASYNC_TAB_KEYS = ['documentation', 'design', 'components', 'routes', 'sourceDrift', 'activity'];

  // Deliberately SEPARATE from DETAIL_TAB_DEFS's own display order
  // (Configuration leads there, per direct user feedback above) -- this is
  // only the priority used to pick a default ACTIVE tab when no real user
  // preference exists yet. Found via review: reusing display order for
  // both purposes silently regressed an earlier, separately-fixed bug
  // (see the "no real preference yet" branch in refreshDetailTabs() below)
  // the moment Configuration's display position moved to first -- Design
  // must still win as the default tab once it resolves and applies, even
  // though Configuration now displays to its left.
  const DETAIL_DEFAULT_TAB_PRIORITY = [
    'design', 'components', 'documentation', 'configuration', 'preview', 'routes', 'sourceDrift', 'activity',
  ];

  function firstByDefaultPriority(applicableDefs) {
    for (const key of DETAIL_DEFAULT_TAB_PRIORITY) {
      const match = applicableDefs.find((def) => def.key === key);
      if (match) return match.key;
    }
    return applicableDefs[0].key;
  }

  let detailTabState = {};
  let detailActiveTabKey = null;
  // Whether detailActiveTabKey is a REAL preference (the person actually
  // clicked a tab) vs. still just an automatic default. This distinction
  // is the whole point: until the person clicks something, the active
  // tab should always track DETAIL_TAB_DEFS's own display order (Design
  // first, once it's known to apply) -- not just "whichever section
  // happened to resolve first in time," which is all Configuration
  // (always synchronous) winning by default, artifact after artifact.
  // Once they DO click a tab, that becomes sticky (see the reassignment
  // rule below) and is never silently overridden again, including across
  // a same-artifact refresh after a Pull/Push/Overwrite.
  let detailActiveTabIsUserChosen = false;
  // Tracks WHICH artifact detailActiveTabKey belongs to -- found by
  // review: renderDetail runs again for the SAME artifact after any
  // successful Pull/Push/Overwrite (via refreshDetailIfShown), and used
  // to unconditionally null out detailActiveTabKey every time, silently
  // kicking the user back to the first tab even though they were still
  // looking at (say) Routes. Only reset the ACTIVE tab when the artifact
  // actually changes; detailTabState itself still gets recomputed fresh
  // every render regardless (content may have genuinely changed).
  let detailShownEntryKey = null;

  // Phase 12: the post-install health summary a pullAndAutoWire call just
  // produced, stashed here (not just toasted) so it's still visible after
  // the toast itself fades -- session-only, keyed by entryKey so it's
  // never shown against a DIFFERENT artifact's Detail view. Cleared
  // implicitly by the key mismatch check in renderPostInstallHealthBanner,
  // same pattern detailShownEntryKey itself uses above.
  let lastAutoWireSummary = null;

  function resetDetailTabState(entry) {
    detailTabState = {};
    const key = entryKey(entry);
    if (key !== detailShownEntryKey) {
      detailActiveTabKey = null;
      detailActiveTabIsUserChosen = false;
    }
    detailShownEntryKey = key;
  }

  function refreshDetailTabs() {
    const applicable = DETAIL_TAB_DEFS.filter((def) => detailTabState[def.key]);
    const tabsRow = $('detail-tabs-row');

    $('detail-tabs-loading').hidden = DETAIL_ASYNC_TAB_KEYS.every((key) => detailTabState[key] !== undefined);

    // At most one section applies -- the common case (most artifacts
    // just have a README) -- so skip the tab-row chrome entirely and show
    // that one section (or nothing) directly, un-tabbed. Still recorded
    // as the (non-user-chosen) active tab so there's continuity if a
    // second tab shows up moments later.
    if (applicable.length <= 1) {
      tabsRow.hidden = true;
      tabsRow.innerHTML = '';
      for (const def of DETAIL_TAB_DEFS) {
        $(def.panelId).hidden = !(applicable.length === 1 && applicable[0].key === def.key);
      }
      if (applicable.length === 1 && !detailActiveTabIsUserChosen) {
        detailActiveTabKey = applicable[0].key;
      }
      return;
    }

    if (detailActiveTabIsUserChosen) {
      // A real preference -- only abandon it once we KNOW it's genuinely
      // not applicable (detailTabState[key] === false), never merely
      // because it hasn't resolved YET (undefined, still awaiting its
      // own RPC) -- sections resolve independently and at different
      // times, so treating "not yet known" the same as "confirmed
      // absent" would silently steal focus the instant ANY other tab
      // happened to resolve first.
      if (detailTabState[detailActiveTabKey] === false) {
        detailActiveTabKey = firstByDefaultPriority(applicable);
        detailActiveTabIsUserChosen = false;
      }
    } else {
      // No real preference yet -- always track DETAIL_DEFAULT_TAB_PRIORITY,
      // recomputed fresh on every call (deliberately NOT DETAIL_TAB_DEFS's
      // own display order -- see that constant's own doc comment for why
      // the two must stay separate). Direct user feedback: Configuration
      // (always synchronous) used to "win" by simply being known before
      // Design/Components (which need a real RPC round-trip) -- once
      // Design/Components resolve and turn out applicable, THIS is what
      // makes the view correctly switch to Design (the intended default)
      // instead of getting stuck on whichever tab merely happened to
      // resolve first, or on Configuration's own new, purely-visual lead
      // position.
      detailActiveTabKey = firstByDefaultPriority(applicable);
    }

    // What's actually SHOWN right now, as distinct from the preference
    // above: if the preferred tab hasn't resolved yet, temporarily fall
    // back to display the first tab that HAS -- without touching
    // detailActiveTabKey itself -- so a same-artifact refresh doesn't
    // blank the whole panel area while specifically the previously-active
    // tab's own section is still mid-flight; once it resolves, display
    // catches up to the real preference on the next refreshDetailTabs()
    // call automatically. (A no-op in the non-user-chosen branch above,
    // since detailActiveTabKey is always freshly in `applicable` there.)
    const displayKey = applicable.some((def) => def.key === detailActiveTabKey)
      ? detailActiveTabKey
      : applicable[0].key;

    tabsRow.hidden = false;
    tabsRow.innerHTML = '';
    for (const def of DETAIL_TAB_DEFS) {
      $(def.panelId).hidden = def.key !== displayKey;
    }
    for (const def of applicable) {
      const tab = document.createElement('button');
      tab.className = `tab${def.key === displayKey ? ' active' : ''}`;
      tab.textContent = def.label;
      tab.addEventListener('click', () => goToDetailTab(def.key));
      tabsRow.appendChild(tab);
    }
  }

  /** Switches Detail to a specific tab programmatically -- the same
   * click-a-tab-button path (a real user preference, sticky across
   * re-renders), just reachable from code too. Used by the tab buttons
   * themselves and by renderConnectionStatusPanel's "needs review" chips,
   * which jump straight to Configuration rather than just naming a count
   * and leaving you to go find it yourself. */
  function goToDetailTab(key) {
    detailActiveTabKey = key;
    detailActiveTabIsUserChosen = true;
    refreshDetailTabs();
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
    $('detail-badge').textContent = statusLabel(status);
    $('detail-badge').className = `badge ${status}`;
    $('detail-description').textContent = manifest.description;
    $('meta-kind').textContent = manifest.kind;
    $('meta-version').textContent = manifest.version;
    $('meta-owner').textContent = manifest.owner;
    // Hidden entirely when the artifact declares no refresh policy, which is
    // most of them. It used to render an em-dash -- a row whose only content
    // was "there is nothing here", taking up the same space as a real fact.
    $('meta-refresh').textContent = manifest.refresh || '';
    $('meta-refresh-item').hidden = !manifest.refresh;

    const tags = manifest.tags || { roles: [], teams: [], stacks: [], componentTypes: [] };
    const pills = [
      ...(tags.roles || []),
      ...(tags.teams || []),
      ...(tags.stacks || []).map((s) => `stack: ${s}`),
      ...(tags.componentTypes || []).map((c) => `component: ${c}`),
    ];
    // Same reasoning as Refresh above: an artifact with no tags shows no Tags
    // row, rather than a pill whose text is "none".
    $('meta-tags').innerHTML = pills.map((p) => `<span class="tag-pill">${escapeHtml(p)}</span>`).join('');
    $('meta-tags-item').hidden = pills.length === 0;

    // Provenance badge: honest about what's actually been verified. No
    // artifact has a real signature yet (Phase 7's item 3, the actual
    // signing pipeline, isn't built) -- this already renders the "Signed"
    // state correctly for whenever one does, without needing to come back
    // and wire this up again later. Always visible regardless of kind
    // (used to render only inside the backend-plugin section) -- whether
    // an artifact is verified is identity/status info, same category as
    // the meta grid below, not documentation.
    const provenanceBadge = $('detail-provenance-badge');
    if (manifest.signature) {
      provenanceBadge.textContent = `✓ Signed (${manifest.signature.algorithm})`;
      provenanceBadge.className = 'provenance-badge signed';
    } else {
      provenanceBadge.textContent = 'Unverified -- no provenance signature yet';
      provenanceBadge.className = 'provenance-badge unsigned';
    }

    // Resets the tab controller for whichever NEW artifact this is --
    // detailTabState starts empty (every key falsy) and each section below
    // flips its own key once it knows whether it applies, calling
    // refreshDetailTabs() itself. The two synchronous ones (already known
    // from the manifest in hand, no RPC needed) are set immediately below;
    // the rest resolve asynchronously.
    resetDetailTabState(entry);
    clearMarkdownIframeListeners();
    clearDetailTemplateListeners();
    // Found by review: this was the one live-iframe listener renderDetail
    // never tore down for a NEW artifact (its only two call sites were
    // openComponentDetail itself and the "back to component grid"
    // button) -- leaving Artifact A's component-detail iframe/listener
    // alive if the user left via the sidebar instead of its own back
    // button, then opened Artifact B directly.
    clearComponentDetailListener();

    detailTabState.preview = manifest.kind === 'ui-component';
    if (detailTabState.preview) {
      void loadDetailPreview(entry);
    } else {
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
    // still show the tab (renderInstallParamsSection/renderWiringSection
    // each independently no-op on their own empty list).
    const hasInstallParams = manifest.install_params && manifest.install_params.length > 0;
    const hasWiringActions = manifest.wiring_actions && manifest.wiring_actions.length > 0;
    detailTabState.configuration = hasInstallParams || hasWiringActions;
    if (detailTabState.configuration) {
      renderPostInstallHealthBanner(entry);
      void renderInstallParamsSection(entry);
      void renderWiringSection(entry);
    }
    renderLifecycleExplainer(entry);
    void renderConnectionStatusPanel(entry);

    refreshDetailTabs();

    // Documentation: README.md and/or GUIDELINES.md's own prose, gated on
    // real file presence -- resolves via RPC, so decides Documentation's
    // own tab membership once it knows (see renderDocumentationTab).
    void renderDocumentationTab(entry);

    // Design/Components (design-kit's tokens/type-scale/layout-rules, and
    // its live component grid): gated on real content presence -- whether
    // GUIDELINES.md actually exists at the payload root -- never a
    // `manifest.kind === 'template'` check. Resolves via RPC, so both tabs
    // decide their own membership once it knows (see
    // renderDesignAndComponentsSections).
    void renderDesignAndComponentsSections(entry);

    // Real route/page map for whole-app templates like the starter kit --
    // same "resolve via RPC, decide tab membership once it resolves"
    // posture, independently gated: an artifact can have a routes.tsx, a
    // README, GUIDELINES.md, all three, or none.
    void renderRoutesSection(entry);

    // Source-drift check: its own tab, gated on real SOURCES.json
    // presence, same "resolve via RPC, decide tab membership once it
    // resolves" posture as Routes above -- an extracted artifact can have
    // a README, GUIDELINES.md, routes.tsx, SOURCES.json, all four, or none.
    void renderSourceDriftSection(entry);

    // Activity (Phase 12): the wiring-merge log's own entries for this
    // artifact, independently gated -- an artifact can have source-drift
    // data, activity data, both, or neither.
    void renderActivitySection(entry);

    $('detail-install-path').textContent = entry.installTarget ?? '';
    $('meta-install-item').hidden = !entry.installTarget;

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

    // Remove (Phase 13's uninstall): same "needs an existing lockfile
    // entry" gate as Open folder/Edit above -- nothing to back out of a
    // project that was never pulled into it.
    const removeBtn = $('detail-remove-btn');
    if (entry.localStatus !== 'not_pulled') {
      removeBtn.hidden = false;
      removeBtn.onclick = () => void handleRemoveArtifact(entry);
    } else {
      removeBtn.hidden = true;
      removeBtn.onclick = null;
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
      // Seeded from the app's real theme, not a hardcoded 'light' -- otherwise
      // this control claims "Light" while sitting inside a dark app.
      getEffectiveTheme(),
    );
    templateThemePicker.onChange((theme) => {
      currentTemplateTheme = theme;
      for (const iframe of detailTemplateIframes) {
        iframe.contentWindow.postMessage({ type: 'setTheme', theme }, '*');
      }
    });
  }

  /** Points the template-preview grid's own Light/Dark control at whatever
   * the app theme currently is, and pushes that to any preview iframe already
   * mounted.
   *
   * There are two theme systems here: the global one (a data-theme attribute
   * on <html>) and this one (a postMessage into each sandboxed preview
   * iframe, which cannot see the parent's CSS). They are genuinely separate
   * mechanisms, but they should never DISAGREE -- and they did, because this
   * one was initialised to a hardcoded 'light' and never heard about the
   * global toggle. */
  function syncTemplateThemeToggle() {
    if (!templateThemePicker) return;
    templateThemePicker.setOptions(
      [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
      currentTemplateTheme,
    );
    for (const iframe of detailTemplateIframes) {
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'setTheme', theme: currentTemplateTheme }, '*');
      }
    }
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
      // Defensive fallback to [] -- the real sidecar handler
      // (detectArtifactMetadata) always returns both arrays populated
      // today, but this assignment happening to succeed with `undefined`
      // followed immediately by `renderInstallParamsList()`/`setValues()`
      // throwing on it would leave `pendingInstallParams` corrupted even
      // after this function's own catch below swallows that error --
      // goToWizardStep('review') reads `pendingInstallParams.length`
      // completely separately afterward, with no try/catch of its own, so
      // a still-`undefined` value there would crash uncaught later, past
      // where this function could still do anything about it.
      pendingInstallParams = detected.installParams ?? [];
      renderInstallParamsList();
      addNewStacksPicker.setValues(detected.stacks ?? []);
      if (detected.description && !$('f-description').value.trim()) {
        $('f-description').value = detected.description;
      }
    } catch (err) {
      // Non-fatal -- the step just starts with empty, fully-manual fields
      // instead of pre-filled ones.
      pendingInstallParams = [];
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

    // Scoped to THIS row alone -- same request-token-guard shape
    // renderBuildFixRow/renderWiringMergeRow use, closing the gap between
    // this function's own doc comment (which already claimed to mirror
    // renderBuildFixRow's structure) and what the code actually did.
    // Guards against a stale artifact.requestAntiPatternFix response
    // clobbering a newer render if this row is reused or the wizard
    // navigates away and back mid-request.
    let designFixRequestId = 0;

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
        const requestId = ++designFixRequestId;
        let fix;
        try {
          fix = await call('artifact.requestAntiPatternFix', { payloadPath, finding });
        } catch (err) {
          if (requestId !== designFixRequestId) return; // superseded while awaiting
          resultEl.hidden = false;
          resultEl.textContent = `Could not get a fix -- ${err instanceof Error ? err.message : String(err)}`;
          return;
        }
        if (requestId !== designFixRequestId) return; // superseded while awaiting

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

    // Let CSS tell the two modes apart. A field label is styled as a step
    // TITLE only in wizard mode, where it genuinely is one; in flat mode all
    // 13 are on screen at once and must read as labels, not as thirteen
    // headings larger than the card title above them.
    $('addnew-form').classList.toggle('addnew-wizard-mode', addNewWizardMode);

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
    hideProgressPanel();
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
      const opKey = await beginProgress();
      try {
        const candidates = await call('scan.run', { cwd: state.projectDir, remote });
        endProgress(true, opKey);
        // Cached so returnToScan can restore this batch later (minus
        // whichever one was just proposed, if any) without a second real
        // network scan -- see that function's own doc comment.
        state.lastScanCandidates = candidates;
        renderScanResults(candidates);
      } catch (err) {
        endProgress(false, opKey);
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
    hideProgressPanel();
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
    hideProgressPanel();
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

  // ---------- theme ----------
  // index.html's own inline head script already applies a saved choice
  // (via the `data-theme` attribute) before first paint, to avoid a flash
  // of the wrong theme -- this section only needs to keep the toggle
  // button's own icon/label in sync and handle the click itself.

  /** No explicit `data-theme` attribute means "following the OS
   * preference" -- resolves that down to the actual theme in effect right
   * now, since the toggle always flips relative to what's ACTUALLY
   * showing, not just whatever was last explicitly chosen. */
  function getEffectiveTheme() {
    const explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'dark' || explicit === 'light') {
      return explicit;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function updateThemeToggleButton() {
    const btn = $('theme-toggle-btn');
    const isDark = getEffectiveTheme() === 'dark';
    // Sun while dark (click it to go back to light), moon while light --
    // the icon always names the theme clicking it will switch TO.
    btn.querySelector('use').setAttribute('href', isDark ? '#i-theme-sun' : '#i-theme-moon');
    const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }

  function toggleTheme() {
    const next = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
    // Suppress transitions across the switch itself. `color` is not a
    // transitioned property and flips instantly, while `background` is -- so
    // without this, every secondary button spends ~150ms as light text on a
    // still-light background and its label visibly disappears. Removed on the
    // next frame so real interactions keep their transitions.
    const html = document.documentElement;
    html.classList.add('theme-switching');
    html.setAttribute('data-theme', next);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => html.classList.remove('theme-switching'));
    });
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (err) {
      // localStorage unavailable -- the choice just won't survive a
      // restart; the toggle itself still works for this session.
    }
    updateThemeToggleButton();
    // A sandboxed markdown iframe cannot read the parent's custom properties,
    // so its theme is baked in at render time -- re-render to re-theme.
    refreshMarkdownIframeThemes();
    // Keep the template-preview grid's own theme following the app's, so the
    // two theme systems cannot drift apart.
    currentTemplateTheme = next;
    syncTemplateThemeToggle();
  }

  function initTheme() {
    updateThemeToggleButton();
    currentTemplateTheme = getEffectiveTheme();
    // Only matters before the user has ever made an explicit choice: keep
    // the button's icon tracking a live OS theme change rather than only
    // whatever `prefers-color-scheme` was at page load.
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!document.documentElement.getAttribute('data-theme')) {
        updateThemeToggleButton();
      }
    });
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

    $('wire-terminal-close').addEventListener('click', () => void closeWireTerminal());
    // Clicking the dimmed backdrop closes, the way a modal is expected to.
    // Guarded on the target being the overlay ITSELF so a click that lands on
    // the panel (or a drag that ends outside it) does not close the session.
    $('wire-terminal-overlay').addEventListener('mousedown', (ev) => {
      if (ev.target === ev.currentTarget) void closeWireTerminal();
    });
    $('theme-toggle-btn').addEventListener('click', () => toggleTheme());
    $('change-folder-btn').addEventListener('click', () => void changeFolder());
    $('refresh-btn').addEventListener('click', () => void refreshCatalogFromRemotes());
    $('check-artifact-updates-btn').addEventListener('click', () => void handleCheckForArtifactUpdates());
    $('add-new-btn').addEventListener('click', () => showView('addnew'));
    $('scan-run-btn').addEventListener('click', () => void handleRunScan());
    $('browse-pull-all-btn').addEventListener('click', () => void handleBrowsePullAll());
    $('tag-folder-pull-all-btn').addEventListener('click', () => void handleTagFolderPullAll());
    $('ui-components-pull-all-btn').addEventListener('click', () => void handleUiComponentsPullAll());
    $('starter-kits-pull-all-btn').addEventListener('click', () => void handleStarterKitsPullAll());
    $('backend-plugins-pull-all-btn').addEventListener('click', () => void handleBackendPluginsPullAll());
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
    // Looks up a FRESH copy from state.catalog by key first (same lookup
    // refreshDetailIfShown already does), falling back to the captured
    // entry only if it's no longer in the catalog -- found by review: an
    // in-flight Pull/Push/Overwrite started from Detail, then a detour
    // into a component's own detail view before it resolved, made
    // refreshDetailIfShown's own refresh silently no-op (state.view was
    // 'component-detail', not 'detail'); reusing the stale captured
    // object here would then show outdated status/badge/version
    // indefinitely instead of picking up the completed action's result.
    $('back-to-component-grid-btn').addEventListener('click', () => {
      clearComponentDetailListener();
      const returnEntry = state.componentDetailReturnEntry;
      const fresh = state.catalog.find((e) => entryKey(e) === entryKey(returnEntry));
      openDetail(fresh ?? returnEntry);
    });
    $('component-detail-pull-btn').addEventListener('click', () => {
      void pullComponentToFolder(
        $('component-detail-pull-btn'),
        state.componentDetailReturnEntry,
        state.componentDetailComponent,
      );
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
    // one" (see createTagPicker), except on the Review step, where Enter
    // doing nothing is safer than accidentally proposing something, and
    // except when a BUTTON itself has focus -- a real, confirmed bug:
    // Back/Review/"Choose file…"/"+ Add param"/"Suggest with Claude" all
    // live inside this same form, so without this exclusion, tabbing to
    // any of them and pressing Enter (a button's own native activation
    // key) got hijacked into "go to next step" instead, making every one
    // of those buttons unreachable via keyboard.
    $('addnew-form').addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') {
        return;
      }
      if (ev.target.classList.contains('tag-picker-input') || ev.target.tagName === 'TEXTAREA'
        || ev.target.tagName === 'BUTTON') {
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
    initTheme();
    initTagPickers();
    wireEvents();

    // One-time subscription for the whole app session, like
    // `sidecar-progress` above: the Rust timer behind it runs for the
    // lifetime of the app and never needs tearing down or re-creating.
    // (`sidecar-progress` used to be re-subscribed per action instead, which
    // is what lost progress events when you navigated away mid-pull -- see
    // the operation store's own comment.)
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
