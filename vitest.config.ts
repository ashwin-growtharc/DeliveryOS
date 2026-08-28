import * as os from 'node:os';
import { defineConfig } from 'vitest/config';

/** Half the machine's cores, floor 2 -- see the note on poolOptions below. */
const WORKERS = Math.max(2, Math.floor((os.cpus().length || 4) / 2));

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,

    // A handful of tests launch a REAL headless browser (preview.png
    // rendering, via playwright-core) or drive real git against real local
    // remotes. Those are minutes-long-tail work competing with 60+ other
    // files for the same CPU, and the symptom is always the same: a test that
    // finishes in ~6s on its own times out under a full parallel run.
    //
    // That is what made this suite look flaky. Two separate tests hit it --
    // renderPreviewImage's, and push e2e's preview regeneration -- and both
    // times the instinct is to call the test flaky and move on. Neither was:
    // they were starved, and the fix is to stop over-subscribing the machine
    // rather than to keep raising individual timeouts until the number is big
    // enough to hide it.
    //
    // Capping worker threads leaves headroom for a browser process to
    // actually get scheduled. Half the cores is deliberately conservative:
    // the suite is I/O- and subprocess-bound rather than CPU-bound, so the
    // wall-clock cost is small, and determinism is worth far more here than
    // the last few seconds of throughput.
    poolOptions: {
      // min AND max: vitest defaults the minimum to the full core count, so
      // setting only a lower maximum is rejected outright
      // ("minThreads and maxThreads must not conflict").
      threads: {
        minThreads: 1,
        maxThreads: WORKERS,
      },
      forks: {
        minForks: 1,
        maxForks: WORKERS,
      },
    },
  },
});
