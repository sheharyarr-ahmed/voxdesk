import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CalSlot } from '@/lib/cal';
import {
  MAX_SLOTS,
  SLOTS_CACHE_TTL_MS,
  clearSlotsCache,
  formatSlots,
  getFormattedSlots,
  readSlotsCache,
  slotLabel,
  slotsCacheKey,
  slotsWindow,
  todayInTimeZone,
  writeSlotsCache,
} from '@/lib/slots';

beforeEach(() => {
  clearSlotsCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('offset to UTC conversion', () => {
  it('converts the Cal.com offset form to the UTC form on the wire', () => {
    // The exact pair recorded in V4 and re observed from the deployed function:
    // Cal.com returns the requested zone's offset, and SPEC section 6.4 requires
    // UTC on the wire. Booking with the right hand value is what closed the
    // round trip against the live calendar.
    const slots: CalSlot[] = [{ start: '2026-08-04T09:00:00.000+05:00' }];

    expect(formatSlots(slots, 'Asia/Karachi')[0].start_utc).toBe('2026-08-04T04:00:00.000Z');
  });

  it('agrees with new Date(...).toISOString() for every returned slot', () => {
    const slots: CalSlot[] = [
      { start: '2026-08-05T09:00:00.000+05:00' },
      { start: '2026-08-05T09:15:00.000+05:00' },
      { start: '2026-08-06T09:00:00.000+05:00' },
    ];

    expect(formatSlots(slots, 'Asia/Karachi').map((s) => s.start_utc)).toEqual(
      slots.map((s) => new Date(s.start).toISOString()),
    );
  });

  it('still works when Cal.com answers in UTC because timeZone was omitted', () => {
    expect(formatSlots([{ start: '2026-08-04T04:00:00.000Z' }], 'Asia/Karachi')[0].start_utc).toBe(
      '2026-08-04T04:00:00.000Z',
    );
  });
});

describe('five slot cap', () => {
  const twelveSlots: CalSlot[] = Array.from({ length: 12 }, (_, index) => {
    const at = new Date(Date.parse('2026-08-04T09:00:00.000+05:00') + index * 15 * 60_000);
    return { start: at.toISOString() };
  });

  it('caps at five so the agent never reads a wall of times', () => {
    expect(twelveSlots).toHaveLength(12);
    expect(formatSlots(twelveSlots, 'Asia/Karachi')).toHaveLength(5);
    expect(MAX_SLOTS).toBe(5);
  });

  it('returns the five earliest, not an arbitrary five', () => {
    // Capping before sorting would pass the length assertion above while
    // handing the agent whatever order the upstream happened to use.
    const shuffled = [...twelveSlots].reverse();

    expect(formatSlots(shuffled, 'Asia/Karachi').map((s) => s.start_utc)).toEqual([
      '2026-08-04T04:00:00.000Z',
      '2026-08-04T04:15:00.000Z',
      '2026-08-04T04:30:00.000Z',
      '2026-08-04T04:45:00.000Z',
      '2026-08-04T05:00:00.000Z',
    ]);
  });

  it('returns fewer than five when fewer exist', () => {
    expect(formatSlots(twelveSlots.slice(0, 2), 'Asia/Karachi')).toHaveLength(2);
  });

  it('de duplicates the same instant expressed two ways before capping', () => {
    const duplicated: CalSlot[] = [
      { start: '2026-08-04T09:00:00.000+05:00' },
      { start: '2026-08-04T04:00:00.000Z' },
      { start: '2026-08-04T09:15:00.000+05:00' },
    ];

    expect(formatSlots(duplicated, 'Asia/Karachi')).toHaveLength(2);
  });

  it('drops unparseable starts rather than emitting Invalid Date', () => {
    const formatted = formatSlots(
      [{ start: 'not-a-date' }, { start: '2026-08-04T09:00:00.000+05:00' }],
      'Asia/Karachi',
    );

    expect(formatted).toHaveLength(1);
    expect(formatted[0].label).not.toContain('Invalid');
  });
});

describe('labels', () => {
  it('labels one instant differently in two visitor timezones', () => {
    const slots: CalSlot[] = [{ start: '2026-08-04T09:00:00.000+05:00' }];

    expect(formatSlots(slots, 'Asia/Karachi')[0].label).toBe('Tuesday, August 4 at 9:00 AM');
    expect(formatSlots(slots, 'America/Los_Angeles')[0].label).toBe('Monday, August 3 at 9:00 PM');
  });

  it('emits no narrow no break space, which is ICU version dependent', () => {
    expect(slotLabel('2026-08-04T04:00:00.000Z', 'Asia/Karachi')).not.toMatch(/[  ]/);
  });
});

describe('window and date helpers', () => {
  it('builds an inclusive date only window', () => {
    expect(slotsWindow('2026-08-05', 3)).toEqual({ startISO: '2026-08-05', endISO: '2026-08-07' });
  });

  it('treats a one day window as a single date', () => {
    expect(slotsWindow('2026-08-05', 1)).toEqual({ startISO: '2026-08-05', endISO: '2026-08-05' });
  });

  it('reads today in the visitor zone, not the server zone', () => {
    const at = new Date('2026-08-04T20:00:00.000Z');

    expect(todayInTimeZone('Asia/Karachi', at)).toBe('2026-08-05');
    expect(todayInTimeZone('America/Los_Angeles', at)).toBe('2026-08-04');
  });
});

describe('sixty second module scope cache', () => {
  const entry = [{ start_utc: '2026-08-04T04:00:00.000Z', label: 'Tuesday, August 4 at 9:00 AM' }];

  it('keys on date, window length and timezone', () => {
    expect(slotsCacheKey({ date: '2026-08-04', days: 3, timeZone: 'Asia/Karachi' })).toBe(
      '2026-08-04:3d|Asia/Karachi',
    );
  });

  it('does not serve one timezone from another timezone entry', () => {
    writeSlotsCache(slotsCacheKey({ date: '2026-08-04', days: 3, timeZone: 'Asia/Karachi' }), entry);

    expect(
      readSlotsCache(slotsCacheKey({ date: '2026-08-04', days: 3, timeZone: 'Europe/London' })),
    ).toBeNull();
  });

  it('does not serve a three day request from a one day entry', () => {
    // SPEC section 6.2 keys on date and timezone only. check_availability also
    // accepts days, so the window length has to be in the key or a one day
    // answer gets served to a three day request.
    writeSlotsCache(slotsCacheKey({ date: '2026-08-04', days: 1, timeZone: 'Asia/Karachi' }), entry);

    expect(
      readSlotsCache(slotsCacheKey({ date: '2026-08-04', days: 3, timeZone: 'Asia/Karachi' })),
    ).toBeNull();
  });

  it('hands out a copy so a caller cannot mutate cached state', () => {
    const key = slotsCacheKey({ date: '2026-08-04', days: 3, timeZone: 'Asia/Karachi' });
    writeSlotsCache(key, entry);

    const first = readSlotsCache(key);
    if (!first) throw new Error('expected a cache hit');
    first[0].label = 'mutated';

    expect(readSlotsCache(key)?.[0].label).toBe('Tuesday, August 4 at 9:00 AM');
  });

  it('hits inside sixty seconds and expires after', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T09:00:00.000Z'));

    const key = slotsCacheKey({ date: '2026-08-04', days: 3, timeZone: 'Asia/Karachi' });
    writeSlotsCache(key, entry);

    vi.advanceTimersByTime(SLOTS_CACHE_TTL_MS - 1);
    expect(readSlotsCache(key)).toHaveLength(1);

    vi.advanceTimersByTime(2);
    expect(readSlotsCache(key)).toBeNull();
  });

  it('spares Cal.com the second call when the agent re checks inside the window', async () => {
    // This is the case SPEC section 6.2 names: the agent re checking
    // availability inside one conversation.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T09:00:00.000Z'));

    // A fresh Response per call. A Response body can only be read once, so
    // reusing one instance makes the second call fail with "Body is unusable"
    // and would mask whether the cache was consulted at all.
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ data: { '2026-08-04': [{ start: '2026-08-04T09:00:00.000+05:00' }] } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const args = {
      date: '2026-08-04',
      days: 3,
      timeZone: 'Asia/Karachi',
      eventTypeId: 5725517,
      signal: new AbortController().signal,
    };

    const first = await getFormattedSlots(args);
    const second = await getFormattedSlots(args);

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.slots).toEqual(first.slots);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(SLOTS_CACHE_TTL_MS + 1);
    const third = await getFormattedSlots(args);

    expect(third.cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
