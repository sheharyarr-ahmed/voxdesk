// The fixture is the real phase 2 gate call, conv_6701kz8fyrk5fzbre5jprd6s5hbk,
// captured from GET /v1/convai/conversations/{id} and wrapped in the documented
// webhook envelope. It is not invented, which is the point: a post call webhook
// cannot be replayed, so a shape the schema gets wrong is a transcript lost for good.
//
// The SQL in ingestConversation is deliberately not covered here. The suite mocks
// nothing but fetch, src/lib/tool-log.ts was likewise verified against production at
// the phase 1 gate rather than unit tested, and the SPEC.md section 11.3 gate proves
// the write by posting the same signed body twice and counting rows.
import { describe, expect, it } from 'vitest';

import { toIngestRecord } from '@/lib/ingest';
import { PostCallPayloadSchema } from '@/lib/schemas';

import fixtureJson from '../fixtures/post-call.json';

const fixture: unknown = fixtureJson;

type MutablePayload = {
  type: string;
  event_timestamp?: number;
  data: {
    status: string;
    analysis?: { data_collection_results?: Record<string, unknown> };
    [key: string]: unknown;
  };
};

/** A structural clone, so one test's mutation cannot leak into the next. */
function mutable(): MutablePayload {
  return JSON.parse(JSON.stringify(fixture)) as MutablePayload;
}

describe('PostCallPayloadSchema', () => {
  it('parses the real post call payload', () => {
    const parsed = PostCallPayloadSchema.safeParse(fixture);
    expect(parsed.success).toBe(true);
  });

  it('rejects the unwrapped conversations GET response', () => {
    // Load bearing, and the trap most likely to be discovered from a failing gate.
    // The webhook body is wrapped in { type, event_timestamp, data } while the GET
    // response is the bare conversation object, so a fixture built from the GET
    // parses against nothing at all. Asserted rather than remembered.
    const unwrapped = (fixture as { data: unknown }).data;

    expect(PostCallPayloadSchema.safeParse(unwrapped).success).toBe(false);
  });

  it('rejects a data collection result given as a bare scalar', () => {
    // Pins the second trap. analysis.data_collection_results is a map of objects,
    // each carrying value, json_schema and rationale, not a map of scalars. Reading
    // an entry as a scalar would write "[object Object]" into a text column, which
    // looks like data rather than like a bug.
    const payload = mutable();
    payload.data.analysis = { data_collection_results: { budget_band: 'production_build' } };

    expect(PostCallPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it('accepts a payload carrying no analysis block', () => {
    // What a call that ended before analysis could run produces. It has to ingest,
    // so the conversation still shows its tool timeline. A 400 here would lose it,
    // because ElevenLabs does not retry a 4xx and offers no replay endpoint.
    const payload = mutable();
    delete payload.data.analysis;

    expect(PostCallPayloadSchema.safeParse(payload).success).toBe(true);
  });
});

describe('toIngestRecord', () => {
  const record = toIngestRecord(PostCallPayloadSchema.parse(fixture));

  it('maps the conversation off metadata rather than off the wire clock', () => {
    expect(record.elConversationId).toBe('conv_6701kz8fyrk5fzbre5jprd6s5hbk');
    expect(record.status).toBe('completed');
    expect(record.durationSeconds).toBe(139);
    expect(record.startedAtISO).toBe('2026-08-05T08:17:05.000Z');
    // Derived, because the payload carries a start and a duration but no end.
    expect(record.endedAtISO).toBe('2026-08-05T08:19:24.000Z');
    expect(record.transcript).toHaveLength(22);
    expect(record.summary).toContain('production build');
  });

  it('reads value on every lead field and leaves an unmentioned one null', () => {
    // These six are what the live call actually extracted. company is genuinely null
    // because the visitor never named one, which is the SPEC.md section 6.5 unset
    // path exercised against real data rather than a hand written null.
    expect(record.lead).toEqual({
      name: 'Sheharyar Ahmed',
      email: 'sheharyar.softwareengineer@gmail.com',
      company: null,
      projectType: 'a voice agent that answers questions on my site and books demos',
      timeline: 'in about six weeks',
      budgetBand: 'production_build',
    });
  });

  it('keeps the tool shared secret out of the persisted transcript', () => {
    const persisted = JSON.stringify(record.transcript);

    expect(persisted).not.toContain('tool_details');
    expect(persisted).not.toContain('x-vd-tool-secret');
    // Not a vacuous pair of assertions: the payload really does carry the header,
    // and Zod dropping the key it was never told about is what removes it.
    expect(JSON.stringify(fixture)).toContain('x-vd-tool-secret');
  });

  it('keeps the turns that carry a tool call, with their message null', () => {
    const toolTurns = record.transcript.filter((turn) => (turn.tool_calls?.length ?? 0) > 0);

    expect(toolTurns.map((turn) => turn.tool_calls?.[0]?.tool_name)).toEqual([
      'check_availability',
      'book_meeting',
    ]);
    expect(toolTurns.every((turn) => turn.message === null)).toBe(true);
  });

  it('maps a status other than done to failed', () => {
    // Deviation 18. SPEC.md section 5 declares failed as a legal status and section
    // 5.1's SQL never writes it, so this is the only writer that can.
    const payload = mutable();
    payload.data.status = 'failed';

    expect(toIngestRecord(PostCallPayloadSchema.parse(payload)).status).toBe('failed');
  });

  it('yields no lead at all when analysis never ran', () => {
    const payload = mutable();
    delete payload.data.analysis;

    const withoutAnalysis = toIngestRecord(PostCallPayloadSchema.parse(payload));

    expect(withoutAnalysis.lead).toBeNull();
    expect(withoutAnalysis.summary).toBeNull();
  });

  it('distinguishes analysis that ran and found nothing from analysis that never ran', () => {
    // A row of six nulls says "we looked and the visitor said none of it". No row at
    // all says "extraction never ran". They are different facts and /calls shows them
    // differently, so the mapper must not collapse one into the other.
    const payload = mutable();
    payload.data.analysis = { data_collection_results: {} };

    const emptyResults = toIngestRecord(PostCallPayloadSchema.parse(payload));

    expect(emptyResults.lead).toEqual({
      name: null,
      email: null,
      company: null,
      projectType: null,
      timeline: null,
      budgetBand: null,
    });
  });
});
