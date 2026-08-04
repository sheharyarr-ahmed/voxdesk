'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { env } from '@/lib/env';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
  signSession,
} from '@/lib/session-cookie';
import { verifyPasscode } from '@/lib/verify-hmac';

export type GateState = { error: string | null };

/**
 * `next` comes from the query string, so it is attacker controlled. Only a same
 * origin absolute path is allowed: `//evil.com` is a protocol relative URL and
 * would turn the gate into an open redirect.
 */
function safeNext(candidate: FormDataEntryValue | null): string {
  if (typeof candidate !== 'string') return '/';
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return '/';
  return candidate;
}

export async function submitPasscode(
  _previous: GateState,
  formData: FormData,
): Promise<GateState> {
  const submitted = formData.get('passcode');
  if (typeof submitted !== 'string' || submitted.length === 0) {
    return { error: 'Enter the passcode.' };
  }

  // Constant time, and both sides are hashed to a fixed length inside
  // verifyPasscode so timingSafeEqual can never throw on a length mismatch.
  if (!verifyPasscode(submitted, env.DEMO_PASSCODE)) {
    return { error: 'That passcode is not right.' };
  }

  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await signSession(exp), sessionCookieOptions());

  redirect(safeNext(formData.get('next')));
}
