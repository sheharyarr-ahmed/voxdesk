// Connection 3, SPEC.md section 2. ElevenLabs calls this synchronously mid call.
//
// Everything that keeps this route honest lives in withToolLogging: the shared
// secret check, both Zod parses, the 3s budget and the tool_invocations write.
import { CalApiError } from '@/lib/cal';
import { env } from '@/lib/env';
import type { ToolOutput } from '@/lib/schemas';
import { DEFAULT_WINDOW_DAYS, getFormattedSlots, todayInTimeZone } from '@/lib/slots';
import { normaliseTimeZone } from '@/lib/timezone';
import { withToolLogging } from '@/lib/tool-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Vercel's ceiling, not our budget. SPEC.md section 6.2 holds the route to 3s
// and withToolLogging enforces it; this only stops a pathological hang from
// running to the platform default.
export const maxDuration = 15;

// SPEC.md section 6.2. The fetch aborts inside the 3s route budget so the route
// always answers, and the abort is a structured outcome rather than an exception.
const UPSTREAM_TIMEOUT_MS = 2500;

export const POST = withToolLogging(
  'check_availability',
  async (input): Promise<ToolOutput<'check_availability'>> => {
    const timezone = normaliseTimeZone(input.timezone);
    const days = input.days ?? DEFAULT_WINDOW_DAYS;
    const date = input.start_date ?? todayInTimeZone(timezone);

    try {
      const { slots } = await getFormattedSlots({
        date,
        days,
        timeZone: timezone,
        eventTypeId: env.CAL_EVENT_TYPE_ID,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });

      if (slots.length === 0) {
        return {
          ok: false,
          reason: 'no_slots',
          speak:
            'I do not have anything open in that window. Would a little further out work for you?',
        };
      }

      return { ok: true, timezone, slots };
    } catch (error) {
      if (error instanceof CalApiError && error.kind === 'upstream_timeout') {
        return {
          ok: false,
          reason: 'upstream_timeout',
          speak: 'The calendar is slow to answer right now. Let me check again in a second.',
        };
      }

      console.error('[check_availability] upstream failure', {
        kind: error instanceof CalApiError ? error.kind : 'unknown',
        status: error instanceof CalApiError ? error.status : null,
        calCode: error instanceof CalApiError ? error.calCode : null,
        calMessage: error instanceof CalApiError ? error.calMessage : String(error),
      });

      return {
        ok: false,
        reason: 'upstream_error',
        speak: 'I could not reach the calendar just then. Give me one moment and I will try again.',
      };
    }
  },
);
