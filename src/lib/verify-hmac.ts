// Signature and shared secret verification. Node runtime only. Nothing on the
// Edge runtime imports this file, which is why it may use node:crypto and keep
// the synchronous SPEC.md section 4.2 signatures.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Constant time string comparison.
 *
 * timingSafeEqual throws ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH when the buffers
 * differ in length. Called on raw secrets that both leaks the length and crashes
 * the caller on the first wrong guess, so both sides are hashed to a fixed 32
 * bytes first.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

export function verifyToolSecret(header: string | null, expected: string): boolean {
  if (header === null || expected.length === 0) return false;
  return constantTimeEquals(header, expected);
}

export function verifyPasscode(submitted: string, expected: string): boolean {
  if (expected.length === 0) return false;
  return constantTimeEquals(submitted, expected);
}

/**
 * ElevenLabs post call webhook signature, SPEC.md section 6.6.
 *
 * Header format is `ElevenLabs-Signature: t=<unix>,v0=<hex>`. The signed string
 * is `${t}.${rawBody}`, HMAC-SHA256, hex digest, secret used raw. Multiple v0
 * values may be present and any match accepts.
 *
 * Built in phase 1 alongside the other boundary code and unit tested here. The
 * route that calls it is phase 3.
 */
export function verifyElevenLabsSignature(a: {
  rawBody: string;
  header: string | null;
  secret: string;
  toleranceSeconds?: number;
}): { ok: true } | { ok: false; reason: string } {
  const tolerance = a.toleranceSeconds ?? 1800;

  if (a.secret.length === 0) return { ok: false, reason: 'secret_not_configured' };
  if (a.header === null || a.header.length === 0) return { ok: false, reason: 'missing_header' };

  let timestamp: string | null = null;
  const signatures: string[] = [];

  for (const part of a.header.split(',')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (key === 't' && timestamp === null) timestamp = value;
    else if (key === 'v0') signatures.push(value);
  }

  if (timestamp === null || !/^\d{1,15}$/.test(timestamp)) {
    return { ok: false, reason: 'malformed_timestamp' };
  }
  if (signatures.length === 0) return { ok: false, reason: 'missing_signature' };

  const sentAt = Number.parseInt(timestamp, 10);
  const skew = Math.abs(Math.floor(Date.now() / 1000) - sentAt);
  if (skew > tolerance) return { ok: false, reason: 'timestamp_out_of_tolerance' };

  const expected = createHmac('sha256', a.secret)
    .update(`${timestamp}.${a.rawBody}`, 'utf8')
    .digest('hex');

  for (const candidate of signatures) {
    if (constantTimeEquals(candidate, expected)) return { ok: true };
  }

  return { ok: false, reason: 'signature_mismatch' };
}
