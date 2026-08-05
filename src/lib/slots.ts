// Slot formatting and the 60s availability cache, SPEC.md section 6.2.
import { getSlots, type CalSlot } from '@/lib/cal';

export type FormattedSlot = { start_utc: string; label: string };

export const MAX_SLOTS = 5;
export const SLOTS_CACHE_TTL_MS = 60_000;
export const DEFAULT_WINDOW_DAYS = 3;

// The key includes the visitor timezone, which is attacker influenced through
// dynamicVariables, so the map needs a ceiling.
const CACHE_MAX_ENTRIES = 64;

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  const existing = dayFormatters.get(timeZone);
  if (existing) return existing;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  dayFormatters.set(timeZone, created);
  return created;
}

function timeFormatter(timeZone: string): Intl.DateTimeFormat {
  const existing = timeFormatters.get(timeZone);
  if (existing) return existing;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  timeFormatters.set(timeZone, created);
  return created;
}

/**
 * ICU 72 and later emit U+202F between the minute and the meridiem. Left in
 * place it makes label assertions depend on the ICU version and hands a narrow
 * no break space to text to speech.
 */
function normaliseSpaces(value: string): string {
  return value.replace(/[\u202f\u00a0]/g, ' ');
}

export function slotLabel(startUtcISO: string, timeZone: string): string {
  const at = new Date(startUtcISO);
  const day = normaliseSpaces(dayFormatter(timeZone).format(at));
  const time = normaliseSpaces(timeFormatter(timeZone).format(at));
  return `${day} at ${time}`;
}

const callFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * The /calls timestamp, phase 3.
 *
 * It lives beside slotLabel rather than in a new module because this file already
 * owns every Intl.DateTimeFormat in the build, along with the memo maps and the
 * U+202F normalisation that any new formatter has to repeat. Adding src/lib/format.ts
 * for two functions would be a file outside the SPEC.md section 4 tree.
 *
 * It carries the year, which slotLabel deliberately omits. That omission is right for
 * a three day booking window and wrong for a call log that outlives one.
 *
 * Takes an ISO string rather than a Date for the same reason slotLabel does. Because
 * src/lib/db/client.ts sets fetch_types: false, a timestamptz column comes back as the
 * Postgres text form, 2026-08-05 08:17:50.876827+00, and not as a Date. V8 happens to
 * parse that, but it is not ISO 8601 and nothing should depend on a lenient parser, so
 * the queries cast through to_json and hand a real ISO string down to here.
 */
export function callTimestamp(atISO: string, timeZone: string): string {
  const at = new Date(atISO);
  if (Number.isNaN(at.getTime())) return 'unknown time';

  const existing = callFormatters.get(timeZone);
  const formatter =
    existing ??
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  if (existing === undefined) callFormatters.set(timeZone, formatter);
  return normaliseSpaces(formatter.format(at));
}

/** Call length as m:ss. Null while a call is still in progress or never reported one. */
export function durationLabel(seconds: number | null): string | null {
  if (seconds === null || seconds < 0) return null;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds - minutes * 60).padStart(2, '0')}`;
}

/**
 * Cal.com hands back the offset form when timeZone is requested, for example
 * 2026-08-05T09:00:00.000+05:00. new Date(...).toISOString() is the conversion
 * to the UTC form SPEC.md section 6.4 puts on the wire, and the round trip back
 * into POST /v2/bookings is verified against the live calendar.
 *
 * Sorts, de duplicates on the absolute instant, then caps. Capping before
 * sorting would hand back an arbitrary five rather than the five earliest.
 */
export function formatSlots(
  slots: readonly CalSlot[],
  timeZone: string,
  limit: number = MAX_SLOTS,
): FormattedSlot[] {
  const instants = slots
    .map((slot) => Date.parse(slot.start))
    .filter((ms) => Number.isFinite(ms))
    .sort((left, right) => left - right);

  const seen = new Set<number>();
  const formatted: FormattedSlot[] = [];

  for (const ms of instants) {
    if (seen.has(ms)) continue;
    seen.add(ms);
    const startUtc = new Date(ms).toISOString();
    formatted.push({ start_utc: startUtc, label: slotLabel(startUtc, timeZone) });
    if (formatted.length >= limit) break;
  }

  return formatted;
}

type CacheEntry = { expiresAt: number; slots: readonly FormattedSlot[] };

const slotsCache = new Map<string, CacheEntry>();

/**
 * SPEC.md section 6.2 specifies `${date}|${timezone}`. check_availability also
 * accepts a variable `days`, and a two part key would serve a one day answer to
 * a three day request, so the window length is folded into the key.
 */
export function slotsCacheKey(a: { date: string; days: number; timeZone: string }): string {
  return `${a.date}:${a.days}d|${a.timeZone}`;
}

export function readSlotsCache(key: string): FormattedSlot[] | null {
  const entry = slotsCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    slotsCache.delete(key);
    return null;
  }
  return entry.slots.map((slot) => ({ ...slot }));
}

export function writeSlotsCache(key: string, slots: readonly FormattedSlot[]): void {
  const now = Date.now();

  for (const [existingKey, entry] of slotsCache) {
    if (entry.expiresAt <= now) slotsCache.delete(existingKey);
  }

  while (slotsCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = slotsCache.keys().next();
    if (oldest.done) break;
    slotsCache.delete(oldest.value);
  }

  // Re insert so Map insertion order stays a usable recency order.
  slotsCache.delete(key);
  slotsCache.set(key, {
    expiresAt: now + SLOTS_CACHE_TTL_MS,
    slots: slots.map((slot) => ({ ...slot })),
  });
}

export function clearSlotsCache(): void {
  slotsCache.clear();
}

/** YYYY-MM-DD in the visitor's zone. en-CA formats dates in ISO order. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Date only bounds. Cal.com normalises start to 00:00:00 and end to 23:59:59 on
 * that same date, so a days=3 window starting today covers today, tomorrow and
 * the day after in full.
 */
export function slotsWindow(date: string, days: number): { startISO: string; endISO: string } {
  const span = Math.max(1, Math.trunc(days));
  const startMs = Date.parse(`${date}T00:00:00.000Z`);
  const endMs = startMs + (span - 1) * 86_400_000;
  return { startISO: date, endISO: new Date(endMs).toISOString().slice(0, 10) };
}

/**
 * What the availability route calls. Cache wraps fetch in exactly one place.
 *
 * The cache is module scope, so it lives as long as one Vercel instance. A cold
 * start pays full Cal.com latency, and two concurrent conversations on two
 * instances both call upstream. That is correct: this is a latency optimisation,
 * not a rate limiter and not a correctness mechanism. Staleness is safe by
 * construction, because createBooking is the source of truth and answers
 * slot_taken if the offered slot went in the meantime.
 */
export async function getFormattedSlots(a: {
  date: string;
  days: number;
  timeZone: string;
  eventTypeId: number;
  signal: AbortSignal;
}): Promise<{ slots: FormattedSlot[]; cached: boolean }> {
  const key = slotsCacheKey({ date: a.date, days: a.days, timeZone: a.timeZone });

  const hit = readSlotsCache(key);
  if (hit) return { slots: hit, cached: true };

  const { startISO, endISO } = slotsWindow(a.date, a.days);
  const raw = await getSlots({
    startISO,
    endISO,
    timeZone: a.timeZone,
    eventTypeId: a.eventTypeId,
    signal: a.signal,
  });

  const slots = formatSlots(raw, a.timeZone);
  writeSlotsCache(key, slots);
  return { slots, cached: false };
}
