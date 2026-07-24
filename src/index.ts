#!/usr/bin/env node
import { buildProgram } from './cli/program';
import { DeliveryOsError } from './engine/errors';

async function main(): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  if (err instanceof DeliveryOsError) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  // Commander throws a CommanderError (with a numeric exitCode) for things
  // like --help and unknown options; let those exit codes pass through
  // unchanged instead of treating them as unexpected failures.
  if (
    err &&
    typeof err === 'object' &&
    'exitCode' in err &&
    typeof (err as { exitCode: unknown }).exitCode === 'number'
  ) {
    process.exit((err as { exitCode: number }).exitCode);
  }
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
