import { Command } from 'commander';
import { runMcpServer } from '../../mcp/server';
import { createEngineConfigPort, createEngineReadPort } from '../../mcp/engineAdapter';

/**
 * A subcommand rather than a second binary.
 *
 * `src/sidecar.ts` is a separate entry point only because Tauri spawns it at a
 * fixed path with no argv. An MCP client's config is
 * `{"command": ..., "args": [...]}`, so a subcommand costs nothing there and
 * keeps one bin, one SEA build, and one version string.
 *
 * NOTE for anyone editing this file: the action body must never print. Every
 * other command in this directory opens with a `console.log`, and one here
 * would corrupt the JSON-RPC stream on stdout. `eslint.config.js` scopes
 * `no-console` to this file for that reason.
 */
export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description(
      'Run the DeliveryOS MCP server over stdio, exposing read-only catalog tools to an '
        + 'MCP client such as Claude Code or Claude Desktop',
    )
    .action(async () => {
      // `program.version()` rather than a literal: see the note on
      // `McpServerDeps.version`. Commander returns the configured string when
      // called with no argument.
      // This command is the composition root: it is where the abstract
      // port is bound to the real DeliveryOS engine.
      await runMcpServer({
        port: createEngineReadPort(),
        // Opt-in, and taken here because this is the composition root. Without
        // it the server exposes no configuration tools at all -- which is the
        // shape any other embedder gets unless it asks for more.
        configPort: createEngineConfigPort(),
        version: program.version() ?? '0.0.0',
      });
    });
}
