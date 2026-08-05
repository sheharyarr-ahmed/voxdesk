// Connection 4, SPEC.md section 2. Turns a verified post call payload into the rows
// that /calls renders.
//
// Split in two on purpose. toIngestRecord is a pure function of the parsed payload
// with no database or HTTP concerns, which is the property v1-post-call-webhooks.md
// asked to preserve so that a polling fallback would stay an addition rather than a
// rewrite, and it is what the unit suite drives against the captured fixture.
// ingestConversation is the single write.
import { sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import type { PostCallPayload, TranscriptTurn } from '@/lib/schemas';

export type IngestLead = {
  name: string | null;
  email: string | null;
  company: string | null;
  projectType: string | null;
  timeline: string | null;
  budgetBand: string | null;
};

export type IngestRecord = {
  elConversationId: string;
  status: 'completed' | 'failed';
  startedAtISO: string;
  endedAtISO: string;
  durationSeconds: number;
  transcript: TranscriptTurn[];
  summary: string | null;
  lead: IngestLead | null;
};

type DataCollectionResults = NonNullable<
  NonNullable<PostCallPayload['data']['analysis']>['data_collection_results']
>;

/**
 * SPEC.md section 6.5. An unset field arrives as an object whose value is null, not
 * as an absent key, so both cases collapse to null here. Non string values are
 * stringified because all six lead_captures columns are text and the field
 * descriptions in agent/agent.config.json ask for prose.
 */
function readLeadField(results: DataCollectionResults, key: string): string | null {
  const entry = results[key];
  if (entry === undefined || entry.value === null) return null;
  return String(entry.value);
}

export function toIngestRecord(payload: PostCallPayload): IngestRecord {
  const { data } = payload;
  const startedMs = data.metadata.start_time_unix_secs * 1000;
  const endedMs = startedMs + data.metadata.call_duration_secs * 1000;
  const results = data.analysis?.data_collection_results;

  return {
    elConversationId: data.conversation_id,
    // SPEC.md section 5.1's SQL sets completed unconditionally, but section 5 declares
    // the column as in_progress, completed or failed, and this is the only writer that
    // could ever set failed. Without the mapping a declared state is unreachable.
    // Deviation 18.
    status: data.status === 'done' ? 'completed' : 'failed',
    startedAtISO: new Date(startedMs).toISOString(),
    endedAtISO: new Date(endedMs).toISOString(),
    durationSeconds: data.metadata.call_duration_secs,
    // Already the narrow projection. Zod dropped every key TranscriptTurnSchema does
    // not declare, tool_details among them, before this function ever saw the payload.
    transcript: data.transcript,
    summary: data.analysis?.transcript_summary ?? null,
    lead:
      results === undefined
        ? null
        : {
            name: readLeadField(results, 'name'),
            email: readLeadField(results, 'email'),
            company: readLeadField(results, 'company'),
            projectType: readLeadField(results, 'project_type'),
            timeline: readLeadField(results, 'timeline'),
            budgetBand: readLeadField(results, 'budget_band'),
          },
  };
}

/**
 * SPEC.md section 5.1, the post call half of the write ordering.
 *
 * One statement, one round trip, same CTE shape as src/lib/tool-log.ts. The tool
 * routes have almost always created the conversations row already, at status
 * in_progress, so the common path here is the DO UPDATE branch. The INSERT branch
 * still has to exist for a call that ended without invoking either tool.
 *
 * Idempotency is structural rather than checked: both writes are upserts on a unique
 * key, so a redelivery converges on the same single row. That is what the SPEC.md
 * section 11.3 gate proves by posting the same signed body twice and counting rows.
 *
 * Errors are not swallowed here, unlike the tool_invocations write. That one must
 * never take down the call it is observing; this one has no call to protect, and a
 * silent failure would mean a lost transcript with a 200 telling ElevenLabs it landed.
 */
export async function ingestConversation(
  payload: PostCallPayload,
): Promise<{ conversationId: string }> {
  const record = toIngestRecord(payload);
  const lead = record.lead;

  const rows = await db.execute<{ id: string }>(sql`
    WITH upserted AS (
      INSERT INTO conversations
        (el_conversation_id, status, started_at, ended_at, duration_seconds, transcript, summary)
      VALUES (
        ${record.elConversationId},
        ${record.status},
        ${record.startedAtISO}::timestamptz,
        ${record.endedAtISO}::timestamptz,
        ${record.durationSeconds},
        ${JSON.stringify(record.transcript)}::jsonb,
        ${record.summary}
      )
      ON CONFLICT (el_conversation_id) DO UPDATE SET
        status = EXCLUDED.status,
        started_at = EXCLUDED.started_at,
        ended_at = EXCLUDED.ended_at,
        duration_seconds = EXCLUDED.duration_seconds,
        transcript = EXCLUDED.transcript,
        summary = EXCLUDED.summary
      RETURNING id
    ), captured AS (
      INSERT INTO lead_captures
        (conversation_id, name, email, company, project_type, timeline, budget_band)
      SELECT
        upserted.id,
        ${lead?.name ?? null}::text,
        ${lead?.email ?? null}::text,
        ${lead?.company ?? null}::text,
        ${lead?.projectType ?? null}::text,
        ${lead?.timeline ?? null}::text,
        ${lead?.budgetBand ?? null}::text
      FROM upserted
      -- No analysis block means extraction never ran, and a row of six nulls would
      -- read as "we looked and found nothing" rather than "we never looked".
      WHERE ${lead !== null}::boolean
      ON CONFLICT (conversation_id) DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        company = EXCLUDED.company,
        project_type = EXCLUDED.project_type,
        timeline = EXCLUDED.timeline,
        budget_band = EXCLUDED.budget_band,
        extracted_at = now()
    )
    SELECT id FROM upserted
  `);

  const conversationId = rows[0]?.id;
  if (conversationId === undefined) {
    // Unreachable in Postgres: a data modifying CTE always runs to completion and
    // DO UPDATE always returns its row. Throwing rather than returning an empty
    // string keeps a silent partial write from being reported as a success.
    throw new Error(`ingest returned no conversation id for ${record.elConversationId}`);
  }

  return { conversationId };
}
