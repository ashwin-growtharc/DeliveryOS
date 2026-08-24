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
import { registerScaffoldBackendPluginCommand } from './commands/scaffoldBackendPlugin';

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('deliveryos')
    .description('DeliveryOS CLI: register git remotes, list/pull/push artifacts')
    .version('0.1.0');

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
  registerScaffoldBackendPluginCommand(program);

  return program;
}
