// Connection 3, SPEC.md section 2. The write that makes the tool layer real
// rather than theatre.
import { sql } from 'drizzle-orm';

import { CalApiError, createBooking } from '@/lib/cal';
import { db } from '@/lib/db/client';
import { env } from '@/lib/env';
import { EmailSchema, type ToolOutput } from '@/lib/schemas';
import { slotLabel } from '@/lib/slots';
import { normaliseTimeZone } from '@/lib/timezone';
import { withToolLogging } from '@/lib/tool-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * 4s, not the 2500ms check_availability uses.
 *
 * Measured against the live API from the deployed function on 2026-08-04:
 * POST /v2/bookings takes 2.1 to 2.5s because it writes a calendar event and
 * sends invites, so a 2500ms abort fires on roughly half of all bookings.
 *
 * The reason that is unacceptable rather than merely slow: an aborted request
 * still creates the booking upstream. A run cut off at 2500ms left a real event
 * on the calendar while this route reported upstream_timeout. Aborting the
 * client does not roll back the server.
 */
const UPSTREAM_TIMEOUT_MS = 4000;

/**
 * Records the booking alongside the conversation row. Uses the same upsert
 * ordering as SPEC.md section 5.1: any route that sees el_conversation_id
 * creates the conversation, then writes the child.
 *
 * Failure here is logged and swallowed. The booking already exists on the real
 * calendar at this point, and telling the visitor it failed would make them book
 * a second time.
 */
async function recordBooking(a: {
  elConversationId: string;
  calBookingUid: string;
  slotStartISO: string;
  attendeeEmail: string;
}): Promise<void> {
  try {
    await db.execute(sql`
      WITH upserted AS (
        INSERT INTO conversations (el_conversation_id, status)
        VALUES (${a.elConversationId}, 'in_progress')
        ON CONFLICT (el_conversation_id)
          DO UPDATE SET status = conversations.status
        RETURNING id
      )
      INSERT INTO bookings (conversation_id, cal_booking_uid, slot_start, attendee_email, status)
      SELECT upserted.id, ${a.calBookingUid}, ${a.slotStartISO}::timestamptz,
             ${a.attendeeEmail}, ${'accepted'}
      FROM upserted
      ON CONFLICT (cal_booking_uid) DO NOTHING
    `);
  } catch (error) {
    console.error('[book_meeting] bookings write failed after a real booking', error);
  }
}

export const POST = withToolLogging(
  'book_meeting',
  async (input): Promise<ToolOutput<'book_meeting'>> => {
    const timezone = normaliseTimeZone(input.timezone);

    // Validated here rather than on the input schema, deliberately. SPEC.md
    // section 6.3 requires a mangled address to come back as a structured 200 so
    // the agent asks the visitor to type it into the page, not as a 400 envelope.
    const email = EmailSchema.safeParse(input.email.trim());
    if (!email.success) {
      return {
        ok: false,
        reason: 'invalid_email',
        speak:
          'I did not catch that email address correctly. Could you type it into the box on the page for me?',
      };
    }

    // Same reasoning for the slot. The agent must never construct a time itself,
    // so a start_utc that did not come from check_availability is a spoken retry
    // rather than a validation failure.
    const startMs = Date.parse(input.start_utc);
    if (!Number.isFinite(startMs)) {
      return {
        ok: false,
        reason: 'invalid_slot',
        speak: 'That time did not come through clearly. Let me read you the open slots again.',
      };
    }
    const startUtcISO = new Date(startMs).toISOString();

    try {
      const booking = await createBooking({
        startUtcISO,
        eventTypeId: env.CAL_EVENT_TYPE_ID,
        attendee: { name: input.name.trim(), email: email.data, timeZone: timezone },
        notes: input.notes,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });

      const label = slotLabel(booking.startUtcISO, timezone);

      await recordBooking({
        elConversationId: input.conversation_id,
        calBookingUid: booking.uid,
        slotStartISO: booking.startUtcISO,
        attendeeEmail: email.data,
      });

      return {
        ok: true,
        booking_uid: booking.uid,
        start_utc: booking.startUtcISO,
        label,
        speak: `You are booked for ${label}. The invite is on its way to ${email.data}.`,
      };
    } catch (error) {
      if (error instanceof CalApiError) {
        // A taken slot is an HTTP 400 on Cal.com, not a 409, and is separated
        // from a malformed request 400 by message text inside cal.ts.
        if (error.kind === 'slot_taken') {
          return {
            ok: false,
            reason: 'slot_taken',
            speak: 'That slot has just been taken. Let me read you what is still open.',
          };
        }
        if (error.kind === 'invalid_slot') {
          return {
            ok: false,
            reason: 'invalid_slot',
            speak: 'That time is not bookable. Let me read you the open slots again.',
          };
        }
        if (error.kind === 'upstream_timeout') {
          // Deliberately does not promise a clean retry. An aborted booking may
          // still have landed on the calendar, so telling the visitor we will
          // simply try again invites a double booking. This line sends the agent
          // back to check_availability, where the slot disappearing is the
          // evidence that the booking actually went through.
          return {
            ok: false,
            reason: 'upstream_timeout',
            speak:
              'The calendar took longer than usual to confirm that. Let me check whether it went through before we try anything else.',
          };
        }

        console.error('[book_meeting] upstream failure', {
          kind: error.kind,
          status: error.status,
          calCode: error.calCode,
          calMessage: error.calMessage,
        });
      } else {
        console.error('[book_meeting] unexpected failure', error);
      }

      return {
        ok: false,
        reason: 'upstream_error',
        speak: 'The booking did not go through just then. Let me try that slot again.',
      };
    }
  },
);
