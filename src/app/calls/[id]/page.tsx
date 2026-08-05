// The call detail page, SPEC.md section 4 tree. Gated by the same middleware matcher
// as /calls.
//
// The [id] segment is el_conversation_id, not the uuid primary key. It is the natural
// key SPEC.md section 5.1 declares, so a link into this page is constructible straight
// from an ElevenLabs conversation id with no lookup. Deviation 20.
//
// One query for the whole page. The children are aggregated into json inside Postgres
// rather than fetched in follow up round trips, because src/lib/db/client.ts caps the
// pool at three sockets that the tool routes are also using mid call.
import { sql } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  CallDetail,
  type BookingRow,
  type LeadRow,
  type ToolInvocationRow,
} from '@/components/call-detail';
import { db } from '@/lib/db/client';
import { env } from '@/lib/env';
import { StoredTranscript } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Both timestamps are strings. src/lib/db/client.ts sets fetch_types: false, so a
// timestamptz arrives as the Postgres text form rather than as a Date, and the query
// casts through to_json to hand down a real ISO string. json_agg already emits ISO.
type DetailRow = {
  el_conversation_id: string;
  status: string;
  started_at: string | null;
  duration_seconds: number | null;
  transcript: unknown;
  summary: string | null;
  created_at: string;
  tools: ToolInvocationRow[];
  bookings: BookingRow[];
  lead: LeadRow | null;
};

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const rows = await db.execute<DetailRow>(sql`
    SELECT
      c.el_conversation_id,
      c.status,
      to_json(c.started_at) #>> '{}' AS started_at,
      c.duration_seconds,
      c.transcript,
      c.summary,
      to_json(c.created_at) #>> '{}' AS created_at,
      (
        SELECT coalesce(
          json_agg(
            json_build_object(
              'tool_name', t.tool_name,
              'latency_ms', t.latency_ms,
              'status_code', t.status_code,
              'invoked_at', t.invoked_at
            )
            ORDER BY t.invoked_at
          ),
          '[]'::json
        )
        FROM tool_invocations t WHERE t.conversation_id = c.id
      ) AS tools,
      (
        SELECT coalesce(
          json_agg(
            json_build_object(
              'cal_booking_uid', b.cal_booking_uid,
              'slot_start', b.slot_start,
              'attendee_email', b.attendee_email,
              'status', b.status
            )
            ORDER BY b.slot_start
          ),
          '[]'::json
        )
        FROM bookings b WHERE b.conversation_id = c.id
      ) AS bookings,
      CASE WHEN l.id IS NULL THEN NULL ELSE json_build_object(
        'name', l.name,
        'email', l.email,
        'company', l.company,
        'project_type', l.project_type,
        'timeline', l.timeline,
        'budget_band', l.budget_band
      ) END AS lead
    FROM conversations c
    LEFT JOIN lead_captures l ON l.conversation_id = c.id
    WHERE c.el_conversation_id = ${id}
  `);

  const row = rows[0];
  if (row === undefined) notFound();

  // A jsonb column reads as unknown under strict, and the row may have been written
  // by an older shape, so it is parsed rather than cast. A transcript that fails to
  // parse renders as absent instead of taking the page down, since the tool timeline
  // beside it is the more load bearing half.
  //
  // Null is the ordinary pre webhook state, not a rejection, so it is not logged.
  const parsed = row.transcript === null ? null : StoredTranscript.safeParse(row.transcript);
  if (parsed !== null && !parsed.success) {
    console.error(`[calls] stored transcript rejected for ${row.el_conversation_id}`);
  }

  return (
    <div className="min-h-screen bg-ink text-body [color-scheme:dark]">
      <nav className="mx-auto max-w-6xl px-6 pt-10">
        <Link href="/calls" className="font-mono text-xs text-faint hover:text-body">
          Back to the call log
        </Link>
      </nav>
      <CallDetail
        call={{
          elConversationId: row.el_conversation_id,
          status: row.status,
          startedAtISO: row.started_at,
          durationSeconds: row.duration_seconds,
          summary: row.summary,
          createdAtISO: row.created_at,
        }}
        transcript={parsed !== null && parsed.success ? parsed.data : null}
        tools={row.tools}
        bookings={row.bookings}
        lead={row.lead}
        timeZone={env.DEFAULT_TIMEZONE}
      />
    </div>
  );
}
