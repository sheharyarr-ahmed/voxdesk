// Cal.com API v2 client.
//
// Wire format facts, all confirmed against the live API from the deployed
// function on 2026-08-04. Recorded in the decision notes phase-1-cal-egress-probe
// and v4-calcom-booking.
//
//   - Header based versioning is mandatory. Without cal-api-version the request
//     404s with "Cannot GET /v2/slots", which reads exactly like a wrong URL.
//   - Slots params are start and end, not startTime and endTime.
//   - Both endpoints validate with forbidNonWhitelisted, so an unknown query
//     parameter or body property is itself a 400.
//   - The slots success body is bare { data }, with no status wrapper. Errors do
//     carry status. Requiring a uniform envelope would reject every valid slots
//     response.
//   - POST /v2/bookings has no end field, it is derived from the event type
//     length, and lengthInMinutes is a 400 on a fixed length event type.
import { z } from 'zod';

import { env } from '@/lib/env';

export const CAL_BASE_URL = 'https://api.cal.com';
export const CAL_SLOTS_API_VERSION = '2024-09-04';
export const CAL_BOOKINGS_API_VERSION = '2024-08-13';

export type CalSlot = { start: string };

export type CalFailureKind = 'slot_taken' | 'invalid_slot' | 'upstream_timeout' | 'upstream_error';

/**
 * Every failure leaving this module is a CalApiError. `kind` maps one to one
 * onto the SPEC.md section 4.1 tool contract `reason`.
 */
export class CalApiError extends Error {
  readonly kind: CalFailureKind;
  readonly status: number | null;
  readonly calCode: string | null;
  readonly calMessage: string | null;

  constructor(a: {
    kind: CalFailureKind;
    message: string;
    status?: number | null;
    calCode?: string | null;
    calMessage?: string | null;
  }) {
    super(a.message);
    this.name = 'CalApiError';
    this.kind = a.kind;
    this.status = a.status ?? null;
    this.calCode = a.calCode ?? null;
    this.calMessage = a.calMessage ?? null;
  }
}

const calSlotSchema = z.object({ start: z.string().min(1) });

// Requires only `data`. Zod strips unknown keys, so this is correct whether or
// not Cal.com ever adds a sibling status field.
const slotsEnvelopeSchema = z.object({
  data: z.record(z.string(), z.array(calSlotSchema)),
});

/**
 * Deliberately minimal. Anything not needed is omitted so a new field or a new
 * status value upstream can never make this throw after the booking has already
 * been created. Throwing post write would tell the visitor the booking failed
 * when it did not, and they would book a second time.
 */
const bookingEnvelopeSchema = z.object({
  data: z.object({
    uid: z.string().min(1),
    start: z.string().min(1),
  }),
});

const calErrorEnvelopeSchema = z.object({
  error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional(),
  message: z.string().optional(),
});

/**
 * Lowercase substrings, sourced from Cal.com's errors.service.ts and
 * errorCodes.ts. A taken slot is an HTTP 400, not a 409, and is distinguishable
 * from a malformed request 400 only by the message text. Mapping on status code
 * alone would report upstream_error for the single failure a prospect is most
 * likely to see during a demo.
 */
const SLOT_TAKEN_MARKERS = [
  'already has booking at this time',
  'no_available_users_found_error',
  'hosts_unavailable_for_booking',
  'fixed_hosts_unavailable_for_booking',
  'round_robin_host_unavailable_for_booking',
  'booking_conflict_error',
  'no more seats left',
  'not_enough_available_seats_error',
] as const;

const INVALID_SLOT_MARKERS = [
  'booking_time_out_of_bounds_error',
  'be booked at the "start" time provided',
  'attempting to book a meeting in the past',
  'minimum booking notice',
  'booking_not_allowed_by_restriction_schedule',
] as const;

/**
 * Classifies on the DECODED message, not the raw JSON.
 *
 * Cal.com's out of bounds message contains double quotes, and in the raw
 * response body JSON has escaped those as \". Matching against the raw text
 * therefore never fires for any marker containing a quote, and a real
 * invalid_slot would be reported as upstream_error. rawBody is still appended as
 * a fallback for the case where the envelope did not parse.
 */
function classifyBookingFailure(
  status: number,
  decodedMessage: string | null,
  rawBody: string,
): CalFailureKind {
  const text = `${decodedMessage ?? ''}\n${rawBody}`.toLowerCase();
  if (SLOT_TAKEN_MARKERS.some((marker) => text.includes(marker))) return 'slot_taken';
  if (INVALID_SLOT_MARKERS.some((marker) => text.includes(marker))) return 'invalid_slot';
  if (status === 409) return 'slot_taken';
  // A generic validation 400 is our own bug, not "that time is gone". Reporting
  // invalid_slot would make the agent loop through slots forever chasing a fault
  // it cannot fix.
  return 'upstream_error';
}

/**
 * AbortSignal.timeout() rejects with a TimeoutError while
 * AbortController.abort() rejects with an AbortError. Both are timeouts as far
 * as the tool contract cares.
 */
function isAbortLike(value: unknown): boolean {
  return value instanceof Error && (value.name === 'AbortError' || value.name === 'TimeoutError');
}

function describe(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function readCalError(json: unknown, rawBody: string): { code: string | null; message: string | null } {
  const parsed = calErrorEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    return { code: null, message: rawBody.slice(0, 400) || null };
  }
  return {
    code: parsed.data.error?.code ?? null,
    message:
      parsed.data.error?.message ?? parsed.data.message ?? (rawBody.slice(0, 400) || null),
  };
}

type CalFetchResult = { status: number; json: unknown; rawBody: string };

async function calFetch(a: {
  url: URL;
  method: 'GET' | 'POST';
  apiVersion: string;
  signal: AbortSignal;
  body?: unknown;
}): Promise<CalFetchResult> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'cal-api-version': a.apiVersion,
  };

  // Both endpoints are public for a public event type, so the key is optional.
  // Sending it moves us off the shared Vercel egress rate limit bucket, which
  // Cal.com keys on cf-connecting-ip, and onto our own. Clearing CAL_API_KEY in
  // Vercel disables the header with no code change.
  const apiKey = env.CAL_API_KEY.trim();
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  if (a.body !== undefined) headers['content-type'] = 'application/json';

  let status: number;
  let rawBody: string;

  try {
    const response = await fetch(a.url, {
      method: a.method,
      headers,
      body: a.body === undefined ? undefined : JSON.stringify(a.body),
      signal: a.signal,
      cache: 'no-store',
    });
    status = response.status;
    rawBody = await response.text();
  } catch (cause) {
    if (isAbortLike(cause)) {
      throw new CalApiError({
        kind: 'upstream_timeout',
        message: `Cal.com ${a.method} ${a.url.pathname} aborted`,
      });
    }
    throw new CalApiError({
      kind: 'upstream_error',
      message: `Cal.com ${a.method} ${a.url.pathname} transport failure: ${describe(cause)}`,
    });
  }

  let json: unknown = null;
  if (rawBody.length > 0) {
    try {
      json = JSON.parse(rawBody);
    } catch {
      json = null;
    }
  }

  return { status, json, rawBody };
}

/**
 * GET /v2/slots, cal-api-version 2024-09-04.
 *
 * startISO and endISO go on the wire verbatim as start and end. A bare
 * YYYY-MM-DD is accepted; a date only end is normalised server side to 23:59:59
 * on that same date, so the end day is included. A start earlier than now is
 * clamped to now plus the event type's minimum booking notice, so today's date
 * never yields slots in the past.
 *
 * Because timeZone is sent, every returned start carries that zone's offset
 * rather than a Z suffix. Conversion to UTC happens in slots.ts.
 */
export async function getSlots(a: {
  startISO: string;
  endISO: string;
  timeZone: string;
  eventTypeId: number;
  signal: AbortSignal;
}): Promise<CalSlot[]> {
  const url = new URL('/v2/slots', CAL_BASE_URL);
  url.searchParams.set('eventTypeId', String(a.eventTypeId));
  url.searchParams.set('start', a.startISO);
  url.searchParams.set('end', a.endISO);
  url.searchParams.set('timeZone', a.timeZone);

  const { status, json, rawBody } = await calFetch({
    url,
    method: 'GET',
    apiVersion: CAL_SLOTS_API_VERSION,
    signal: a.signal,
  });

  if (status < 200 || status >= 300) {
    const { code, message } = readCalError(json, rawBody);
    throw new CalApiError({
      kind: 'upstream_error',
      message: `Cal.com GET /v2/slots returned ${status}`,
      status,
      calCode: code,
      calMessage: message,
    });
  }

  const parsed = slotsEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw new CalApiError({
      kind: 'upstream_error',
      message: 'Cal.com GET /v2/slots returned an unexpected shape',
      status,
      calMessage: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    });
  }

  // data is keyed by date and dates with no availability are omitted entirely.
  // Key order is not guaranteed, and the key does not always match the visitor
  // local date of the slot once shifted, so flatten and sort on the instant.
  return Object.values(parsed.data.data)
    .flat()
    .filter((slot) => Number.isFinite(Date.parse(slot.start)))
    .sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
}

/**
 * The exact 2024-08-13 create booking body. There is no `end`: Cal.com derives
 * it from the event type length. There is no `lengthInMinutes`: sending it to a
 * single length event type is a 400. Notes go in bookingFieldsResponses under
 * the system booking field slug `notes`.
 */
type CreateBookingBody = {
  start: string;
  eventTypeId: number;
  attendee: { name: string; email: string; timeZone: string };
  bookingFieldsResponses?: { notes: string };
};

export async function createBooking(a: {
  startUtcISO: string;
  eventTypeId: number;
  attendee: { name: string; email: string; timeZone: string };
  notes?: string;
  signal: AbortSignal;
}): Promise<{ uid: string; startUtcISO: string }> {
  const notes = a.notes?.trim();

  const body: CreateBookingBody = {
    start: a.startUtcISO,
    eventTypeId: a.eventTypeId,
    attendee: {
      name: a.attendee.name,
      email: a.attendee.email,
      timeZone: a.attendee.timeZone,
    },
    ...(notes ? { bookingFieldsResponses: { notes } } : {}),
  };

  const url = new URL('/v2/bookings', CAL_BASE_URL);

  const { status, json, rawBody } = await calFetch({
    url,
    method: 'POST',
    apiVersion: CAL_BOOKINGS_API_VERSION,
    signal: a.signal,
    body,
  });

  if (status < 200 || status >= 300) {
    const { code, message } = readCalError(json, rawBody);
    throw new CalApiError({
      kind: classifyBookingFailure(status, message, rawBody),
      message: `Cal.com POST /v2/bookings returned ${status}`,
      status,
      calCode: code,
      calMessage: message,
    });
  }

  const parsed = bookingEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw new CalApiError({
      kind: 'upstream_error',
      message: 'Cal.com POST /v2/bookings returned an unexpected shape',
      status,
      calMessage: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    });
  }

  const startMs = Date.parse(parsed.data.data.start);
  if (!Number.isFinite(startMs)) {
    throw new CalApiError({
      kind: 'upstream_error',
      message: 'Cal.com POST /v2/bookings returned an unparseable start',
      status,
      calMessage: parsed.data.data.start,
    });
  }

  // Cal.com answers 2026-08-04T04:00:00Z. Normalise to the millisecond form so
  // the value written to Postgres matches the value handed to the agent.
  return { uid: parsed.data.data.uid, startUtcISO: new Date(startMs).toISOString() };
}
