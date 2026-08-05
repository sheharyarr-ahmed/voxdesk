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
  // Never promises a clean retry. An aborted POST /v2/bookings can still have
  // created the booking upstream, so inviting a retry invites a double booking.
  book_meeting: {
    ok: false,
    reason: 'upstream_timeout',
    speak:
      'The calendar took longer than usual to confirm that. Let me check whether it went through before we try anything else.',
  },
};

/** Response of POST /api/session, SPEC.md section 6.1. */
export const SessionResponse = z.object({
  conversationToken: z.string().min(1),
});

/**
 * A single tool call or tool result as it appears inside a transcript turn.
 *
 * This projection is a security boundary, not a size optimisation. The real payload
 * carries tool_calls[].tool_details, and tool_details.headers is where
 * x-vd-tool-secret sits. ElevenLabs redacts it on the conversations GET surface, but
 * the webhook is a different surface and the parsed result is persisted to a jsonb
 * column that /calls/[id] renders. Zod strips keys it was not told about, so not
 * declaring tool_details is precisely what keeps the shared secret out of the
 * database. Do not add it back for convenience.
 */
const TranscriptToolCallSchema = z.object({
  tool_name: z.string().min(1).max(128),
  request_id: z.string().min(1).max(256),
});

const TranscriptToolResultSchema = z.object({
  tool_name: z.string().min(1).max(128),
  request_id: z.string().min(1).max(256),
  is_error: z.boolean(),
  tool_latency_secs: z.number(),
});

const TranscriptTurnSchema = z.object({
  role: z.string().min(1).max(32),
  // Null on a turn that carries only a tool call or only a tool result. Six of the
  // twenty two turns in the phase 2 gate conversation are that shape.
  message: z.string().nullable(),
  time_in_call_secs: z.number(),
  tool_calls: z.array(TranscriptToolCallSchema).optional(),
  tool_results: z.array(TranscriptToolResultSchema).optional(),
});

/**
 * One extracted lead field, SPEC.md section 6.5.
 *
 * The trap: data_collection_results is a map of objects, not a map of scalars. Each
 * entry is { data_collection_id, value, json_schema, rationale } and an unset field
 * arrives as an object whose value is null rather than as a missing key. Reading the
 * entry as a scalar yields "[object Object]" in the database, which looks like data.
 */
const DataCollectionResultSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
});

/**
 * Connection 4, SPEC.md section 2. The body ElevenLabs POSTs after a call ends.
 *
 * Confirmed against conv_6701kz8fyrk5fzbre5jprd6s5hbk rather than assumed, because
 * the webhook cannot be replayed and a shape error is therefore unrecoverable.
 *
 * The envelope is the second trap. The webhook body is wrapped in
 * { type, event_timestamp, data } while the GET /v1/convai/conversations/{id}
 * response is the bare conversation object, so a fixture built from the GET parses
 * against nothing here.
 *
 * Only fields that are read are declared. Everything else strips, which is the same
 * rule src/lib/cal.ts states for the Cal.com envelopes: an added upstream field must
 * never throw after the side effect has already happened.
 */
export const PostCallPayloadSchema = z.object({
  type: z.string().min(1).max(64),
  event_timestamp: z.number().optional(),
  data: z.object({
    conversation_id: z.string().min(1).max(128),
    agent_id: z.string().max(128).optional(),
    status: z.string().min(1).max(32),
    transcript: z.array(TranscriptTurnSchema),
    metadata: z.object({
      start_time_unix_secs: z.number(),
      call_duration_secs: z.number(),
    }),
    // Absent on a conversation that ended before analysis could run, which is what a
    // zero turn failed connect produces. Optional so that payload still ingests and
    // still shows its tool timeline rather than being rejected and lost.
    analysis: z
      .object({
        transcript_summary: z.string().nullable().optional(),
        call_successful: z.string().max(32).optional(),
        data_collection_results: z.record(z.string(), DataCollectionResultSchema).optional(),
      })
      .optional(),
  }),
});

export type PostCallPayload = z.infer<typeof PostCallPayloadSchema>;
export type TranscriptTurn = z.infer<typeof TranscriptTurnSchema>;

/**
 * What conversations.transcript holds once ingest has written it, and what /calls/[id]
 * parses on the way back out. A jsonb column reads as unknown under strict, and the
 * row may predate a schema change, so the page parses rather than casting.
 */
export const StoredTranscript = z.array(TranscriptTurnSchema);

/**
 * Salvaged from the raw body before the full parse, the same way ConversationAnchor
 * is above.
 *
 * The workspace subscribes to transcript only, but post_call_audio and
 * call_initiation_failure carry no transcript array and would fail
 * PostCallPayloadSchema. Reading the type first lets an unsubscribed event be
 * accepted and dropped instead of 400ing, which matters because a 4xx counts toward
 * the ten consecutive failures that auto disable a webhook. Deviation 21.
 */
export const PostCallEnvelope = z.object({
  type: z.string().min(1).max(64),
});
