/**
 * A real session against the real catalog, captured verbatim.
 *
 * Nothing here is staged: every request and response below is what the server
 * actually returned. The only thing simulated is the developer's side of the
 * conversation, which is what an agent would be doing anyway.
 *
 * Writes a JSON transcript for the HTML walkthrough to render.
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, writeFileSync as wf } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync } from 'fs';

// Repo-relative, so this runs from anywhere and on anyone's machine.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const WORK = resolve(REPO, 'docs', 'walkthrough');
const OUT = resolve(WORK, 'transcript.json');
mkdirSync(WORK, { recursive: true });

const require = createRequire(REPO + '/package.json');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const project = mkdtempSync(join(tmpdir(), 'walkthrough-project-'));
const steps = [];

const client = new Client({ name: 'walkthrough', version: '1.0.0' });
const t0 = Date.now();
await client.connect(new StdioClientTransport({
  command: 'npx', args: ['tsx', 'src/index.ts', 'mcp'], cwd: REPO, env: process.env,
}));
const connectMs = Date.now() - t0;

const tools = (await client.listTools()).tools;

async function step(narrative, toolName, args, note) {
  const t = Date.now();
  const res = await client.callTool({ name: toolName, arguments: args });
  const ms = Date.now() - t;
  const text = res.content[0].text;
  let data = null;
  try { data = JSON.parse(text); } catch { /* refusals are plain text */ }
  steps.push({ narrative, tool: toolName, args, ms, isError: res.isError === true, text, data, note });
  return { data, text, isError: res.isError === true };
}

// ---------------------------------------------------------------- ACT ONE
await step(
  'Before anything else, the agent checks whether DeliveryOS is even configured. An empty catalog and an unconfigured one look identical from search results, and lead to opposite advice.',
  'list_remotes', {},
  'Read-only. No project directory needed.',
);

await step(
  'The developer asks for passwordless email login. The agent searches the way a person actually phrases it -- a sentence, not a keyword.',
  'search_artifacts', { cwd: project, query: 'passwordless email login without a password', limit: 5 },
  'This exact query returned ZERO results before today. Search matched the whole phrase as one substring.',
);

const detail = await step(
  'One candidate looks right. Before recommending it, the agent reads what it would actually do.',
  'get_artifact', { cwd: project, id: 'email-code-auth', remote: 'ai-helpers' },
  'This is the disclosure step. Everything below was invisible until install time before this surface existed.',
);

// ---------------------------------------------------------------- ACT TWO
// A real pull into a scratch project, so the contribution half has something
// genuine to work with. `fastapi-security` is a pure file copy -- no
// post_install, no install_params.
const { execSync } = await import('child_process');
// The CLI installs into its OWN process.cwd() -- there is no env override, so
// the pull has to actually run inside the scratch project.
const tsxCli = require.resolve('tsx/cli', { paths: [REPO] });
const pullOutput = execSync(
  `"${process.execPath}" "${tsxCli}" "${REPO}/src/index.ts" pull fastapi-security --remote ai-helpers`,
  { cwd: project, env: process.env, stdio: 'pipe' },
).toString('utf-8');
steps.push({
  narrative: 'The developer installs it -- in a terminal, the way a person would. There is no install tool on the MCP surface, and that is deliberate.',
  tool: '(terminal)',
  args: { command: 'deliveryos pull fastapi-security --remote ai-helpers' },
  ms: 0,
  isError: false,
  text: pullOutput.trim(),
  data: null,
  note: 'The agent hands over the exact command from get_artifact. The person runs it and sees what it did.',
});

const installed = join(project, '.claude', 'skills', 'fastapi-security');
let edited = false;
try {
  const files = readdirSync(installed);
  const md = files.find((f) => f.endsWith('.md'));
  if (md) {
    const p = join(installed, md);
    writeFileSync(p, readFileSync(p, 'utf-8') + '\n## Rate limiting\n\nAdded from a real engagement.\n', 'utf-8');
    edited = true;
  }
} catch { /* pull went elsewhere; handled below */ }

if (edited) {
  await step(
    'Weeks later the developer has improved that skill and wants to share it back. The agent previews what contributing would publish -- BEFORE anything leaves the machine.',
    'preview_contribution', { cwd: project, id: 'fastapi-security' },
    'Push is all-or-nothing over the whole installed folder. This is the control that makes that safe.',
  );

  await step(
    'The agent tries to contribute without the token the preview returned.',
    'contribute_artifact', { cwd: project, id: 'fastapi-security', confirmationToken: 'guessed-token' },
    'One preview authorises exactly one push. A token cannot be invented, reused, or carried across a restart.',
  );
}

wf(OUT, JSON.stringify({
  capturedAt: new Date().toISOString(),
  connectMs,
  tools: tools.map((t) => ({
    name: t.name,
    title: t.title ?? '',
    readOnly: t.annotations?.readOnlyHint,
    required: t.inputSchema?.required ?? [],
  })),
  instructions: client.getInstructions() ?? '',
  steps,
  project,
}, null, 2), 'utf-8');

await client.close();
rmSync(project, { recursive: true, force: true });

console.log(`captured ${steps.length} steps, ${tools.length} tools`);
for (const s of steps) console.log(`  ${s.isError ? 'REFUSED ' : 'ok      '} ${s.tool.padEnd(22)} ${s.ms}ms`);
