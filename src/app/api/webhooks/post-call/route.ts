// Connection 4, SPEC.md section 2. ElevenLabs POSTs here after a call ends.
//
// The order in SPEC.md section 6.6 is the whole security property. The body is read
// as raw text and the signature is checked over those exact bytes before anything
// parses it and before anything reaches the database. Calling req.json() first would
// consume the stream and leave a re serialised body to verify against, which is a
// different string and would never match.
import { requireWebhookSecret } from '@/lib/env';
import { ingestConversation } from '@/lib/ingest';
import { PostCallEnvelope, PostCallPayloadSchema } from '@/lib/schemas';
import { verifyElevenLabsSignature } from '@/lib/verify-hmac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Vercel's ceiling, not our budget. Nothing here is on the speech path, so the only
// work is one Postgres round trip.
export const maxDuration = 15;

/** The only event the workspace subscribes to. See PostCallEnvelope. */
const HANDLED_EVENT = 'post_call_transcription';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();

  // Deviation 9. An unset secret is a hard stop, not a fallback to a weak verifier,
  // because HMAC-SHA256 with an empty key is a perfectly valid HMAC and anyone who
  // guessed it was unset could then forge a signature over any payload. 500 rather
  // than 401 because this is our misconfiguration, and it is the status ElevenLabs
  // retries on, so a delivery is not lost while the variable is being set.
  let secret: string;
  try {
    secret = requireWebhookSecret();
  } catch (error) {
    console.error('[post-call] webhook secret is not configured', error);
    return jsonResponse(500, { ok: false, reason: 'secret_not_configured' });
  }

  const verified = verifyElevenLabsSignature({
    rawBody: raw,
    header: req.headers.get('elevenlabs-signature'),
    secret,
  });
  if (!verified.ok) {
    // The reason is logged, never returned. Telling a caller whether it failed on the
    // timestamp or on the digest hands them a free oracle.
    console.error(`[post-call] signature rejected: ${verified.reason}`);
    return jsonResponse(401, { ok: false, reason: 'unauthorized' });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonResponse(400, { ok: false, reason: 'invalid_json' });
  }

  const envelope = PostCallEnvelope.safeParse(body);
  if (!envelope.success) {
    console.error('[post-call] envelope rejected', envelope.error.issues);
    return jsonResponse(400, { ok: false, reason: 'invalid_payload' });
  }
  if (envelope.data.type !== HANDLED_EVENT) {
    console.error(`[post-call] ignoring unsubscribed event ${envelope.data.type}`);
    return jsonResponse(200, { ok: true, ignored: true });
  }

  const parsed = PostCallPayloadSchema.safeParse(body);
  if (!parsed.success) {
    console.error('[post-call] payload rejected', parsed.error.issues);
    return jsonResponse(400, { ok: false, reason: 'invalid_payload' });
  }

  try {
    const { conversationId } = await ingestConversation(parsed.data);
    console.log(
      `[post-call] ingested ${parsed.data.data.conversation_id} into ${conversationId}`,
    );
  } catch (error) {
    // 500 so ElevenLabs retries. Answering 200 on a failed write would report a lost
    // transcript as delivered, and there is no replay endpoint to recover it with.
    console.error('[post-call] ingest failed', error);
    return jsonResponse(500, { ok: false, reason: 'ingest_failed' });
  }

  return jsonResponse(200, { ok: true });
}
