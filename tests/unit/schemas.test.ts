import { describe, expect, it } from 'vitest';

import {
  BookMeetingInput,
  BookMeetingOutput,
  CheckAvailabilityInput,
  CheckAvailabilityOutput,
  ConversationAnchor,
  EmailSchema,
  TOOL_FALLBACK,
  TOOL_SCHEMAS,
  TOOL_TIMEOUT,
} from '@/lib/schemas';

describe('check_availability input', () => {
  it('accepts the SPEC section 11.2 gate payload', () => {
    const parsed = CheckAvailabilityInput.safeParse({
      conversation_id: 'curl_test_1',
      timezone: 'Asia/Karachi',
      days: 3,
    });

    expect(parsed.success).toBe(true);
  });

  it('requires conversation_id and timezone', () => {
    expect(CheckAvailabilityInput.safeParse({ timezone: 'Asia/Karachi' }).success).toBe(false);
    expect(CheckAvailabilityInput.safeParse({ conversation_id: 'c1' }).success).toBe(false);
    expect(
      CheckAvailabilityInput.safeParse({ conversation_id: '', timezone: 'Asia/Karachi' }).success,
    ).toBe(false);
  });

  it('bounds days and constrains start_date to a calendar date', () => {
    const base = { conversation_id: 'c1', timezone: 'Asia/Karachi' };

    expect(CheckAvailabilityInput.safeParse({ ...base, days: 0 }).success).toBe(false);
    expect(CheckAvailabilityInput.safeParse({ ...base, days: 15 }).success).toBe(false);
    expect(CheckAvailabilityInput.safeParse({ ...base, days: 14 }).success).toBe(true);
    expect(CheckAvailabilityInput.safeParse({ ...base, start_date: '05-08-2026' }).success).toBe(
      false,
    );
    expect(CheckAvailabilityInput.safeParse({ ...base, start_date: '2026-08-05' }).success).toBe(
      true,
    );
  });
});

describe('check_availability output', () => {
  it('caps slots at five', () => {
    const slot = { start_utc: '2026-08-05T04:00:00.000Z', label: 'Wednesday, August 5 at 9:00 AM' };

    expect(
      CheckAvailabilityOutput.safeParse({
        ok: true,
        timezone: 'Asia/Karachi',
        slots: Array.from({ length: 5 }, () => slot),
      }).success,
    ).toBe(true);

    expect(
      CheckAvailabilityOutput.safeParse({
        ok: true,
        timezone: 'Asia/Karachi',
        slots: Array.from({ length: 6 }, () => slot),
      }).success,
    ).toBe(false);
  });

  it('requires speak on every failure and restricts the reason set', () => {
    expect(
      CheckAvailabilityOutput.safeParse({ ok: false, reason: 'no_slots' }).success,
    ).toBe(false);
    expect(
      CheckAvailabilityOutput.safeParse({ ok: false, reason: 'slot_taken', speak: 'x' }).success,
    ).toBe(false);
    expect(
      CheckAvailabilityOutput.safeParse({ ok: false, reason: 'no_slots', speak: 'x' }).success,
    ).toBe(true);
  });
});

describe('book_meeting input', () => {
  const valid = {
    conversation_id: 'curl_test_1',
    timezone: 'Asia/Karachi',
    start_utc: '2026-08-05T04:00:00.000Z',
    name: 'Curl Test',
    email: 'test@example.com',
  };

  it('accepts the SPEC section 11.2 gate payload', () => {
    expect(BookMeetingInput.safeParse(valid).success).toBe(true);
  });

  it('does NOT reject a malformed email at the choke point', () => {
    // Load bearing. SPEC section 6.3 requires a mangled address to come back as
    // a structured 200 with reason invalid_email so the agent asks the visitor
    // to type it, not as a 400 envelope. Validating email here would break that,
    // so the route validates it instead.
    expect(BookMeetingInput.safeParse({ ...valid, email: 'not an email' }).success).toBe(true);
  });

  it('does NOT reject a malformed start_utc at the choke point', () => {
    // Same reasoning. A bad slot owes the agent a spoken invalid_slot retry.
    expect(BookMeetingInput.safeParse({ ...valid, start_utc: 'tomorrow at nine' }).success).toBe(
      true,
    );
  });

  it('still enforces presence and bounds', () => {
    expect(BookMeetingInput.safeParse({ ...valid, email: '' }).success).toBe(false);
    expect(BookMeetingInput.safeParse({ ...valid, name: '' }).success).toBe(false);
    expect(BookMeetingInput.safeParse({ ...valid, start_utc: '' }).success).toBe(false);
    expect(BookMeetingInput.safeParse({ ...valid, email: 'a'.repeat(255) }).success).toBe(false);
    expect(BookMeetingInput.safeParse({ ...valid, notes: 'n'.repeat(2001) }).success).toBe(false);
  });
});

describe('book_meeting output', () => {
  it('accepts the success shape and requires every field', () => {
    const ok = {
      ok: true,
      booking_uid: 'babGzAoN9YXJ4FnXz1bpq1',
      start_utc: '2026-08-05T04:00:00.000Z',
      label: 'Wednesday, August 5 at 9:00 AM',
      speak: 'You are booked.',
    };

    expect(BookMeetingOutput.safeParse(ok).success).toBe(true);
    expect(BookMeetingOutput.safeParse({ ...ok, booking_uid: undefined }).success).toBe(false);
  });

  it('restricts the failure reason set to the five in SPEC section 4.1', () => {
    for (const reason of [
      'invalid_email',
      'slot_taken',
      'upstream_timeout',
      'upstream_error',
      'invalid_slot',
    ]) {
      expect(BookMeetingOutput.safeParse({ ok: false, reason, speak: 'x' }).success).toBe(true);
    }
    expect(BookMeetingOutput.safeParse({ ok: false, reason: 'no_slots', speak: 'x' }).success).toBe(
      false,
    );
  });
});

describe('the registry and the canned failure bodies', () => {
  it('exposes both tools with an input and an output schema', () => {
    expect(Object.keys(TOOL_SCHEMAS).sort()).toEqual(['book_meeting', 'check_availability']);
  });

  it('holds fallback and timeout bodies that pass their own output schema', () => {
    // If these ever drift they would be written to tool_invocations and read
    // aloud without the output parse catching it, since they are the very thing
    // returned when the output parse fails.
    for (const name of ['check_availability', 'book_meeting'] as const) {
      expect(TOOL_SCHEMAS[name].output.safeParse(TOOL_FALLBACK[name]).success).toBe(true);
      expect(TOOL_SCHEMAS[name].output.safeParse(TOOL_TIMEOUT[name]).success).toBe(true);
    }
  });

  it('salvages conversation_id from an otherwise invalid payload', () => {
    // So a malformed tool call still lands in the dashboard timeline rather
    // than vanishing.
    const parsed = ConversationAnchor.safeParse({ conversation_id: 'conv_1', junk: true });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.conversation_id).toBe('conv_1');
  });
});

describe('EmailSchema', () => {
  it('accepts a plus addressed mailbox and rejects speech to text damage', () => {
    expect(EmailSchema.safeParse('you+voxdesk@example.com').success).toBe(true);
    expect(EmailSchema.safeParse('you at example dot com').success).toBe(false);
    expect(EmailSchema.safeParse('you@').success).toBe(false);
  });
});
