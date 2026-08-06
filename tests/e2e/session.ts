// Shared gate helper. Not a .spec.ts, so Playwright does not collect it as a suite.
//
// Every page in this build except /gate sits behind the SPEC.md section 6.1 cookie, so
// all three specs need this and none of them should own it.
import { expect, type Page } from '@playwright/test';

export const PASSCODE = process.env.DEMO_PASSCODE ?? '';

/** Walks the real gate rather than forging the cookie, so the gate is exercised too. */
export async function signIn(page: Page, next = '/'): Promise<void> {
  expect(PASSCODE, 'DEMO_PASSCODE must be set for the e2e run').not.toBe('');

  await page.goto(`/gate?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Passcode').fill(PASSCODE);
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/gate'));
}
