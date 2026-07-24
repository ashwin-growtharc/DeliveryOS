import { Command } from 'commander';
import { registerRemoteCommand } from './commands/remoteAdd';
import { registerListCommand } from './commands/list';
import { registerPullCommand } from './commands/pull';
import { registerPushCommand } from './commands/push';

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

  return program;
}
