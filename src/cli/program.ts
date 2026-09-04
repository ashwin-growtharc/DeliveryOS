import { Command } from 'commander';
import { registerRemoteCommand } from './commands/remoteAdd';
import { registerListCommand } from './commands/list';
import { registerPullCommand } from './commands/pull';
import { registerPushCommand } from './commands/push';
import { registerRemoveCommand } from './commands/remove';
import { registerConfigCommand } from './commands/config';
import { registerCheckUpdatesCommand } from './commands/checkUpdates';
import { registerCheckPendingPushesCommand } from './commands/checkPendingPushes';
import { registerCheckDriftCommand } from './commands/checkDrift';
import { registerScanCommand } from './commands/scan';
import { registerWiringCommand } from './commands/wiring';
import { registerWireCommand } from './commands/wire';
import { registerScaffoldBackendPluginCommand } from './commands/scaffoldBackendPlugin';
import { registerMcpCommand } from './commands/mcp';

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('deliveryos')
    .description('DeliveryOS CLI: register git remotes, list/pull/push artifacts')
    // Kept in step with package.json by test/unit/cliVersion.test.ts, which
    // fails the build if they drift. It cannot simply import package.json:
    // tsconfig sets rootDir to src/, so a `../../package.json` import is
    // outside the compilation root. The literal was previously left at 0.1.0
    // while the installer moved on, so the CLI shipped INSIDE a 0.1.2
    // installer reported 0.1.0 -- exactly the kind of drift a hardcoded
    // version guarantees and nothing was checking.
    .version('0.1.2');

  registerRemoteCommand(program);
  registerListCommand(program);
  registerPullCommand(program);
  registerPushCommand(program);
  registerRemoveCommand(program);
  registerConfigCommand(program);
  registerCheckUpdatesCommand(program);
  registerCheckPendingPushesCommand(program);
  registerCheckDriftCommand(program);
  registerScanCommand(program);
  registerWiringCommand(program);
  registerWireCommand(program);
  registerScaffoldBackendPluginCommand(program);
  registerMcpCommand(program);

  return program;
}
