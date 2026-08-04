// fetch is mocked throughout. Cal.com is unreachable from this machine via curl
// because Cloudflare scores the client fingerprint, so live checks run against
// the deployed URL and unit coverage mocks the boundary, which is correct
// practice regardless.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CAL_BOOKINGS_API_VERSION,
  CAL_SLOTS_API_VERSION,
  CalApiError,
  createBooking,
  getSlots,
} from '@/lib/cal';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The exact error envelope observed from the live API on 2026-08-04. */
function calErrorResponse(status: number, code: string, message: string): Response {
  return jsonResponse(status, {
    status: 'error',
    timestamp: '2026-08-04T11:35:40.675Z',
    path: '/v2/bookings',
    error: { code, message, details: { message, error: 'Bad Request', statusCode: status } },
  });
}

function lastCall(): [URL | string, RequestInit] {
  const call = fetchMock.mock.calls[0] as [URL | string, RequestInit];
  return call;
}

function callUrl(): URL {
  const [input] = lastCall();
  return input instanceof URL ? input : new URL(String(input));
}

function callHeaders(): Headers {
  return new Headers(lastCall()[1]?.headers as HeadersInit);
}

function callBody(): Record<string, unknown> {
  const body = lastCall()[1]?.body;
  if (typeof body !== 'string') throw new Error('expected a serialised JSON body');
  return JSON.parse(body) as Record<string, unknown>;
}

const signal = (): AbortSignal => new AbortController().signal;

const slotsArgs = {
  startISO: '2026-08-05',
  endISO: '2026-08-07',
  timeZone: 'Asia/Karachi',
  eventTypeId: 5725517,
};

describe('getSlots', () => {
  it('sends the exact 2024-09-04 contract and no extra query parameters', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: {} }));
    const abort = new AbortController();

    await getSlots({ ...slotsArgs, signal: abort.signal });

    const url = callUrl();
    expect(`${url.origin}${url.pathname}`).toBe('https://api.cal.com/v2/slots');
    expect(url.searchParams.get('eventTypeId')).toBe('5725517');
    // start and end, NOT startTime and endTime.
    expect(url.searchParams.get('start')).toBe('2026-08-05');
    expect(url.searchParams.get('end')).toBe('2026-08-07');
    expect(url.searchParams.get('timeZone')).toBe('Asia/Karachi');

    // The endpoint validates with forbidNonWhitelisted, so any extra parameter
    // is a 400 rather than being ignored. This asserts the exact set.
    expect([...url.searchParams.keys()].sort()).toEqual(['end', 'eventTypeId', 'start', 'timeZone']);

    const headers = callHeaders();
    expect(headers.get('cal-api-version')).toBe('2024-09-04');
    expect(CAL_SLOTS_API_VERSION).toBe('2024-09-04');
    expect(headers.get('authorization')).toBe('Bearer cal_test_00000000000000000000');
    expect(lastCall()[1]?.method).toBe('GET');
    expect(lastCall()[1]?.signal).toBe(abort.signal);
  });

  it('accepts the bare data envelope with no status wrapper', async () => {
    // Confirmed against the live API on 2026-08-04: the slots success body has
    // no "status":"success" key, unlike the booking response. Requiring one
    // would reject every valid response.
    fetchMock.mockResolvedValue(
      jsonResponse(200, { data: { '2026-08-05': [{ start: '2026-08-05T09:00:00.000+05:00' }] } }),
    );

    const slots = await getSlots({ ...slotsArgs, signal: signal() });

    expect(slots).toEqual([{ start: '2026-08-05T09:00:00.000+05:00' }]);
  });

  it('flattens every date key and orders by absolute instant', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: {
          '2026-08-06': [{ start: '2026-08-06T09:00:00.000+05:00' }],
          '2026-08-05': [
            { start: '2026-08-05T09:15:00.000+05:00' },
            { start: '2026-08-05T09:00:00.000+05:00' },
          ],
        },
      }),
    );

    const slots = await getSlots({ ...slotsArgs, signal: signal() });

    expect(slots.map((s) => s.start)).toEqual([
      '2026-08-05T09:00:00.000+05:00',
      '2026-08-05T09:15:00.000+05:00',
      '2026-08-06T09:00:00.000+05:00',
    ]);
  });

  it('maps the missing version header 404 to upstream_error', async () => {
    fetchMock.mockResolvedValue(
      calErrorResponse(404, 'NotFoundException', 'Cannot GET /v2/slots'),
    );

    const failure = await getSlots({ ...slotsArgs, signal: signal() }).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(CalApiError);
    if (!(failure instanceof CalApiError)) throw failure;
    expect(failure.kind).toBe('upstream_error');
    expect(failure.status).toBe(404);
    expect(failure.calCode).toBe('NotFoundException');
  });

  it('maps an unexpected response shape to upstream_error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }));

    const failure = await getSlots({ ...slotsArgs, signal: signal() }).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(CalApiError);
    if (!(failure instanceof CalApiError)) throw failure;
    expect(failure.kind).toBe('upstream_error');
  });

  it('maps an aborted fetch to upstream_timeout', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));

    const failure = await getSlots({ ...slotsArgs, signal: signal() }).catch((e: unknown) => e);

    if (!(failure instanceof CalApiError)) throw failure;
    expect(failure.kind).toBe('upstream_timeout');
  });
});

describe('createBooking', () => {
  const accepted = () =>
    jsonResponse(201, {
      status: 'success',
      data: {
        id: 23284338,
        uid: 'babGzAoN9YXJ4FnXz1bpq1',
        status: 'accepted',
        start: '2026-08-05T04:00:00Z',
        end: '2026-08-05T04:15:00Z',
        duration: 15,
      },
    });

  const bookingArgs = {
    startUtcISO: '2026-08-05T04:00:00.000Z',
    eventTypeId: 5725517,
    attendee: { name: 'Curl Test', email: 'test@example.com', timeZone: 'Asia/Karachi' },
  };

  it('sends the exact 2024-08-13 body, with no end and no lengthInMinutes', async () => {
    fetchMock.mockResolvedValue(accepted());
    const abort = new AbortController();

    await createBooking({ ...bookingArgs, notes: 'Wants a discovery call', signal: abort.signal });

    expect(callUrl().toString()).toBe('https://api.cal.com/v2/bookings');
    expect(lastCall()[1]?.method).toBe('POST');
    expect(lastCall()[1]?.signal).toBe(abort.signal);

    const headers = callHeaders();
    expect(headers.get('cal-api-version')).toBe('2024-08-13');
    expect(CAL_BOOKINGS_API_VERSION).toBe('2024-08-13');
    expect(headers.get('content-type')).toBe('application/json');

    const body = callBody();
    expect(body).toEqual({
      start: '2026-08-05T04:00:00.000Z',
      eventTypeId: 5725517,
      attendee: { name: 'Curl Test', email: 'test@example.com', timeZone: 'Asia/Karachi' },
      bookingFieldsResponses: { notes: 'Wants a discovery call' },
    });

    // Each of these would be a 400 against the real API. `end` is derived from
    // the event type length, and lengthInMinutes is rejected on a fixed length
    // event type.
    expect(body).not.toHaveProperty('end');
    expect(body).not.toHaveProperty('lengthInMinutes');
    expect(typeof body.eventTypeId).toBe('number');
  });

  it('omits bookingFieldsResponses when notes are absent or blank', async () => {
    fetchMock.mockResolvedValue(accepted());

    await createBooking({ ...bookingArgs, notes: '   ', signal: signal() });

    expect(callBody()).not.toHaveProperty('bookingFieldsResponses');
  });

  it('normalises the returned start to the millisecond UTC form', async () => {
    fetchMock.mockResolvedValue(accepted());

    const booking = await createBooking({ ...bookingArgs, signal: signal() });

    expect(booking).toEqual({
      uid: 'babGzAoN9YXJ4FnXz1bpq1',
      startUtcISO: '2026-08-05T04:00:00.000Z',
    });
  });

  it('maps the taken slot 400 to slot_taken, not upstream_error', async () => {
    // The single most important mapping in this file. A taken slot is a 400 on
    // Cal.com, not a 409, and is separable from a malformed request 400 only by
    // the message text.
    fetchMock.mockResolvedValue(
      calErrorResponse(
        400,
        'BadRequestException',
        'User either already has booking at this time or is not available',
      ),
    );

    const failure = await createBooking({ ...bookingArgs, signal: signal() }).catch(
      (e: unknown) => e,
    );

    if (!(failure instanceof CalApiError)) throw failure;
    expect(failure.kind).toBe('slot_taken');
    expect(failure.status).toBe(400);
  });

  it('maps the team variant of the taken slot message to slot_taken', async () => {
    fetchMock.mockResolvedValue(
      calErrorResponse(
        400,
        'BadRequestException',
        'One of the hosts either already has booking at this time or is not available',
      ),
    );

    const failure = await createBooking({ ...bookingArgs, signal: signal() }).catch(
      (e: unknown) => e,
    );

    if (!(failure instanceof CalApiError)) throw failure;
    expect(failure.kind).toBe('slot_taken');
  });

  it('maps the out of bounds 400 to invalid_slot', async () => {
    fetchMock.mockResolvedValue(
      calErrorResponse(
        400,
        'BadRequestException',
        'The event type can\'t be booked at the "start" time provided. This could be because it is too soon.',
      ),
    );

    const failure = await createBooking({ ...bookingArgs, signal: signal() }).catch(
      (e: unknown) => e,
    );

    if (!(failure instanceof CalApiError)) throw failure;
    expect(failure.kind).toBe('invalid_slot');
  });

  it('maps a pipe validation 400 to upstream_error rather than invalid_slot', async () => {
    // Our own bug is not "that time is gone". Reporting invalid_slot would make
    // the agent loop through slots forever chasing a fault it cannot fix.
    fetchMock.mockResolvedValue(
      calErrorResponse(
        400,
        'BadRequestException',
        'attendee property is wrong,timeZone must be a valid IANA time-zone  ',
      ),
    );

    const failure = await createBooking({ ...bookingArgs, signal: signal() }).catch(
      (e: unknown) => e,
    );

    if (!(failure instanceof CalApiError)) throw failure;
    expect(failure.kind).toBe('upstream_error');
  });

  it('maps a rejected API key 401 to upstream_error and keeps the status', async () => {
    fetchMock.mockResolvedValue(
      calErrorResponse(401, 'UnauthorizedException', 'ApiAuthStrategy - Invalid Bearer token'),
    );

    const failure = await createBooking({ ...bookingArgs, signal: signal() }).catch(
      (e: unknown) => e,
    );

    if (!(failure instanceof CalApiError)) throw failure;
    expect(failure.kind).toBe('upstream_error');
    expect(failure.status).toBe(401);
  });

  it('maps both abort flavours to upstream_timeout', async () => {
    for (const name of ['TimeoutError', 'AbortError']) {
      fetchMock.mockReset();
      fetchMock.mockRejectedValue(new DOMException('aborted', name));

      const failure = await createBooking({ ...bookingArgs, signal: signal() }).catch(
        (e: unknown) => e,
      );

      if (!(failure instanceof CalApiError)) throw failure;
      expect(failure.kind).toBe('upstream_timeout');
      expect(failure.status).toBeNull();
    }
  });
});
