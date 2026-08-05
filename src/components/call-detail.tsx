// The transcript beside the tool timeline, which is the Phase 3 gate condition in
// SPEC.md section 8 and the artifact section 5 says a prospect inspects.
//
// A server component with no state. The page above it owns the single query and hands
// down already parsed rows, so nothing here touches the database or the env.
import type { TranscriptTurn } from '@/lib/schemas';
import { callTimestamp, durationLabel } from '@/lib/slots';

// Every timestamp here is an ISO string rather than a Date. The queries cast through
// to_json because src/lib/db/client.ts sets fetch_types: false, so postgres-js returns
// the Postgres text form of a timestamptz rather than parsing it into a Date.
export type CallSummary = {
  elConversationId: string;
  status: string;
  startedAtISO: string | null;
  durationSeconds: number | null;
  summary: string | null;
  createdAtISO: string;
};

export type ToolInvocationRow = {
  tool_name: string;
  latency_ms: number;
  status_code: number;
  invoked_at: string;
};

export type BookingRow = {
  cal_booking_uid: string;
  slot_start: string;
  attendee_email: string;
  status: string;
};

export type LeadRow = {
  name: string | null;
  email: string | null;
  company: string | null;
  project_type: string | null;
  timeline: string | null;
  budget_band: string | null;
};

export type CallDetailProps = {
  call: CallSummary;
  transcript: TranscriptTurn[] | null;
  tools: ToolInvocationRow[];
  bookings: BookingRow[];
  lead: LeadRow | null;
  timeZone: string;
};

const LEAD_LABELS: ReadonlyArray<[keyof LeadRow, string]> = [
  ['name', 'Name'],
  ['email', 'Email'],
  ['company', 'Company'],
  ['project_type', 'Project'],
  ['timeline', 'Timeline'],
  ['budget_band', 'Band'],
];

export function CallDetail({ call, transcript, tools, bookings, lead, timeZone }: CallDetailProps) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <header className="border-b border-line pb-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-faint">Call</p>
        <h1 className="mt-2 font-mono text-lg tracking-tight">{call.elConversationId}</h1>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-faint">
          <span className={call.status === 'completed' ? 'text-mint' : undefined}>
            {call.status.replace('_', ' ')}
          </span>
          <span>{durationLabel(call.durationSeconds) ?? 'duration unknown'}</span>
          <span>{callTimestamp(call.startedAtISO ?? call.createdAtISO, timeZone)}</span>
        </div>
        {call.summary !== null ? (
          <p className="mt-5 max-w-3xl text-sm leading-relaxed text-faint">{call.summary}</p>
        ) : null}
      </header>

      <Lead lead={lead} />
      <Bookings bookings={bookings} timeZone={timeZone} />

      <div className="mt-10 grid gap-10 md:grid-cols-[1.4fr_1fr]">
        <Transcript transcript={transcript} />
        <ToolTimeline tools={tools} timeZone={timeZone} />
      </div>
    </main>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-faint">{children}</h2>
  );
}

function Lead({ lead }: { lead: LeadRow | null }) {
  return (
    <section className="mt-10">
      <SectionHeading>Extracted lead</SectionHeading>
      {lead === null ? (
        // Different from a row of six nulls, and said differently on purpose. No row
        // means extraction never ran; a row of nulls means it ran and the visitor
        // volunteered nothing.
        <p className="mt-3 text-sm text-faint">
          No extraction on this call. The post call webhook has not arrived.
        </p>
      ) : (
        <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {LEAD_LABELS.map(([key, label]) => (
            <div key={key}>
              <dt className="font-mono text-xs uppercase tracking-[0.15em] text-faint">{label}</dt>
              <dd className="mt-1 text-sm">
                {lead[key] ?? <span className="text-faint">not mentioned</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function Bookings({ bookings, timeZone }: { bookings: BookingRow[]; timeZone: string }) {
  if (bookings.length === 0) return null;

  return (
    <section className="mt-10">
      <SectionHeading>Booking</SectionHeading>
      <ul className="mt-4 space-y-3">
        {bookings.map((booking) => (
          <li
            key={booking.cal_booking_uid}
            className="rounded border border-line bg-raise px-4 py-3"
          >
            <p className="text-sm">{callTimestamp(booking.slot_start, timeZone)}</p>
            <p className="mt-1 font-mono text-xs text-faint">
              {booking.attendee_email} · {booking.status} · {booking.cal_booking_uid}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Transcript({ transcript }: { transcript: TranscriptTurn[] | null }) {
  return (
    <section>
      <SectionHeading>Transcript</SectionHeading>

      {transcript === null || transcript.length === 0 ? (
        <p className="mt-4 text-sm text-faint">
          No transcript yet. The tool timeline beside this is written during the call, so it
          arrives first. SPEC.md section 5.1.
        </p>
      ) : (
        <ol className="mt-4 space-y-5">
          {transcript.map((turn, index) => (
            <li key={index} className="grid grid-cols-[3.5rem_1fr] gap-x-3">
              <span className="pt-0.5 font-mono text-xs text-faint">
                {durationLabel(Math.round(turn.time_in_call_secs))}
              </span>
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.15em] text-faint">
                  {turn.role}
                </p>
                {turn.message !== null ? (
                  <p className="mt-1 text-sm leading-relaxed">{turn.message}</p>
                ) : null}
                {turn.tool_calls?.map((call) => (
                  <p key={call.request_id} className="mt-1 font-mono text-xs text-faint">
                    calls {call.tool_name}
                  </p>
                ))}
                {turn.tool_results?.map((result) => (
                  <p key={result.request_id} className="mt-1 font-mono text-xs text-faint">
                    {result.tool_name} returned in {result.tool_latency_secs.toFixed(2)} s
                    {result.is_error ? ', with an error' : ''}
                  </p>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Written by src/lib/tool-log.ts during the call, not by the webhook, so it is present
 * even for a conversation whose webhook never arrived. latency_ms is measured at our
 * own route, which is the number SPEC.md section 6.2 holds to a 3s budget, and the
 * second place mint is allowed to appear.
 */
function ToolTimeline({ tools, timeZone }: { tools: ToolInvocationRow[]; timeZone: string }) {
  return (
    <section>
      <SectionHeading>Tool timeline</SectionHeading>

      {tools.length === 0 ? (
        <p className="mt-4 text-sm text-faint">No tools were called on this conversation.</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {tools.map((tool, index) => (
            <li
              key={`${tool.tool_name}-${tool.invoked_at}-${index}`}
              className="rounded border border-line bg-raise px-4 py-3"
            >
              <p className="font-mono text-sm">{tool.tool_name}</p>
              <p className="mt-2 flex items-baseline gap-3 font-mono text-xs">
                <span className="text-mint">{tool.latency_ms} ms</span>
                <span className="text-faint">HTTP {tool.status_code}</span>
              </p>
              <p className="mt-1 font-mono text-xs text-faint">
                {callTimestamp(tool.invoked_at, timeZone)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
