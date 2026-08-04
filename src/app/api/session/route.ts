// Connection 2, SPEC.md section 2. The only path to voice minutes, and the only
// place the ElevenLabs API key is used. The key never leaves the server.
import { createHash } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { cookies } from 'next/headers';

import { db } from '@/lib/db/client';
import { env } from '@/lib/env';
import { SESSION_COOKIE, verifySession } from '@/lib/session-cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const TOKEN_TIMEOUT_MS = 8000;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function POST(): Promise<Response> {
  // Layer 3 of SPEC.md section 6.1. Middleware already redirects a browser
  // without a valid cookie, but middleware is a routing concern and this is the
  // route that actually spends money, so it re verifies rather than trusting it.
  const jar = await cookies();
  const cookieValue = jar.get(SESSION_COOKIE)?.value;
  if (!(await verifySession(cookieValue))) {
    return jsonResponse(401, { ok: false, reason: 'unauthorized' });
  }

  // The counter lives in Postgres because a serverless in memory counter does
  // not survive a cold start, so one person with the passcode and ten tabs would
  // otherwise drain the month.
  const sessionHash = createHash('sha256').update(cookieValue ?? '', 'utf8').digest('hex');

  let used: number;
  try {
    const rows = await db.execute<{ n: number }>(sql`
      WITH inserted AS (
        INSERT INTO demo_sessions (session_hash) VALUES (${sessionHash}) RETURNING created_at
      )
      SELECT count(*)::int AS n FROM demo_sessions WHERE created_at > now() - interval '24 hours'
    `);
    used = Number(rows[0]?.n ?? 0);
  } catch (error) {
    console.error('[session] demo_sessions counter failed', error);
    return jsonResponse(503, { ok: false, reason: 'counter_unavailable' });
  }

  if (used > env.DAILY_SESSION_CAP) {
    return jsonResponse(429, { ok: false, reason: 'daily_cap_reached', cap: env.DAILY_SESSION_CAP });
  }

  let response: Response;
  try {
    const url = new URL('/v1/convai/conversation/token', 'https://api.elevenlabs.io');
    url.searchParams.set('agent_id', env.ELEVENLABS_AGENT_ID);
    response = await fetch(url, {
      method: 'GET',
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch (error) {
    console.error('[session] token mint transport failure', error);
    return jsonResponse(502, { ok: false, reason: 'token_mint_failed' });
  }

  if (!response.ok) {
    // Body is deliberately not echoed to the client. It can carry account detail.
    console.error('[session] token mint rejected', response.status, await response.text());
    return jsonResponse(502, { ok: false, reason: 'token_mint_failed' });
  }

  const payload: unknown = await response.json();
  const token =
    typeof payload === 'object' && payload !== null && 'token' in payload
      ? (payload as { token: unknown }).token
      : undefined;

  if (typeof token !== 'string' || token.length === 0) {
    console.error('[session] token mint returned an unexpected shape');
    return jsonResponse(502, { ok: false, reason: 'token_mint_failed' });
  }

  return jsonResponse(200, { conversationToken: token });
}
