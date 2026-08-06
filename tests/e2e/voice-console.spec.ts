// The console state machine, driven end to end through the SPEC.md section 6.7 seam
// against the scripted fake. Zero ElevenLabs traffic, zero voice minutes, zero credits.
//
// This is the check that made the seam worth building: the states a visitor moves through
// are the expensive thing to test on a metered platform, and they are free here.
import { expect, test } from '@playwright/test';

import { signIn } from './session';

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('the console opens idle and invites the visitor to start', async ({ page }) => {
  await expect(page.getByTestId('console-status')).toHaveText('idle');
  await expect(page.getByTestId('console-status-line')).toContainText('Ready');
  await expect(page.getByTestId('start-call')).toBeEnabled();
  // The transcript is a prose empty state, not a spinner or an icon.
  await expect(page.getByTestId('transcript')).toContainText('Nothing spoken yet');
});

test('starting a call walks connecting into a live session', async ({ page }) => {
  await page.getByTestId('start-call').click();

  await expect(page.getByTestId('console-status')).toHaveText(/listening|agent speaking/u, {
    timeout: 15_000,
  });
  await expect(page.getByTestId('end-call')).toBeVisible();
  // The conversation id is surfaced so a visitor can find their own call in the log.
  await expect(page.getByText(/^conv_/u)).toBeVisible();
});

test('spoken turns land in the transcript in order, both roles', async ({ page }) => {
  await page.getByTestId('start-call').click();

  const transcript = page.getByTestId('transcript');
  await expect(transcript).toContainText('SheryLabs concierge', { timeout: 15_000 });
  await expect(transcript).toContainText('voice agent that answers questions', {
    timeout: 15_000,
  });

  await expect(transcript.getByText('agent', { exact: true }).first()).toBeVisible();
  await expect(transcript.getByText('you', { exact: true }).first()).toBeVisible();
});

test('a tool call renders with a measured round trip, and mint carries that meaning', async ({
  page,
}) => {
  await page.getByTestId('start-call').click();

  const transcript = page.getByTestId('transcript');
  await expect(transcript).toContainText('check_availability', { timeout: 15_000 });
  await expect(transcript).toContainText('book_meeting', { timeout: 15_000 });

  // The latency is measured in the browser, request event to response event, and is
  // labelled as such because /calls shows a different span measured inside our route.
  const latency = transcript.getByText(/^\d+ ms$/u).first();
  await expect(latency).toBeVisible({ timeout: 15_000 });
  await expect(transcript).toContainText('round trip, in browser');

  // Mint is the one accent in this console and it means evidence the machine did work.
  const colour = await latency.evaluate((node) => getComputedStyle(node).color);
  expect(colour).toBe('rgb(110, 231, 183)');
});

test('the email fallback can be opened by hand, submitted, and dismissed', async ({ page }) => {
  // SPEC.md section 6.3. The automatic reveal rests on an optional SDK event, so the
  // typed path is always reachable and that is what is asserted here.
  await page.getByTestId('start-call').click();
  await expect(page.getByTestId('open-email-fallback')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('open-email-fallback').click();
  const fallback = page.getByTestId('email-fallback');
  await expect(fallback).toBeVisible();

  const field = fallback.getByLabel('Type your email');
  const background = await field.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(background).not.toBe('rgba(0, 0, 0, 0)');

  await field.fill('you@company.com');
  await fallback.getByRole('button', { name: 'Send to agent' }).click();

  await expect(fallback).toBeHidden();
  await expect(page.getByTestId('transcript')).toContainText('you@company.com');
});

test('an empty email is refused without blocking the visitor', async ({ page }) => {
  await page.getByTestId('start-call').click();
  await expect(page.getByTestId('open-email-fallback')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('open-email-fallback').click();

  await page.getByTestId('email-fallback').getByRole('button', { name: 'Send to agent' }).click();
  await expect(page.getByTestId('email-fallback').getByRole('alert')).toContainText('Type the address');
});

test('ending the call keeps the transcript, because /calls has no row until the webhook lands', async ({
  page,
}) => {
  await page.getByTestId('start-call').click();
  await expect(page.getByTestId('transcript')).toContainText('check_availability', {
    timeout: 15_000,
  });

  await page.getByTestId('end-call').click();

  await expect(page.getByTestId('console-status')).toHaveText('idle', { timeout: 15_000 });
  await expect(page.getByTestId('transcript')).toContainText('check_availability');
  await expect(page.getByTestId('start-call')).toContainText('Start another call');
});

test('the console carries the ElevenLabs attribution the licence requires', async ({ page }) => {
  await expect(page.getByText('Voice by ElevenLabs')).toBeVisible();
});
