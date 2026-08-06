import { readFileSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';

/**
 * SPEC.md section 11.1 runs Playwright at the phase 4 gate, inside `pnpm verify:all`.
 *
 * The specs drive the console through the section 6.7 seam with
 * `NEXT_PUBLIC_VOICE_MOCK=1`, so the whole suite costs zero ElevenLabs credits and never
 * opens a WebRTC connection. That flag is set in the web server command below and
 * nowhere else in the repository: not in .env.example, not in src/lib/env.ts, and not in
 * Vercel. It gates behaviour only and carries no secret, per section 6.7.
 */

/**
 * The gate specs need DEMO_PASSCODE. Next loads .env.local for the app under test on its
 * own, but this config runs outside Next, so it reads the file itself rather than adding
 * a dependency. Real environment variables always win, which is what a CI run provides.
 */
function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync('.env.local', 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/u, '').replace(/["']$/u, '');
    }
  }
}

loadEnvLocal();

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // A production build rather than `next dev`, because the mock flag is inlined at
    // build time and the point of this suite is to exercise what actually ships.
    //
    // This overwrites .next with a mock build. Deployment goes through git and Vercel
    // builds from source, so the mock can never reach production, but do not pair this
    // with a prebuilt deploy. docs/DEPLOY_CHECKLIST.md says so too.
    command: `NEXT_PUBLIC_VOICE_MOCK=1 pnpm run build && pnpm exec next start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
