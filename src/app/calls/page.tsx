// The gated call log, SPEC.md section 4 tree. Behind src/middleware.ts, whose matcher
// already covers /calls and /calls/:path*.
//
// One query, one round trip. src/lib/db/client.ts caps the pool at three sockets and
// the tool routes contend for them mid call, so this page must never fan out into an
// N+1. The two counts are scalar subqueries for that reason.
import { sql } from 'drizzle-orm';
import Link from 'next/link';

import { db } from '@/lib/db/client';
import { env } from '@/lib/env';
import { callTimestamp, durationLabel } from '@/lib/slots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// created_at is a string, not a Date. src/lib/db/client.ts sets fetch_types: false, so
// postgres-js hands back the Postgres text form of a timestamptz rather than parsing
// it, and the query casts it to a real ISO string through to_json instead.
type CallRow = {
  el_conversation_id: string;
  status: string;
  duration_seconds: number | null;
  summary: string | null;
  created_at: string;
  tool_count: number;
  booking_count: number;
  lead_name: string | null;
  lead_email: string | null;
  budget_band: string | null;
};

export default async function CallsPage() {
  const rows = await db.execute<CallRow>(sql`
    SELECT
      c.el_conversation_id,
      c.status,
      c.duration_seconds,
      c.summary,
      to_json(c.created_at) #>> '{}' AS created_at,
      (SELECT count(*)::int FROM tool_invocations t WHERE t.conversation_id = c.id) AS tool_count,
      (SELECT count(*)::int FROM bookings b WHERE b.conversation_id = c.id) AS booking_count,
      l.name AS lead_name,
      l.email AS lead_email,
      l.budget_band
    FROM conversations c
    LEFT JOIN lead_captures l ON l.conversation_id = c.id
    ORDER BY c.created_at DESC
    LIMIT 100
  `);

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <header className="flex items-baseline justify-between border-b border-line pb-4">
        <h1 className="font-mono text-xs uppercase tracking-[0.2em] text-faint">Call log</h1>
        <p className="font-mono text-xs text-faint">
          {rows.length} {rows.length === 1 ? 'call' : 'calls'}
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="py-16 text-sm text-faint">No calls yet.</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.el_conversation_id}>
              <Link
                href={`/calls/${row.el_conversation_id}`}
                className="block border-b border-line py-5 transition-colors hover:bg-raise"
              >
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="font-mono text-sm">{row.el_conversation_id}</span>
                  <StatusTag status={row.status} />
                  <span className="ml-auto font-mono text-xs text-faint">
                    {durationLabel(row.duration_seconds) ?? '--:--'}
                  </span>
                </div>

                <p className="mt-2 line-clamp-2 text-sm text-faint">
                  {row.summary ?? 'Waiting on the post call webhook.'}
                </p>

                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-faint">
                  <span>
                    {row.tool_count} {row.tool_count === 1 ? 'tool call' : 'tool calls'}
                  </span>
                  {row.booking_count > 0 ? <span>{row.booking_count} booked</span> : null}
                  {row.lead_name !== null || row.lead_email !== null ? (
                    <span>{row.lead_name ?? row.lead_email}</span>
                  ) : null}
                  {row.budget_band !== null ? <span>{row.budget_band}</span> : null}
                  <span className="ml-auto">
                    {callTimestamp(row.created_at, env.DEFAULT_TIMEZONE)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/**
 * Mint means one thing across the build and this is one of the two places it appears:
 * the call finished and its transcript landed. Everything else stays greyscale, which
 * is what makes the accent readable at a glance down a long list.
 */
function StatusTag({ status }: { status: string }) {
  const done = status === 'completed';
  return (
    <span
      className={`font-mono text-xs uppercase tracking-[0.15em] ${done ? 'text-mint' : 'text-faint'}`}
    >
      {status.replace('_', ' ')}
    </span>
  );
}
