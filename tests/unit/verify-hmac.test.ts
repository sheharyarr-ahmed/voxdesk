import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { verifyElevenLabsSignature, verifyPasscode, verifyToolSecret } from '@/lib/verify-hmac';

afterEach(() => {
  vi.useRealTimers();
});

describe('verifyToolSecret', () => {
  const expected = 'a'.repeat(64);

  it('accepts the exact secret', () => {
    expect(verifyToolSecret(expected, expected)).toBe(true);
  });

  it('rejects a wrong secret, a missing header and an empty expectation', () => {
    expect(verifyToolSecret('b'.repeat(64), expected)).toBe(false);
    expect(verifyToolSecret(null, expected)).toBe(false);
    // An unset TOOL_SHARED_SECRET must never make every request authorised.
    expect(verifyToolSecret(expected, '')).toBe(false);
  });

  it('rejects a differing length without throwing', () => {
    // timingSafeEqual throws on a length mismatch, so both sides are hashed to
    // a fixed 32 bytes first. Without that this call crashes the route.
    expect(() => verifyToolSecret('short', expected)).not.toThrow();
    expect(verifyToolSecret('short', expected)).toBe(false);
    expect(verifyToolSecret(expected + 'extra', expected)).toBe(false);
  });
});

describe('verifyPasscode', () => {
  it('accepts the exact passcode and rejects near misses', () => {
    expect(verifyPasscode('open-sesame', 'open-sesame')).toBe(true);
    expect(verifyPasscode('open-sesamf', 'open-sesame')).toBe(false);
    expect(verifyPasscode('open-sesam', 'open-sesame')).toBe(false);
    expect(verifyPasscode('', 'open-sesame')).toBe(false);
  });

  it('never authorises against an empty expectation', () => {
    expect(verifyPasscode('', '')).toBe(false);
    expect(verifyPasscode('anything', '')).toBe(false);
  });
});

describe('verifyElevenLabsSignature', () => {
  const secret = 'wsec_' + 'f'.repeat(64);
  const rawBody = '{"type":"post_call_transcription","data":{"conversation_id":"conv_1"}}';

  function sign(timestamp: number, body = rawBody, key = secret): string {
    return createHmac('sha256', key).update(`${timestamp}.${body}`, 'utf8').digest('hex');
  }

  function freezeAt(unixSeconds: number): void {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(unixSeconds * 1000));
  }

  it('accepts a correctly signed body', () => {
    const t = 1_785_000_000;
    freezeAt(t);

    expect(
      verifyElevenLabsSignature({ rawBody, header: `t=${t},v0=${sign(t)}`, secret }),
    ).toEqual({ ok: true });
  });

  it('accepts when any one of several v0 values matches', () => {
    const t = 1_785_000_000;
    freezeAt(t);

    const header = `t=${t},v0=${'0'.repeat(64)},v0=${sign(t)}`;

    expect(verifyElevenLabsSignature({ rawBody, header, secret })).toEqual({ ok: true });
  });

  it('rejects a body modified after signing', () => {
    // This is the whole reason HMAC beats a bearer token: the signature is bound
    // to the body, so a captured header cannot be replayed against a changed one.
    const t = 1_785_000_000;
    freezeAt(t);

    const result = verifyElevenLabsSignature({
      rawBody: rawBody.replace('conv_1', 'conv_2'),
      header: `t=${t},v0=${sign(t)}`,
      secret,
    });

    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rejects a signature made with a different secret', () => {
    const t = 1_785_000_000;
    freezeAt(t);

    const result = verifyElevenLabsSignature({
      rawBody,
      header: `t=${t},v0=${sign(t, rawBody, 'wsec_' + '0'.repeat(64))}`,
      secret,
    });

    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rejects a timestamp outside the 1800s tolerance in both directions', () => {
    const t = 1_785_000_000;
    freezeAt(t);

    const old = t - 1801;
    const future = t + 1801;

    expect(verifyElevenLabsSignature({ rawBody, header: `t=${old},v0=${sign(old)}`, secret }))
      .toEqual({ ok: false, reason: 'timestamp_out_of_tolerance' });
    expect(verifyElevenLabsSignature({ rawBody, header: `t=${future},v0=${sign(future)}`, secret }))
      .toEqual({ ok: false, reason: 'timestamp_out_of_tolerance' });
  });

  it('accepts right at the tolerance boundary', () => {
    const t = 1_785_000_000;
    freezeAt(t);
    const edge = t - 1800;

    expect(verifyElevenLabsSignature({ rawBody, header: `t=${edge},v0=${sign(edge)}`, secret }))
      .toEqual({ ok: true });
  });

  it('rejects a missing header, a malformed timestamp and a missing signature', () => {
    const t = 1_785_000_000;
    freezeAt(t);

    expect(verifyElevenLabsSignature({ rawBody, header: null, secret }))
      .toEqual({ ok: false, reason: 'missing_header' });
    expect(verifyElevenLabsSignature({ rawBody, header: `t=nonsense,v0=${sign(t)}`, secret }))
      .toEqual({ ok: false, reason: 'malformed_timestamp' });
    expect(verifyElevenLabsSignature({ rawBody, header: `t=${t}`, secret }))
      .toEqual({ ok: false, reason: 'missing_signature' });
  });

  it('refuses to verify at all when the secret is unset', () => {
    // HMAC-SHA256 with an empty key is a perfectly valid HMAC, so an unset
    // secret must be a hard stop rather than a silently weak verifier.
    const t = 1_785_000_000;
    freezeAt(t);

    const forged = createHmac('sha256', '').update(`${t}.${rawBody}`, 'utf8').digest('hex');

    expect(verifyElevenLabsSignature({ rawBody, header: `t=${t},v0=${forged}`, secret: '' }))
      .toEqual({ ok: false, reason: 'secret_not_configured' });
  });
});
