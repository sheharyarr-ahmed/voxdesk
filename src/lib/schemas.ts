// Every Zod schema in the build. SPEC.md section 4.1 is the contract these encode.
import { z } from 'zod';

export type ToolName = 'check_availability' | 'book_meeting';

/**
 * The rule that makes these input schemas correct, and it is the subtlest thing
 * in this file:
 *
 *   The input schema validates only what the ElevenLabs tool definition already
 *   guarantees, which is presence, type and bounds. Anything whose failure has a
 *   spoken remedy is validated inside the handler instead.
 *
 * If `email` were z.email() here, an address that speech to text mangled would
 * fail at the choke point and produce a 400 envelope. SPEC.md section 6.3
 * requires it to produce { ok: false, reason: 'invalid_email', speak: ... } at
 * HTTP 200 so the agent asks the visitor to type it into the page instead. The
 * same applies to start_utc, which owes an invalid_slot, and to timezone, which
 * section 6.4 normalises against IANA with a fallback rather than rejecting.
 */
export const CheckAvailabilityInput = z.object({
  conversation_id: z.string().min(1).max(128),
  timezone: z.string().min(1).max(64),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  days: z.number().int().min(1).max(14).optional(),
});

export const SlotSchema = z.object({
  start_utc: z.string().min(1),
  label: z.string().min(1),
});

export const CheckAvailabilityOutput = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    timezone: z.string().min(1),
    // Capped at 5 so the agent never reads a wall of times.
    slots: z.array(SlotSchema).max(5),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(['upstream_timeout', 'upstream_error', 'no_slots']),
    speak: z.string().min(1),
  }),
]);

export const BookMeetingInput = z.object({
  conversation_id: z.string().min(1).max(128),
  timezone: z.string().min(1).max(64),
  start_utc: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  email: z.string().min(1).max(254),
  notes: z.string().max(2000).optional(),
});

export const BookMeetingOutput = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    booking_uid: z.string().min(1),
    start_utc: z.string().min(1),
    label: z.string().min(1),
    speak: z.string().min(1),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.enum([
      'invalid_email',
      'slot_taken',
      'upstream_timeout',
      'upstream_error',
      'invalid_slot',
    ]),
    speak: z.string().min(1),
  }),
]);

/**
 * The registry is what lets withToolLogging keep the SPEC.md section 4.2
 * signature, which takes no schemas, while still enforcing a parse in both
 * directions. The tool name literal selects the pair.
 */
export const TOOL_SCHEMAS = {
  check_availability: { input: CheckAvailabilityInput, output: CheckAvailabilityOutput },
  book_meeting: { input: BookMeetingInput, output: BookMeetingOutput },
} as const;

export type ToolInput<N extends ToolName> = z.infer<(typeof TOOL_SCHEMAS)[N]['input']>;
export type ToolOutput<N extends ToolName> = z.infer<(typeof TOOL_SCHEMAS)[N]['output']>;
export type ToolFailure<N extends ToolName> = Extract<ToolOutput<N>, { ok: false }>;

/**
 * Salvaged from the raw body before the full parse, so a tool call that fails
 * input validation still lands in the dashboard timeline instead of vanishing.
 */
export const ConversationAnchor = z.object({
  conversation_id: z.string().min(1).max(128),
});

/** Email validation lives here rather than on BookMeetingInput. See the note above. */
export const EmailSchema = z.email();

/** The sentence the agent reads when our own budget or a handler bug is the cause. */
export const TOOL_FALLBACK: { [K in ToolName]: ToolFailure<K> } = {
  check_availability: {
    ok: false,
    reason: 'upstream_error',
    speak: 'I could not reach the calendar just then. Give me one moment and I will try again.',
  },
  book_meeting: {
    ok: false,
    reason: 'upstream_error',
    speak: 'The booking did not go through just then. Let me try that slot again.',
  },
};

export const TOOL_TIMEOUT: { [K in ToolName]: ToolFailure<K> } = {
  check_availability: {
    ok: false,
    reason: 'upstream_timeout',
    speak: 'The calendar is slow to answer right now. Let me check again in a second.',
  },
  book_meeting: {
    ok: false,
    reason: 'upstream_timeout',
    speak: 'The calendar is slow to answer right now. Let me confirm that booking again.',
  },
};

/** Response of POST /api/session, SPEC.md section 6.1. */
export const SessionResponse = z.object({
  conversationToken: z.string().min(1),
});
