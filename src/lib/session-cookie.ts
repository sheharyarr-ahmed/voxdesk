// Passcode session cookie, SPEC.md section 6.1: vd_session=<expUnix>.<hmac>.
//
// Imported by src/middleware.ts, which runs on the Edge runtime, and by the
// /gate server action and /api/session, which run on Node. Web Crypto is the
// only HMAC primitive present in both, so this file must never import
// node:crypto and must never import verify-hmac.ts, which does.
//
// SPEC.md section 4.2 declares these two functions as synchronous.
// crypto.subtle is async, so they return promises. That is deviation 5 in
// section 6.9. Argument lists and semantics are unchanged, and every call site
// was already async.
import { env } from '@/lib/env';

export const SESSION_COOKIE = 'vd_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 2;

const encoder = new TextEncoder();

// One CryptoKey per isolate. The secret never changes, so a rejection here means
// a broken deployment and caching the rejection is the correct outcome.
let keyPromise: Promise<CryptoKey> | undefined;

function hmacKey(): Promise<CryptoKey> {
  keyPromise ??= crypto.subtle.importKey(
    'raw',
    encoder.encode(env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return keyPromise;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length !== 64 || !/^[0-9a-f]{64}$/.test(hex)) return null;
  // Backed by an explicit ArrayBuffer so the type is Uint8Array<ArrayBuffer>
  // rather than Uint8Array<ArrayBufferLike>, which crypto.subtle.verify rejects
  // because ArrayBufferLike admits SharedArrayBuffer.
  const out = new Uint8Array(new ArrayBuffer(32));
  for (let i = 0; i < 32; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function signSession(exp: number): Promise<string> {
  const payload = String(exp);
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(), encoder.encode(payload));
  return `${payload}.${toHex(signature)}`;
}

export async function verifySession(value: string | undefined): Promise<boolean> {
  if (value === undefined) return false;

  const separator = value.indexOf('.');
  if (separator <= 0) return false;

  const payload = value.slice(0, separator);
  const signature = fromHex(value.slice(separator + 1));

  // Bound the payload before it reaches the MAC. Ten digits covers unix seconds
  // past the year 2286 and rejects a length probing attempt outright.
  if (!/^\d{1,10}$/.test(payload) || signature === null) return false;

  // The constant time comparison lives here. crypto.subtle.verify computes the
  // MAC and compares it internally, so nowhere in this file is a secret derived
  // value compared with === or with a length sensitive helper.
  const authentic = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(),
    signature,
    encoder.encode(payload),
  );
  if (!authentic) return false;

  // exp is read only after the signature has authenticated it, so the fast
  // reject path is never driven by attacker controlled data. An expired but
  // authentic cookie and a forged cookie are indistinguishable to the caller.
  return Number(payload) * 1000 > Date.now();
}

export function sessionCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
} {
  return {
    httpOnly: true,
    // SPEC.md section 6.1 says secure. Pinned to production so the gate stays
    // usable over http://localhost, where a secure cookie is never set at all.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}
