import { defineConfig } from 'vitest/config';

// each test file spins up its own typescript programs, so under parallel load a single test can
// take a few seconds. the default 5s is too tight and just makes ci flaky.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } });
