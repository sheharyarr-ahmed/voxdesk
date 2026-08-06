'use client';

/**
 * The live transcript. Deliberately the same shape as the persisted transcript on
 * /calls/[id]: a fixed timestamp gutter, the role as a mono label, the text beneath it.
 * A visitor who later opens the call log should recognise what they watched.
 *
 * Tool rows are interleaved with spoken turns rather than split into a second column,
 * because live the interesting thing is the ordering. On /calls the call is over and the
 * two column layout reads better, which is why that page keeps its own arrangement.
 */
import type { TranscriptEntry } from '@/lib/voice/use-voice-session';

/**
 * `durationLabel` in src/lib/slots.ts does exactly this, and is not importable here:
 * that module imports `getSlots` from src/lib/cal.ts, which imports src/lib/env.ts,
 * which throws by design the moment it reaches a client bundle. Three lines of
 * duplication is the cheaper of the two costs.
 */
function offsetLabel(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

const ROLE_LABEL: Record<'user' | 'agent', string> = {
  user: 'you',
  agent: 'agent',
};

export function TranscriptPane({ entries }: { entries: TranscriptEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="mt-4 text-sm text-faint">
        Nothing spoken yet. Turns appear here as they happen, and the call is written to the
        call log after you hang up.
      </p>
    );
  }

  return (
    <ol className="mt-4 space-y-5">
      {entries.map((entry) => (
        <li key={entry.id} className="grid grid-cols-[3.5rem_1fr] gap-x-3">
          <span className="pt-0.5 font-mono text-xs text-faint">{offsetLabel(entry.atSeconds)}</span>

          {entry.kind === 'turn' ? (
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.15em] text-faint">
                {ROLE_LABEL[entry.role]}
              </p>
              <p className="mt-1 text-sm leading-relaxed">{entry.text}</p>
            </div>
          ) : (
            <div className="rounded border border-line bg-raise px-4 py-3">
              <p className="font-mono text-sm">{entry.toolName}</p>
              <p className="mt-2 flex items-baseline gap-3 font-mono text-xs">
                {/*
                  The one place mint is allowed in this console, carrying the meaning it
                  already carries on /calls/[id]: evidence the machine did work.

                  This number is the round trip observed in the browser, request event to
                  response event. The call log shows `latency_ms` measured inside our own
                  route. They are different measurements of different spans and the label
                  says which this is.
                */}
                {entry.latencyMs === null ? (
                  <span className="text-faint">running</span>
                ) : (
                  <span className="text-mint">{entry.latencyMs} ms</span>
                )}
                <span className="text-faint">
                  {entry.isError ? 'returned an error' : 'round trip, in browser'}
                </span>
              </p>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
