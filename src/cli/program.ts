import { Command } from 'commander';
import { registerRemoteCommand } from './commands/remoteAdd';
import { registerListCommand } from './commands/list';
import { registerPullCommand } from './commands/pull';
import { registerPushCommand } from './commands/push';
import { registerRemoveCommand } from './commands/remove';
import { registerCheckUpdatesCommand } from './commands/checkUpdates';
import { registerCheckDriftCommand } from './commands/checkDrift';
import { registerScanCommand } from './commands/scan';
import { registerWiringCommand } from './commands/wiring';

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
  registerCheckUpdatesCommand(program);
  registerCheckDriftCommand(program);
  registerScanCommand(program);
  registerWiringCommand(program);

  return program;
}
