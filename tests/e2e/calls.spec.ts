// The observability half, behind the same gate. Phase 3 built these pages; this asserts
// they still render and stay gated once the console lands on the same origin.
//
// Assertions are on structure rather than on row content, so the suite does not fail
// every time a call is added to the database.
import { expect, test } from '@playwright/test';

import { signIn } from './session';

test('the call log renders behind the gate', async ({ page }) => {
  await signIn(page, '/calls');
  await expect(page).toHaveURL(/\/calls$/u);
  await expect(page.getByRole('heading', { name: 'Call log' })).toBeVisible();
});

test('a call opens its detail page with the transcript beside the tool timeline', async ({
  page,
}) => {
  await signIn(page, '/calls');

  const rows = page.locator('a[href^="/calls/"]');
  const count = await rows.count();

  if (count === 0) {
    // An empty log is prose, not a blank page, and is a legitimate state.
    await expect(page.getByText('No calls yet.')).toBeVisible();
    test.skip(true, 'No calls in the database to open.');
    return;
  }

  await rows.first().click();
  await expect(page).toHaveURL(/\/calls\/.+/u);

  // The Phase 3 gate condition, rendered: transcript, tool timeline, extracted lead.
  await expect(page.getByRole('heading', { name: 'Transcript' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tool timeline' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Extracted lead' })).toBeVisible();
});

test('a call detail page reachable by its natural key does not 500 on timestamps', async ({
  page,
}) => {
  // Phase 3 found that postgres-js returns the text form of a timestamptz because the
  // client sets fetch_types false, and Intl threw RangeError on every row while the
  // typecheck and the unit suite were green. Rendering at all is the assertion.
  await signIn(page, '/calls');

  const rows = page.locator('a[href^="/calls/"]');
  if ((await rows.count()) === 0) {
    test.skip(true, 'No calls in the database to open.');
    return;
  }

  const response = await page.goto((await rows.first().getAttribute('href')) ?? '/calls');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Transcript' })).toBeVisible();
});

test('the call log is not reachable without the cookie', async ({ browser }) => {
  const fresh = await browser.newContext();
  const page = await fresh.newPage();
  await page.goto('/calls');
  await expect(page).toHaveURL(/\/gate/u);
  await fresh.close();
});
