import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

// Unit and controller tests (L1, L2). The e2e suite (L4) has its own config.
export default defineConfig({
  root: decodeURIComponent(new URL('..', import.meta.url).pathname),
  plugins: [WxtVitest()],
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
