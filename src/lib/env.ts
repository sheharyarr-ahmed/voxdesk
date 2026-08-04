// Server only. Parsed once at import, so a missing or malformed variable throws
// at boot rather than mid call.
//
// This file is imported by src/middleware.ts, which runs on the Edge runtime.
// The only dependency permitted here is zod. No node: imports, no database
// client, no fetch helpers, ever.
import { z } from 'zod';

if (typeof window !== 'undefined') {
  throw new Error(
    'src/lib/env.ts was pulled into a client bundle. It is server only. ' +
      'Pass what the component needs down as a prop from a server component.',
  );
}

const positiveIntString = z
  .string()
  .regex(/^\d+$/, 'must be a whole number written as digits only')
  .transform((value) => Number.parseInt(value, 10))
  .refine((value) => value > 0 && Number.isSafeInteger(value), 'must be greater than zero');

// Never interpolate a value into a message. These strings land in build logs,
// which are not a secret store.
const secret = (minimum: number) =>
  z.string().min(minimum, `must be at least ${minimum} characters`);

const ianaTimeZone = z.string().min(1, 'is required').refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
  // Constructing the formatter rather than checking membership in
  // Intl.supportedValuesOf('timeZone') is deliberate. The constructor accepts
  // valid IANA aliases such as Asia/Calcutta that supportedValuesOf omits, and
  // a browser really does report those.
}, 'is not a time zone this runtime recognises');

/**
 * Encodes the failure recorded in docs/CREDENTIALS.md section 5. Supabase prints
 * the connection string with a [YOUR-PASSWORD] placeholder, and leaving the
 * brackets in produces a password of [realpassword], which fails with 28P01 and
 * reads exactly like a wrong password rather than a formatting error. It
 * survived three visual inspections once already.
 */
const postgresUrl = (expectedPort: 5432 | 6543) =>
  z
    .string()
    .min(1, 'is required')
    .superRefine((value, ctx) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'is not a valid URL' });
        return;
      }

      if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
        ctx.addIssue({ code: 'custom', message: 'is not a postgresql:// connection string' });
        return;
      }

      let password: string;
      try {
        password = decodeURIComponent(url.password);
      } catch {
        password = url.password;
      }
      if (/^\[.*\]$/.test(password)) {
        ctx.addIssue({
          code: 'custom',
          message:
            'still contains the [YOUR-PASSWORD] placeholder brackets. Replace the brackets too, not just the text between them.',
        });
      }

      if (url.port !== String(expectedPort)) {
        ctx.addIssue({
          code: 'custom',
          message:
            expectedPort === 6543
              ? 'must use port 6543, the transaction pooler, which is the runtime target'
              : 'must use port 5432, the session pooler, which is what drizzle-kit needs for DDL',
        });
      }
    });

// Vercel writes an unset variable through as an empty string on some paths and
// as undefined on others. Fold both onto the documented default, then run the
// same validation an explicit value would get.
const withDefault = <T extends z.ZodTypeAny>(fallback: string, schema: T) =>
  z.preprocess((value) => (value === undefined || value === '' ? fallback : value), schema);

const EnvSchema = z.object({
  ELEVENLABS_API_KEY: secret(20),
  ELEVENLABS_AGENT_ID: z
    .string()
    .min(1, 'is required')
    .startsWith('agent_', 'should be the agent id, which starts with agent_, not the agent name'),

  // Defaults to empty rather than being required. Both Cal.com endpoints are
  // public for a public event type, and POST /v2/bookings sits behind an
  // optional auth guard that still throws on an invalid key. So if the key is
  // ever revoked, clearing this one variable in Vercel restores the working
  // unauthenticated path with no code change.
  CAL_API_KEY: z.preprocess((value) => value ?? '', z.string()),
  CAL_EVENT_TYPE_ID: positiveIntString,

  DATABASE_URL: postgresUrl(6543),
  DIRECT_URL: postgresUrl(5432),

  TOOL_SHARED_SECRET: secret(32),
  SESSION_SECRET: secret(32),
  DEMO_PASSCODE: secret(8),

  DAILY_SESSION_CAP: withDefault('6', positiveIntString),
  DEFAULT_TIMEZONE: withDefault('Asia/Karachi', ianaTimeZone),

  // Phase 3. Empty is a legal phase 1 state and must not block boot. Read it
  // through requireWebhookSecret(), never directly.
  ELEVENLABS_WEBHOOK_SECRET: z.preprocess((value) => value ?? '', z.string()),
});

export type Env = z.infer<typeof EnvSchema>;

// An explicit literal rather than EnvSchema.parse(process.env). process.env is
// not a real indexable object inside the Edge bundle, so the spread form yields
// an empty object there while working fine in Node. It also means grepping this
// file for process.env is the complete list of variables the codebase consumes.
const parsed = EnvSchema.safeParse({
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  ELEVENLABS_AGENT_ID: process.env.ELEVENLABS_AGENT_ID,
  CAL_API_KEY: process.env.CAL_API_KEY,
  CAL_EVENT_TYPE_ID: process.env.CAL_EVENT_TYPE_ID,
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
  TOOL_SHARED_SECRET: process.env.TOOL_SHARED_SECRET,
  SESSION_SECRET: process.env.SESSION_SECRET,
  DEMO_PASSCODE: process.env.DEMO_PASSCODE,
  DAILY_SESSION_CAP: process.env.DAILY_SESSION_CAP,
  DEFAULT_TIMEZONE: process.env.DEFAULT_TIMEZONE,
  ELEVENLABS_WEBHOOK_SECRET: process.env.ELEVENLABS_WEBHOOK_SECRET,
});

if (!parsed.success) {
  throw new Error(
    'Environment is invalid. Fix .env.local locally, or the Vercel project ' +
      `settings for this environment, then redeploy.\n\n${z.prettifyError(parsed.error)}`,
  );
}

export const env: Readonly<Env> = Object.freeze(parsed.data);

/**
 * HMAC-SHA256 with an empty key is a perfectly valid HMAC. If the webhook secret
 * were allowed to default to an empty string and flow into signature
 * verification, anyone who guessed it was unset could forge a signature over any
 * payload. So an unset secret has to be a hard stop at the point of use rather
 * than a silently weak verifier.
 */
export function requireWebhookSecret(): string {
  if (env.ELEVENLABS_WEBHOOK_SECRET.length < 16) {
    throw new Error(
      'ELEVENLABS_WEBHOOK_SECRET is not set. The post call webhook cannot verify ' +
        'a signature without it and must not fall back to accepting the payload.',
    );
  }
  return env.ELEVENLABS_WEBHOOK_SECRET;
}
