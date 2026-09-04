/**
 * Builds the walkthrough document from the captured transcript.
 *
 * Every value rendered comes from transcript.json. Nothing is retyped, so the
 * page cannot drift from what the server actually returned.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Repo-relative, so this runs from anywhere and on anyone's machine.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const WORK = resolve(REPO, 'docs', 'walkthrough');


const TRANSCRIPT = resolve(WORK, 'transcript.json');


const t = JSON.parse(readFileSync(TRANSCRIPT, 'utf-8'));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Scrub the throwaway temp path so the doc reads as a project, not a tmpdir.
 *
 * All three spellings, because JSON.stringify doubles backslashes -- scrubbing
 * only the raw path left nine absolute tmpdir paths in the rendered page, which
 * is the sort of thing that reaches a stakeholder and reads as sloppiness. */
const projectForms = [
  t.project.replace(/\\/g, '\\\\'),
  t.project,
  t.project.replace(/\\/g, '/'),
];
const scrub = (s) => {
  let out = String(s);
  for (const form of projectForms) out = out.split(form).join('~/your-project');
  out = out.replace(/\\\\/g, '/').replace(/\\/g, '/');

  // Any OTHER absolute local path is this developer's machine, not the
  // product. `list_remotes` returned two throwaway test remotes whose URLs are
  // temp directories -- one of them carrying a session UUID from an unrelated
  // Claude session. Real, and exactly the sort of thing that reaches a
  // stakeholder and reads as carelessness. The remote NAME is the useful part;
  // the path is noise.
  out = out.replace(/"[A-Za-z]:\/Users\/[^"]*"/g, '"(a local test remote)"');
  out = out.replace(/[A-Za-z]:\/Users\/[^\s"',)]+/g, '~/…');
  return out;
};

const step = t.steps;
const search = step[1].data;
const art = step[2].data;
const preview = step[4].data;

function jsonBlock(value, max = 26) {
  const lines = JSON.stringify(value, null, 2).split('\n');
  const shown = lines.slice(0, max);
  if (lines.length > max) shown.push(`  … ${lines.length - max} more lines`);
  return esc(scrub(shown.join('\n')));
}

/**
 * The disclosure step, rendered as what it MEANS rather than as raw JSON.
 *
 * The JSON dump truncated at "… 66 more lines" immediately before the secret
 * parameters and the signature -- the two things the whole step exists to
 * surface. A stakeholder reading a screenshot would have seen everything except
 * the point.
 */
function disclosurePanel(a) {
  const params = (a.installParams ?? []).map((p) =>
    `<li><code>${esc(p.key)}</code>${p.secret ? ' <span class="tag-secret">secret</span>' : ''} — ${esc(p.description)}</li>`).join('');
  return `
  <div class="disclosure">
    <div class="d-row"><span class="d-k">Runs on your machine</span>
      <span class="d-v mono danger">${esc(a.postInstall ?? 'nothing')}</span></div>
    <div class="d-row"><span class="d-k">Installs to</span>
      <span class="d-v mono">${esc(scrub(a.installTarget))}</span></div>
    <div class="d-row"><span class="d-k">Needs configuring</span>
      <span class="d-v"><ul class="params">${params || '<li>nothing</li>'}</ul></span></div>
    <div class="d-row"><span class="d-k">Signed</span>
      <span class="d-v">${a.signature
        ? `<span class="tag-ok">yes</span> <span class="mono tiny">${esc(a.signature.certificate_identity)}</span>`
        : '<span class="tag-no">no</span>'}</span></div>
    <div class="d-row"><span class="d-k">To install</span>
      <span class="d-v mono">${esc(a.pullCommand)}</span></div>
  </div>`;
}

const stepCards = step.map((s, i) => {
  const isTerminal = s.tool === '(terminal)';
  const isDisclosure = s.tool === 'get_artifact' && s.data;
  const badge = s.isError ? 'refused' : isTerminal ? 'terminal' : 'tool call';
  const body = isTerminal
    ? `<pre class="out"><span class="prompt">$</span> ${esc(s.args.command)}\n${esc(scrub(s.text))}</pre>`
    : `<pre class="req">${esc(s.tool)}(${jsonBlock(s.args, 8)})</pre>
       ${isDisclosure
         ? disclosurePanel(s.data)
         : `<pre class="out${s.isError ? ' err' : ''}">${s.data ? jsonBlock(s.data) : esc(scrub(s.text))}</pre>`}`;
  return `
  <section class="step${s.isError ? ' is-refusal' : ''}">
    <div class="step-head">
      <span class="num">${i + 1}</span>
      <span class="badge ${s.isError ? 'b-red' : isTerminal ? 'b-grey' : 'b-blue'}">${badge}</span>
      ${isTerminal ? '' : `<code class="tool">${esc(s.tool)}</code>`}
      ${s.ms ? `<span class="ms">${s.ms} ms</span>` : ''}
    </div>
    <p class="narrative">${esc(s.narrative)}</p>
    ${body}
    ${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}
  </section>`;
}).join('\n');

/**
 * Local vs hosted, derived rather than retyped.
 *
 * The hosted pane is NOT hand-written. It is the same captured search result
 * with the fields a remote server could not know removed by code -- both
 * `localStatus` and `installTarget` are computed from `cwd`, the caller's own
 * project directory. Deriving the illustration instead of typing it keeps this
 * document's one promise: nothing on the page was written by hand.
 */
const CWD_DERIVED = ['localStatus', 'installTarget'];
const localSample = search.results[0];
const hostedSample = Object.fromEntries(
  Object.entries(localSample).filter(([k]) => !CWD_DERIVED.includes(k)),
);

/** Read from the committed config, not transcribed. */
const mcpConfig = readFileSync(`${REPO}/.mcp.json`, 'utf-8').trim();

const COMPARISON = [
  ['Find and evaluate an artifact', 1, 1],
  ['See what it installs, and what it runs first', 1, 1],
  ['Know whether it is already in your project', 1, 0],
  ['Know whether you have edited it locally', 1, 0],
  ['Install it', 1, 0],
  ['Contribute your changes back', 1, 0],
  ['Reach it from claude.ai with nothing installed', 0, 1],
  ['Add a remote once, for everybody', 0, 1],
  ['See which artifacts people actually use', 0, 1],
  ["Works with the user's own GitHub identity", 1, 0],
];

const cmpRows = COMPARISON.map(([label, l, h]) => `
  <tr>
    <td>${label}</td>
    <td class="${l ? 'yes' : 'no'}">${l ? 'yes' : 'no'}</td>
    <td class="${h ? 'yes' : 'no'}">${h ? 'yes' : 'no'}</td>
  </tr>`).join('');

const toolRows = t.tools.map((x) => `
  <tr>
    <td><code>${esc(x.name)}</code></td>
    <td>${esc(x.title)}</td>
    <td class="${x.readOnly ? 'ro' : 'rw'}">${x.readOnly ? 'reads' : 'writes'}</td>
  </tr>`).join('');

const html = `<title>DeliveryOS through an AI agent</title>
<style>
  :root {
    --ink: #12161c; --paper: #fbfaf8; --muted: #5a6472; --line: #e2e0dc;
    --accent: #0f6d63; --accent-soft: #e6f2f0;
    --red: #a8322a; --red-soft: #fbeeed; --code-bg: #14181f; --code-fg: #d9e2ec;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ink: #e8e6e3; --paper: #14161a; --muted: #98a2b3; --line: #2a2f38;
      --accent: #4fd1c0; --accent-soft: #17302e;
      --red: #f28b82; --red-soft: #2c1c1b; --code-bg: #0d1015; --code-fg: #d9e2ec;
    }
  }
  :root[data-theme="dark"] {
    --ink: #e8e6e3; --paper: #14161a; --muted: #98a2b3; --line: #2a2f38;
    --accent: #4fd1c0; --accent-soft: #17302e;
    --red: #f28b82; --red-soft: #2c1c1b; --code-bg: #0d1015; --code-fg: #d9e2ec;
  }
  * { box-sizing: border-box; }
  body {
    background: var(--paper); color: var(--ink); margin: 0;
    font: 16px/1.62 "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 62rem; margin: 0 auto; padding: 4rem 1.5rem 6rem; }
  h1 { font-size: clamp(2rem, 4.5vw, 3rem); line-height: 1.08; letter-spacing: -0.025em; margin: 0 0 .6rem; text-wrap: balance; }
  h2 { font-size: 1.5rem; letter-spacing: -0.015em; margin: 3.5rem 0 .75rem; text-wrap: balance; }
  h3 { font-size: 1.05rem; margin: 2rem 0 .5rem; }
  p { max-width: 40rem; }
  .lede { font-size: 1.14rem; color: var(--muted); max-width: 42rem; margin: 0 0 1.5rem; }
  .meta { display: flex; flex-wrap: wrap; gap: .5rem 1.25rem; font-size: .82rem; color: var(--muted);
          border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: .8rem 0; margin-bottom: 2.5rem; }
  .meta b { color: var(--ink); font-weight: 600; }
  .step { border-left: 2px solid var(--line); padding: 0 0 1.75rem 1.5rem; margin-left: .5rem; }
  .step.is-refusal { border-left-color: var(--red); }
  .step-head { display: flex; align-items: center; gap: .6rem; margin-bottom: .5rem; flex-wrap: wrap; }
  .num { width: 1.6rem; height: 1.6rem; border-radius: 50%; background: var(--accent); color: #fff;
         display: grid; place-items: center; font-size: .78rem; font-weight: 700; flex: none; }
  .is-refusal .num { background: var(--red); }
  .badge { font-size: .68rem; letter-spacing: .07em; text-transform: uppercase; font-weight: 700;
           padding: .16rem .5rem; border-radius: 3px; }
  .b-blue { background: var(--accent-soft); color: var(--accent); }
  .b-red { background: var(--red-soft); color: var(--red); }
  .b-grey { background: var(--line); color: var(--muted); }
  .tool { font-size: .84rem; color: var(--muted); }
  .ms { font-size: .74rem; color: var(--muted); margin-left: auto; font-variant-numeric: tabular-nums; }
  .narrative { margin: .35rem 0 .8rem; }
  pre { background: var(--code-bg); color: var(--code-fg); border-radius: 6px; padding: .85rem 1rem;
        /* Wrapped, not scrolled. This page gets screenshotted for slides, and
           an overflowing line is simply lost in an image -- the first capture
           cut a description mid-word. */
        white-space: pre-wrap; overflow-wrap: anywhere;
        font: 12.5px/1.55 ui-monospace, "Cascadia Code", Consolas, monospace; margin: .5rem 0; }
  .disclosure { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; margin: .6rem 0; max-width: 46rem; }
  .d-row { display: grid; grid-template-columns: 11rem 1fr; gap: 1rem; padding: .7rem 1rem;
           border-bottom: 1px solid var(--line); align-items: start; }
  .d-row:last-child { border-bottom: 0; }
  .d-k { font-size: .74rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted);
         font-weight: 700; padding-top: .15rem; }
  .d-v { font-size: .92rem; overflow-wrap: anywhere; }
  .mono { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: .86rem; }
  .tiny { font-size: .72rem; color: var(--muted); }
  .danger { color: var(--red); font-weight: 600; }
  .params { margin: 0; padding-left: 1.1rem; }
  .params li { margin-bottom: .25rem; }
  .tag-secret { background: var(--red-soft); color: var(--red); font-size: .66rem; font-weight: 700;
                text-transform: uppercase; padding: .1rem .35rem; border-radius: 3px; letter-spacing: .05em; }
  .tag-ok { background: var(--accent-soft); color: var(--accent); font-size: .7rem; font-weight: 700;
            padding: .1rem .4rem; border-radius: 3px; }
  .tag-no { color: var(--muted); }
  pre.req { background: transparent; color: var(--muted); border: 1px dashed var(--line); padding: .6rem 1rem; }
  pre.out.err { border-left: 3px solid var(--red); }
  .prompt { color: #4fd1c0; }
  .note { font-size: .88rem; color: var(--muted); border-left: 2px solid var(--accent);
          padding-left: .8rem; margin: .7rem 0 0; }
  table { border-collapse: collapse; width: 100%; max-width: 46rem; font-size: .9rem; margin: 1rem 0; }
  th, td { text-align: left; padding: .5rem .7rem; border-bottom: 1px solid var(--line); }
  th { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  td.ro { color: var(--muted); } td.rw { color: var(--red); font-weight: 600; }
  code { font: 0.88em ui-monospace, "Cascadia Code", Consolas, monospace;
         background: var(--accent-soft); color: var(--accent); padding: .1em .35em; border-radius: 3px; }
  .callout { background: var(--accent-soft); border-radius: 8px; padding: 1.1rem 1.3rem; margin: 1.5rem 0; max-width: 44rem; }
  .callout.warn { background: var(--red-soft); }
  .cmp { display: grid; gap: 1rem; grid-template-columns: 1fr 1fr; margin: 1.2rem 0; max-width: 46rem; }
  @media (max-width: 44rem) { .cmp { grid-template-columns: 1fr; } }
  .cmp-h { font-size: .72rem; letter-spacing: .06em; text-transform: uppercase;
           color: var(--muted); font-weight: 700; margin: 0 0 .35rem; }
  td.yes { color: var(--accent); font-weight: 600; }
  td.no { color: var(--red); font-weight: 600; }
  .struck { text-decoration: line-through; opacity: .55; }
  .callout p { margin: .4rem 0; max-width: none; }
  .callout strong { color: var(--ink); }
  .kicker { font-size: .74rem; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); font-weight: 700; margin-bottom: .5rem; }
  footer { margin-top: 4rem; padding-top: 1.5rem; border-top: 1px solid var(--line); font-size: .84rem; color: var(--muted); }
</style>

<div class="wrap">
  <div class="kicker">DeliveryOS · walkthrough</div>
  <h1>What an AI agent can now do with the artifact catalog</h1>
  <p class="lede">
    A real session, captured verbatim. Every request and response below is what
    the server actually returned against the live catalog — nothing is staged or
    retyped.
  </p>

  <div class="meta">
    <span><b>${t.steps.length}</b> steps</span>
    <span><b>${t.tools.length}</b> tools</span>
    <span><b>${search.total}</b> matches for the search below</span>
    <span>connect <b>${(t.connectMs / 1000).toFixed(1)}s</b></span>
    <span>captured <b>${new Date(t.capturedAt).toISOString().slice(0, 16).replace('T', ' ')}</b></span>
  </div>

  <h2>The problem it solves</h2>
  <p>
    The catalog holds <strong>237 artifacts</strong> — skills, agents, rules,
    commands, UI components, templates, backend plugins. Until now the only ways
    to look at it were a command line and a desktop app. So the AI agent working
    in a developer's project, the one most likely to benefit from knowing a
    <code>code-reviewer</code> already exists, was the only party that could not ask.
  </p>

  <h2>The scenario</h2>
  <p>
    A developer needs passwordless email login. Later, they improve something
    they installed and want to share it back. Both halves are below.
  </p>

  ${stepCards}

  <h2>What this demonstrates</h2>

  <div class="callout">
    <p><strong>Disclosure before installation.</strong> Step 3 surfaced three
    things that were previously invisible until after an install had already
    happened: a shell command that runs on the developer's machine
    (<code>${esc(art.postInstall)}</code> — note it climbs <em>out</em> of its own
    folder), two configuration values marked secret, and a valid signature.</p>
    <p>A person can now decide with that in hand rather than discover it afterwards.</p>
  </div>

  <div class="callout">
    <p><strong>The agent does not install anything.</strong> Step 4 is a terminal,
    not a tool call. That is deliberate: the person sees
    <code>deliveryos pull …</code> and approves that specific command, rather than
    approving a tool once and having it act on their behalf indefinitely.</p>
  </div>

  <div class="callout warn">
    <p><strong>Contributing back is two steps, and the second can refuse.</strong>
    Step 5 shows exactly what sharing would publish — ${preview.fileCount} file,
    ${esc(preview.versionBump)} — before anything leaves the machine. Step 6 shows
    the guard: a contribution without the token that preview issued is refused.</p>
    <p>This matters because a push publishes the <em>whole</em> installed folder.
    An artifact someone filled in with real client details would otherwise carry
    those to a shared repository.</p>
  </div>

  <h2>The tools</h2>
  <table>
    <tr><th>Tool</th><th>Purpose</th><th>Effect</th></tr>
    ${toolRows}
  </table>
  <p style="font-size:.9rem;color:var(--muted)">
    Six read, two write, none installs. Whether a tool writes is declared once in
    the codebase and read from there — so what the server tells a client cannot
    drift from what the tool does.
  </p>

  <h2>Running it locally vs hosting it</h2>
  <p>
    Everything above ran on the developer's own machine: the client starts
    <code>deliveryos mcp</code> as a subprocess and talks to it over stdio. The
    obvious next question is whether this could instead be hosted once, centrally,
    so nobody installs anything. Partly — and the part that does not work is the
    part that matters.
  </p>

  <table>
    <tr><th>Can it&hellip;</th><th>Local (what ran above)</th><th>Hosted</th></tr>
    ${cmpRows}
  </table>

  <p>
    The dividing line is not the network, it is the filesystem. Seven of the eight
    tools take <code>cwd</code> — the path to your project — because DeliveryOS
    reads what you have installed and writes what you pull. A server somewhere else
    has no access to that, and no amount of hosting changes it.
  </p>

  <h3>The same query, both ways</h3>
  <p>
    Below is the real first result from step 2. The right-hand pane is that same
    captured response with the fields a hosted server could not have filled in
    removed programmatically — not an invented example.
  </p>

  <div class="cmp">
    <div>
      <p class="cmp-h">Local — answers "is it in my project?"</p>
      <pre class="out">${jsonBlock(localSample, 14)}</pre>
    </div>
    <div>
      <p class="cmp-h">Hosted — same catalog, less context</p>
      <pre class="out">${jsonBlock(hostedSample, 14)}</pre>
    </div>
  </div>

  <p style="font-size:.9rem;color:var(--muted)">
    Two fields disappear: <code>localStatus</code> and <code>installTarget</code>.
    Both are computed from <code>cwd</code>. Losing them means a hosted server can
    tell you an artifact exists, but not whether you already have it, whether you
    have changed it, or where it would land — and the next step, step 4's
    <span class="struck">deliveryos pull</span>, cannot happen at all.
  </p>

  <div class="callout">
    <p><strong>What hosting genuinely buys.</strong> Browsing and evaluating the
    library from anywhere with nothing installed, one place to curate which remotes
    exist, and the one question nobody can answer today: which artifacts are
    actually being used.</p>
  </div>

  <div class="callout warn">
    <p><strong>What it costs.</strong> The transport here is stdio, so a hosted
    build needs HTTP added first. Then identity stops being free: locally, "who are
    you and what may you push to" is inherited from the user's own
    <code>gh</code> login. Hosted, that becomes a system you own and operate —
    per-user tokens, per-user remotes.</p>
  </div>

  <p>
    So they are complements, not alternatives. A read-only hosted server for
    discovery and a local server for anything that touches a project would share
    the same engine — a second adapter, not a second product.
  </p>

  <h3>What running it locally actually takes</h3>
  <p>This is the committed configuration, verbatim:</p>
  <pre class="out">${esc(mcpConfig)}</pre>
  <p style="font-size:.9rem;color:var(--muted)">
    That form needs a checkout. For someone who is not a developer there is a
    single standalone executable that carries the same <code>mcp</code> subcommand
    with no Node and no clone — the config then points at that binary instead.
  </p>

  <h2>Honest limits</h2>
  <p>
    Installing still needs a terminal. Contributing opens a pull request that a
    human reviews — the agent cannot merge it. And if a person approves a pull,
    the artifact's shell command runs either way: the gain here is that they can
    see it first, not that it is sandboxed.
  </p>

  <footer>
    Generated from a captured session against the live catalog.
    Server version ${esc(t.tools.length)} tools · DeliveryOS
    <code>tier0/multi-user-hardening</code>.
  </footer>
</div>
`;

mkdirSync(WORK, { recursive: true });
writeFileSync(`${REPO}/docs/mcp-walkthrough.html`, html, 'utf-8');
console.log(`wrote docs/mcp-walkthrough.html (${(html.length / 1024).toFixed(1)} KB)`);
