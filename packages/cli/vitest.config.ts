import { defineConfig } from 'vitest/config';

// these tests start servers, real browsers and typescript programs. running the files side by side
// starves them of cpu and makes the browser tests time out, so run one file at a time.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000, fileParallelism: false } });
