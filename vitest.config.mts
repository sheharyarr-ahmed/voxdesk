import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    // tests/e2e is Playwright's, added at phase 4.
    exclude: ['node_modules/**', 'tests/e2e/**'],
    // src/lib/env.ts parses at import and throws on a missing variable. These
    // are obviously fake and live here rather than in a .env file so they are
    // visible in review and can never be mistaken for real credentials.
    env: {
      ELEVENLABS_API_KEY: 'elevenlabs-fixture-key-not-real-0000',
      ELEVENLABS_AGENT_ID: 'agent_test0000000000000000000000000',
      CAL_API_KEY: 'calcom-fixture-key-not-real-0000',
      CAL_EVENT_TYPE_ID: '5725517',
      DATABASE_URL: 'postgresql://postgres.test:testpassword@localhost:6543/postgres',
      DIRECT_URL: 'postgresql://postgres.test:testpassword@localhost:5432/postgres',
      TOOL_SHARED_SECRET: '0'.repeat(64),
      SESSION_SECRET: '1'.repeat(64),
      DEMO_PASSCODE: 'test-passphrase',
      DAILY_SESSION_CAP: '6',
      DEFAULT_TIMEZONE: 'Asia/Karachi',
    },
  },
});
