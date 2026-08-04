import { env } from '@/lib/env';

/**
 * SPEC.md section 6.4. The console reports the browser's zone and both tools
 * receive it. A zone that fails validation falls back to DEFAULT_TIMEZONE rather
 * than rejecting the tool call, because there is no spoken remedy for a bad
 * timezone and burning a conversational turn on it is worse than a sane default.
 *
 * Validity is decided by constructing an Intl.DateTimeFormat rather than by
 * membership in Intl.supportedValuesOf('timeZone'). The constructor accepts
 * valid IANA aliases such as Asia/Calcutta that supportedValuesOf omits, and
 * browsers really do report those. Deviation 10.
 */
export function normaliseTimeZone(candidate: string | undefined): string {
  if (candidate) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: candidate });
      return candidate;
    } catch {
      // fall through
    }
  }
  return env.DEFAULT_TIMEZONE;
}
