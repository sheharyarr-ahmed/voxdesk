// SPEC.md section 11.4 step 1: / redirects to /gate without a cookie, a correct passcode
// admits, a wrong passcode does not.
import { expect, test } from '@playwright/test';

import { PASSCODE, signIn } from './session';

test('an ungated visit to / is redirected to the gate and remembers where it was going', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/gate\?next=%2F$/u);
  await expect(page.getByRole('heading', { name: 'VoxDesk' })).toBeVisible();
});

test('an ungated visit to /calls is redirected too', async ({ page }) => {
  await page.goto('/calls');
  await expect(page).toHaveURL(/\/gate\?next=%2Fcalls$/u);
});

test('the passcode field is visible against the surface it sits on', async ({ page }) => {
  // Phase 3 shipped a gate whose input was an invisible box on an invisible background,
  // because Tailwind's preflight sets input backgrounds transparent. Typecheck, the unit
  // suite and the build were all green while it was unusable, so it is asserted here.
  await page.goto('/gate');
  const field = page.getByLabel('Passcode');
  await expect(field).toBeVisible();

  const background = await field.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(background).not.toBe('transparent');
  expect(background).not.toBe('rgba(0, 0, 0, 0)');

  const borderWidth = await field.evaluate((node) => getComputedStyle(node).borderTopWidth);
  expect(parseFloat(borderWidth)).toBeGreaterThan(0);
});

test('a wrong passcode is refused and does not admit', async ({ page }) => {
  await page.goto('/gate');
  await page.getByLabel('Passcode').fill(`${PASSCODE}-definitely-wrong`);
  await page.getByRole('button', { name: 'Enter' }).click();

  // Scoped by id rather than by role: Next renders its own route announcer with
  // role="alert", so the bare role matches two elements.
  await expect(page.locator('#passcode-error')).toContainText('not right');
  await expect(page).toHaveURL(/\/gate/u);
});

test('the correct passcode admits to the console', async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/$/u);
  // The start button exists only on the console, so it is what distinguishes the two
  // pages. Both carry an h1 reading VoxDesk.
  await expect(page.getByTestId('start-call')).toBeVisible();
  await expect(page.getByText('Voice console')).toBeVisible();
});

test('the gate carries the ElevenLabs attribution the licence requires', async ({ page }) => {
  // SPEC.md section 12. The free plan grants no commercial rights and requires
  // attribution wherever its output is published.
  await page.goto('/gate');
  await expect(page.getByText('Voice by ElevenLabs')).toBeVisible();
});
