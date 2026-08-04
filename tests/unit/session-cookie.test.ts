import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
  signSession,
  verifySession,
} from '@/lib/session-cookie';

afterEach(() => {
  vi.useRealTimers();
});

const future = () => Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;

describe('signSession', () => {
  it('produces exp.hmac with a 64 character hex digest', async () => {
    const exp = future();
    const value = await signSession(exp);
    const [payload, signature] = value.split('.');

    expect(payload).toBe(String(exp));
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same exp', async () => {
    const exp = future();
    expect(await signSession(exp)).toBe(await signSession(exp));
  });
});

describe('verifySession', () => {
  it('accepts a cookie it just signed', async () => {
    expect(await verifySession(await signSession(future()))).toBe(true);
  });

  it('rejects undefined, empty and structurally malformed values', async () => {
    expect(await verifySession(undefined)).toBe(false);
    expect(await verifySession('')).toBe(false);
    expect(await verifySession('nodot')).toBe(false);
    expect(await verifySession('.abc')).toBe(false);
    expect(await verifySession(`${future()}.`)).toBe(false);
  });

  it('rejects a forged signature', async () => {
    // The attack the middleware exists to stop: setting a far future exp by hand
    // and walking straight into the console.
    expect(await verifySession(`9999999999.${'0'.repeat(64)}`)).toBe(false);
    expect(await verifySession('9999999999.00')).toBe(false);
  });

  it('rejects a tampered exp carrying an otherwise valid signature', async () => {
    const exp = future();
    const signature = (await signSession(exp)).split('.')[1];

    expect(await verifySession(`${exp + 3600}.${signature}`)).toBe(false);
  });

  it('rejects a tampered signature carrying a valid exp', async () => {
    const exp = future();
    const signature = (await signSession(exp)).split('.')[1];
    const flipped = (signature[0] === 'a' ? 'b' : 'a') + signature.slice(1);

    expect(await verifySession(`${exp}.${flipped}`)).toBe(false);
  });

  it('rejects a signature that is not 64 hex characters', async () => {
    const exp = future();
    const signature = (await signSession(exp)).split('.')[1];

    expect(await verifySession(`${exp}.${signature.slice(0, 63)}`)).toBe(false);
    expect(await verifySession(`${exp}.${signature.toUpperCase()}`)).toBe(false);
    expect(await verifySession(`${exp}.${'g'.repeat(64)}`)).toBe(false);
  });

  it('rejects a non numeric or oversized payload before it reaches the MAC', async () => {
    expect(await verifySession(`abc.${'0'.repeat(64)}`)).toBe(false);
    expect(await verifySession(`12345678901.${'0'.repeat(64)}`)).toBe(false);
  });

  it('rejects an authentically signed but expired cookie', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T09:00:00.000Z'));

    const value = await signSession(Math.floor(Date.now() / 1000) + 60);
    expect(await verifySession(value)).toBe(true);

    vi.advanceTimersByTime(61_000);
    expect(await verifySession(value)).toBe(false);
  });
});

describe('sessionCookieOptions', () => {
  it('is httpOnly, sameSite lax, root path, two hours', () => {
    const options = sessionCookieOptions();

    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    expect(options.maxAge).toBe(SESSION_TTL_SECONDS);
    expect(SESSION_TTL_SECONDS).toBe(7200);
  });

  it('names the cookie vd_session', () => {
    expect(SESSION_COOKIE).toBe('vd_session');
  });
});
