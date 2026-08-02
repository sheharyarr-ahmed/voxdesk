# VoxDesk · SPEC

Source blueprint: `docs/BLUEPRINT.md`. This file is the build contract. Where the two disagree, this file wins, and every deviation is listed in §6.9.

---

## 1. GOAL

A passcode gated web page where a visitor talks to an ElevenLabs voice agent that answers from a controlled knowledge base, checks live Cal.com availability, and books a real discovery call during the conversation. Every call ends with its transcript, per tool request and response payloads with latencies, and extracted lead fields persisted to Supabase and rendered on a call log dashboard.

---

## 2. ARCHITECTURAL INVARIANT

ElevenLabs owns ears, brain, and mouth. Our server is never in the audio path. It is reached at exactly four points.

| # | Connection | Direction | Transport | When |
|---|---|---|---|---|
| 1 | Live conversation | Browser to ElevenLabs | WebRTC via `@elevenlabs/react` | Whole call |
| 2 | Session auth | Our server to ElevenLabs | REST, `xi-api-key` | Before call starts |
| 3 | Tool call | ElevenLabs to our server | HTTPS, shared secret header, synchronous | Mid call |
| 4 | Post call ingest | ElevenLabs to our server | HTTPS, HMAC signed | After call ends |

Any code that widens this surface is out of scope.

---

## 3. STACK, LOCKED

Next.js 15 App Router · TypeScript strict, no `any` · React 19 · Tailwind v4 · shadcn/ui · `@elevenlabs/react` (`useConversation`, never the embed widget) · Zod at every boundary · Supabase Postgres with RLS on every table · Drizzle ORM · Cal.com API v2 · Vitest unit · Playwright E2E · Vercel Hobby · pnpm.

---

## 4. FILE TREE AND INTERFACES

Every path below is either created or modified by this build. Nothing outside it is touched.

```
voxdesk/
├── SPEC.md
├── README.md
├── package.json
├── .env.example
├── .gitignore
├── .githooks/commit-msg
├── .claude/
│   ├── verify.sh
│   ├── rules/architecture.md
│   └── decisions/*.md
├── scripts/check-copy.sh
├── agent/
│   ├── agent.config.json
│   ├── ids.json                      resolved remote ids, committed
│   ├── prompts/system.md
│   ├── knowledge/sherylabs.md
│   ├── tools/check_availability.json
│   ├── tools/book_meeting.json
│   └── push.ts
├── drizzle/                          generated migrations
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                  gated voice console
│   │   ├── gate/page.tsx             passcode form + server action
│   │   ├── calls/page.tsx            call log, gated
│   │   ├── calls/[id]/page.tsx       transcript + tool timeline, gated
│   │   └── api/
│   │       ├── session/route.ts             connection 2
│   │       ├── tools/availability/route.ts  connection 3
│   │       ├── tools/book/route.ts          connection 3
│   │       └── webhooks/post-call/route.ts  connection 4
│   ├── components/
│   │   ├── voice-console.tsx
│   │   ├── transcript-pane.tsx
│   │   ├── email-fallback-field.tsx
│   │   └── call-detail.tsx
│   ├── middleware.ts                 gate enforcement for /, /calls
│   └── lib/
│       ├── env.ts                    Zod parsed process.env, server only
│       ├── schemas.ts                every Zod schema
│       ├── cal.ts
│       ├── verify-hmac.ts
│       ├── session-cookie.ts
│       ├── tool-log.ts
│       ├── ingest.ts
│       ├── slots.ts                  slot formatting + 60s cache
│       ├── voice/use-voice-session.ts        adapter seam
│       ├── voice/use-elevenlabs-session.ts   real SDK impl
│       ├── voice/use-mock-session.ts         scripted fake, test builds only
│       └── db/{schema.ts,client.ts}
├── docs/
│   ├── BLUEPRINT.md
│   ├── ARCHITECTURE.md
│   ├── CREDENTIALS.md
│   ├── CLAIMS.md
│   ├── TELEPHONY.md
│   └── DEPLOY_CHECKLIST.md
└── tests/
    ├── unit/{schemas,cal,verify-hmac,session-cookie,ingest,slots}.test.ts
    ├── fixtures/post-call.json
    └── e2e/{gate,voice-console,calls}.spec.ts
```

### 4.1 Tool contracts, connection 3

Both tools are registered on the agent with `POST`, `Content-Type: application/json`, and header `x-vd-tool-secret: {{TOOL_SHARED_SECRET}}` stored as an ElevenLabs workspace secret. Both receive `conversation_id` from `{{system__conversation_id}}` and `timezone` from `{{visitor_timezone}}`.

`check_availability` request:

```ts
{ conversation_id: string, timezone: string, start_date?: string, days?: number }
```

`check_availability` response:

```ts
| { ok: true,  timezone: string, slots: Array<{ start_utc: string, label: string }> }
| { ok: false, reason: 'upstream_timeout' | 'upstream_error' | 'no_slots', speak: string }
```

`book_meeting` request:

```ts
{ conversation_id: string, timezone: string, start_utc: string,
  name: string, email: string, notes?: string }
```

`book_meeting` response:

```ts
| { ok: true,  booking_uid: string, start_utc: string, label: string, speak: string }
| { ok: false, reason: 'invalid_email' | 'slot_taken' | 'upstream_timeout'
                     | 'upstream_error' | 'invalid_slot', speak: string }
```

Failure responses return HTTP 200 with `ok: false`. A non 2xx status makes the agent improvise; a structured body makes it read the line we wrote. `speak` is the exact sentence the agent says. `slots` is capped at 5 so the agent never reads a wall of times.

### 4.2 Module signatures

```ts
// src/lib/cal.ts
export function getSlots(a: { startISO: string; endISO: string; timeZone: string;
  eventTypeId: number; signal: AbortSignal }): Promise<CalSlot[]>
export function createBooking(a: { startUtcISO: string; eventTypeId: number;
  attendee: { name: string; email: string; timeZone: string }; notes?: string;
  signal: AbortSignal }): Promise<{ uid: string; startUtcISO: string }>

// src/lib/verify-hmac.ts
export function verifyElevenLabsSignature(a: { rawBody: string; header: string | null;
  secret: string; toleranceSeconds?: number }): { ok: true } | { ok: false; reason: string }
export function verifyToolSecret(header: string | null, expected: string): boolean

// src/lib/session-cookie.ts
export function signSession(exp: number): string
export function verifySession(value: string | undefined): boolean

// src/lib/tool-log.ts
export function withToolLogging<I, O>(name: 'check_availability' | 'book_meeting',
  handler: (input: I) => Promise<O>): (req: Request) => Promise<Response>

// src/lib/ingest.ts
export function ingestConversation(payload: PostCallPayload): Promise<{ conversationId: string }>

// src/lib/voice/use-voice-session.ts
export function useVoiceSession(opts: VoiceSessionOptions): VoiceSession
```

`withToolLogging` is the single choke point that enforces secret verification, Zod parse of input and output, the 3s budget, and the `tool_invocations` write. A tool route that bypasses it fails review.

---

## 5. DATA MODEL

Supabase Postgres, Drizzle managed, RLS enabled on all five tables with zero policies granting `anon` or `authenticated`. All access is server side over `DATABASE_URL`.

```
conversations
  id uuid pk default gen_random_uuid()
  el_conversation_id text NOT NULL UNIQUE     <- natural key, everything joins on this
  status text NOT NULL default 'in_progress'  <- in_progress | completed | failed
  started_at timestamptz
  ended_at timestamptz
  duration_seconds int
  transcript jsonb
  summary text
  created_at timestamptz NOT NULL default now()

lead_captures
  id uuid pk · conversation_id uuid NOT NULL references conversations(id) UNIQUE
  name text · email text · company text
  project_type text · timeline text · budget_band text
  extracted_at timestamptz NOT NULL default now()

tool_invocations
  id uuid pk · conversation_id uuid NOT NULL references conversations(id)
  tool_name text NOT NULL · request_payload jsonb NOT NULL · response_payload jsonb NOT NULL
  latency_ms int NOT NULL · status_code int NOT NULL
  invoked_at timestamptz NOT NULL default now()

bookings
  id uuid pk · conversation_id uuid NOT NULL references conversations(id)
  cal_booking_uid text NOT NULL UNIQUE · slot_start timestamptz NOT NULL
  attendee_email text NOT NULL · status text NOT NULL

demo_sessions
  id uuid pk · session_hash text NOT NULL · created_at timestamptz NOT NULL default now()
  index on (created_at)
```

### 5.1 Write ordering, the load bearing decision

Tool calls land mid call. The post call webhook lands after. The conversation row therefore cannot be created by the webhook.

`el_conversation_id` is the natural key and any route that sees it creates the row:

```sql
-- every tool invocation, before the child write
INSERT INTO conversations (el_conversation_id, status)
VALUES ($1, 'in_progress')
ON CONFLICT (el_conversation_id) DO NOTHING;

-- post call webhook, later
INSERT INTO conversations (el_conversation_id, status, transcript, summary,
                           started_at, ended_at, duration_seconds)
VALUES (...)
ON CONFLICT (el_conversation_id) DO UPDATE
SET status = 'completed', transcript = EXCLUDED.transcript, summary = EXCLUDED.summary,
    started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at,
    duration_seconds = EXCLUDED.duration_seconds;
```

Consequences that are features, not accidents: ingest is idempotent so ElevenLabs webhook retries are safe, a call whose webhook never arrives still shows its tool timeline with `status = 'in_progress'`, and no client supplied identifier is ever trusted. `lead_captures` upserts on `conversation_id`.

---

## 6. APPROACH AND DECISIONS

Each decision is copied to `.claude/decisions/` as its own entry with the alternative and the reason, so it is defensible from memory.

### 6.1 Session auth and quota defense

`POST /api/session` is the only path to voice minutes and is defended in three layers:

1. `src/app/gate/page.tsx` runs a server action that compares the submitted passcode to `DEMO_PASSCODE` with `timingSafeEqual`, then sets `vd_session=<expUnix>.<hmacSha256(exp, SESSION_SECRET)>`, `httpOnly; secure; sameSite=lax; maxAge=2h`.
2. `src/middleware.ts` redirects `/` and `/calls*` to `/gate?next=` when the cookie is absent or invalid.
3. `POST /api/session` re-verifies the cookie server side (401), then inserts into `demo_sessions` and counts rows from the last 24h, returning 429 past `DAILY_SESSION_CAP` (default 6). The counter is in Postgres because a serverless in memory counter does not survive a cold start.

Only then does it call `GET https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=$ELEVENLABS_AGENT_ID` with `xi-api-key` and return `{ conversationToken }`. The API key never leaves the server.

Alternative rejected: cookie gate with no counter. One person with the passcode and ten tabs drains the month.

### 6.2 Tool latency policy

Every tool route answers within 3s. The Cal.com fetch carries `AbortSignal.timeout(2500)`. On abort the route returns `{ ok: false, reason: 'upstream_timeout', speak: '...' }` with HTTP 200 and still writes `tool_invocations` with the real `latency_ms` and `status_code`. Availability is cached 60s in module scope keyed by `${date}|${timezone}`, which absorbs the common case of the agent re-checking within one conversation.

Alternative rejected: rely on the platform tool timeout. The failure would be invisible in our own dashboard, which is the artifact a prospect inspects.

### 6.3 Email capture

Voice first. The prompt instructs the agent to spell the address back before booking. `book_meeting` Zod-validates the email; on rejection it returns `reason: 'invalid_email'` with a `speak` line asking the visitor to type it. The console reveals `email-fallback-field.tsx`, whose value is pushed into the live session via `sendContextualUpdate`, and the agent retries. Voice only path in the happy case, honest degradation when STT mangles an address, and a concrete answer when a client asks how STT error is handled.

Alternative rejected: a contact form before the call. It makes the agent look like it needs a form to function.

### 6.4 Timezone

The console reads `Intl.DateTimeFormat().resolvedOptions().timeZone` and passes it as `dynamicVariables: { visitor_timezone }` on `startSession`. Both tools receive it as `{{visitor_timezone}}`. Routes validate against `Intl.supportedValuesOf('timeZone')` and fall back to `DEFAULT_TIMEZONE`. Slots are labelled in the visitor's zone; `start_utc` is always UTC on the wire and Cal.com is written in UTC.

Alternative rejected: the agent asks out loud. It burns a conversational turn and adds another STT error surface.

### 6.5 Lead extraction

The six lead fields are declared as `analysis.data_collection` items inside `agent/agent.config.json` and pushed via API. ElevenLabs runs extraction at call end and delivers `analysis.data_collection_results` in the post call payload. `ingestConversation` Zod-parses it, unset fields become null. Zero extra provider, zero extra cost, and it is direct evidence for the config as code claim.

Alternative rejected: our own post call LLM pass. It adds a paid provider to a build whose binding constraint is zero cash.

### 6.6 Post call ingest

```
raw = await req.text()                          <- raw body, never req.json() first
verifyElevenLabsSignature({ rawBody: raw, header: req.headers.get('elevenlabs-signature'),
                            secret: ELEVENLABS_WEBHOOK_SECRET })
  fail -> 401, nothing touches the database
PostCallPayloadSchema.parse(JSON.parse(raw))    -> 400 on shape mismatch
ingestConversation(payload)                     -> 200 { ok: true }
```

Header format is `ElevenLabs-Signature: t=<unix>,v0=<hex>`. The signed string is `` `${t}.${rawBody}` ``, HMAC-SHA256, hex digest, secret used raw, compared with `timingSafeEqual`, timestamp tolerance 1800s. Multiple `v0=` values may be present and any match accepts.

`ingestConversation` is a pure function of the parsed payload with no HTTP concerns. If V1 finds that post call webhooks are gated on a free workspace, the fallback is `src/app/api/cron/poll/route.ts` calling the same function against the conversations list API. That is an addition, not a rewrite.

Alternative rejected: a bearer token on the webhook. HMAC binds the signature to the body, so a captured header cannot be replayed against a modified payload, and the timestamp bounds replay of the original.

### 6.7 Voice adapter seam

All SDK usage sits behind `useVoiceSession`. Under `NEXT_PUBLIC_VOICE_MOCK=1`, set only in the Playwright build command, it resolves to a scripted fake that emits connecting, listening, agent speaking, transcript messages, and a simulated tool call on timers. Playwright then covers gate to console states to transcript render to `/calls` with zero ElevenLabs traffic and zero voice minutes. The seam is also why the console is unit testable.

The mock flag gates behaviour only. No secret is ever exposed through a `NEXT_PUBLIC_` variable.

### 6.8 Agent config as code

`pnpm agent:push` syncs the system prompt, the knowledge base document, both tool definitions, and agent settings including data collection. Entities are resolved by name, so re-running is idempotent, and resolved remote ids are written to `agent/ids.json` and committed. `pnpm agent:push --dry` prints the diff between local config and remote state and exits without writing.

`livekit-client` is pinned to `2.16.1` in `package.json` per V5. Newer versions have failed the WebRTC handshake with `/rtc/v1` 404s.

### 6.9 Deviations from the blueprint, stated for the record

1. **`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are dropped.** Every read and write is server side through Drizzle over `DATABASE_URL`. Shipping an anon key that nothing consumes is a public surface with no purpose. RLS stays enabled with no permissive policies, so even a leaked anon key reads nothing.
2. **Five env vars added:** `DATABASE_URL` and `DIRECT_URL` (Drizzle needs connection strings, not a Supabase key), `SESSION_SECRET` (cookie HMAC), `DAILY_SESSION_CAP`, `DEFAULT_TIMEZONE`. Two Postgres URLs because Supabase's transaction pooler on 6543 is the correct runtime target for serverless but does not support prepared statements or DDL, so `src/lib/db/client.ts` uses it with `postgres(url, { prepare: false })` while `drizzle.config.ts` points migrations at the session pooler on 5432.
3. **One table added:** `demo_sessions`, required by the §6.1 counter.
4. **Three files added to the tree:** `src/middleware.ts`, `src/lib/tool-log.ts`, `src/lib/env.ts`, plus the `src/lib/voice/` seam and `scripts/check-copy.sh`.

---

## 7. CREDENTIALS PROTOCOL

No accounts exist yet. Nothing is assumed to be provisioned.

**Handover rule, non negotiable.** A secret value is never typed into the conversation and never appears in a tool result. At each blocking point the session prints the capture guide and the exact variable name, then stops. The user writes the value themselves. The session then verifies presence and shape only, printing a masked form such as `sk_...9f2c ok (51 chars)`.

```
me:  ELEVENLABS_API_KEY is needed now. <numbered capture guide>
     ! read -s K && echo "ELEVENLABS_API_KEY=$K" >> .env.local
you: done
me:  ELEVENLABS_API_KEY  sk_...9f2c  ok (51 chars)
```

`docs/CREDENTIALS.md` holds a numbered capture guide for all nine secrets, written during Phase 0 and kept current. Order of first need:

| Phase | Variable | Source |
|---|---|---|
| 0 | `ELEVENLABS_API_KEY` | elevenlabs.io, free signup, avatar menu, API Keys |
| 0 | `ELEVENLABS_AGENT_ID` | created by the first `agent:push`, or the agent page URL |
| 1 | `CAL_API_KEY` | cal.com, Settings, Developer, API keys, v2 |
| 1 | `CAL_EVENT_TYPE_ID` | numeric id in the event type edit URL |
| 1 | `DATABASE_URL` | Supabase, new project, Connect, **transaction** pooler, port 6543 |
| 1 | `DIRECT_URL` | same Connect panel, **session** pooler, port 5432, used by drizzle-kit only |
| 1 | `TOOL_SHARED_SECRET` | generated locally, `openssl rand -hex 32` |
| 1 | `SESSION_SECRET` | generated locally, `openssl rand -hex 32` |
| 1 | `DEMO_PASSCODE` | chosen by the user |
| 3 | `ELEVENLABS_WEBHOOK_SECRET` | shown once when the post call webhook is created |

`.env.local` is in `.gitignore` before the first commit, verified not after. `.env.example` lists every name with empty values. `src/lib/env.ts` Zod-parses `process.env` at import and throws on a missing or malformed variable, so a misconfiguration fails at boot rather than mid call.

---

## 8. BUILD PHASES

One phase per session. Each ends at a gate. Do not proceed past a failed gate and do not build across a boundary.

### Phase 0 · Bring up and verification sweep · 0 minutes

**Repo bootstrap is already complete.** `git init`, `core.hooksPath`, `.gitignore`, `.githooks/commit-msg`, `LICENSE`, `README.md`, `.env.example`, `docs/BLUEPRINT.md`, and the public remote at `github.com/sheharyarr-ahmed/voxdesk` all exist as of commit `4bb160b`. Do not redo them.

Create the ElevenLabs account and agent. Write `agent/prompts/system.md` covering the qualification flow, tool sequencing, prompt injection defense using delimited user input, and refusal rules for anything outside the KB. Write `agent/knowledge/sherylabs.md` from defensible claims only, over 500 bytes so RAG indexes it. Run the §9 sweep and record all seven results in `.claude/decisions/`. Write `docs/CREDENTIALS.md`.

**Gate:** a text console conversation answers three service questions correctly from the KB, and all seven §9 checks are recorded as pass or as fallback taken.

### Phase 1 · Routes, Cal.com, persistence · 0 minutes

Scaffold Next.js. Build `src/lib/{env,schemas,cal,verify-hmac,session-cookie,tool-log,slots}.ts`, the Drizzle schema and migrations, `/api/session`, `/api/tools/availability`, `/api/tools/book`, and the gate. Vitest across schemas, Cal.com client, HMAC verification, cookie signing, and slot formatting. Install `.claude/verify.sh` and `chmod +x`. Create the Vercel project and deploy, so tool URLs point at a stable production domain from the start.

**Gate:** the §11.2 curl creates a real Cal.com booking. `pnpm test` green. `.claude/verify.sh` blocks on a deliberately broken test.

### Phase 2 · Wire the agent, first voice · 4 minutes

`pnpm agent:push --dry`, then `pnpm agent:push`. Tune the qualification flow in the text console until the tool sequence is correct. Then one scripted voice run.

**Gate:** a spoken conversation books a real slot end to end in under three minutes.

### Phase 3 · Observability · 3 minutes

Build `src/lib/ingest.ts`, `/api/webhooks/post-call`, `/calls`, and `/calls/[id]` with transcript beside the tool timeline and latencies. Unit test ingest against `tests/fixtures/post-call.json`.

**Gate:** §11.3 passes. A completed call renders with transcript, both tool calls with latencies, and extracted lead fields. An unsigned POST returns 401.

### Phase 4 · Frontend, docs, ship · 5 minutes

`voice-console.tsx` on the brand system: true black, mint accent used once, Space Grotesk display with tight tracking, Space Mono labels. Mic permission, connecting, listening, agent speaking, and error states. Live transcript pane. Email fallback field. Playwright specs against the mock seam. `scripts/check-copy.sh`. README, `ARCHITECTURE.md`, `CLAIMS.md`, `TELEPHONY.md`, `DEPLOY_CHECKLIST.md`. Deploy. Then script and record the 60 to 90 second demo video.

**Gate:** `pnpm verify:all` green, deployed, video recorded, every README claim traced line by line to `docs/CLAIMS.md`.

### Phase 5 · Distribution · 0 minutes

Upwork portfolio entry, LinkedIn Featured tile and Projects entry, company post and founder reshare, GitHub topics and social preview.

**Minute ledger:** Phases 0 and 1 spend zero. Run 0 through 2 in the current billing cycle at about 4 minutes, let the quota reset, then run 3 and 4 on a fresh 15 so the video has room for retakes. This is a scheduling constraint, not an optimization. 3 minutes stay in reserve for live vetting demos.

---

## 9. VERIFICATION SWEEP, PHASE 0, BLOCKING

Run all seven before any application code. Record each in `.claude/decisions/`.

| # | Check | Fallback |
|---|---|---|
| V1 | Post call webhooks configurable on a free workspace | Add `api/cron/poll/route.ts` calling `ingestConversation`. Ingest becomes pull, not push. Disclose in CLAIMS.md. |
| V2 | Webhook tools available on free tier | Client tools in the browser that call our routes. Weaker architecture, still shippable, must be disclosed. |
| V3 | Does text only mode consume voice minutes | If not, all prompt iteration moves to text. If it does, Phase 2 is cut to a single run. |
| V4 | Cal.com v2 key issues and booking creation permitted | Read only availability plus a booking link the agent reads aloud. Weaker demo, avoid. |
| V5 | WebRTC connects from the browser | `livekit-client` pinned to 2.16.1, or `connectionType: 'websocket'`. |
| V6 | Tool round trip under 3s with Cal.com latency included | §6.2 cache and structured timeout already absorb this. If Cal.com alone exceeds 2.5s, widen the cache window. |
| V7 | KB document indexes with RAG, needs over 500 bytes | Pad with genuine service detail. Do not fabricate to hit a byte count. |

---

## 10. OUT OF SCOPE

Explicitly not built, not stubbed, not partially wired.

- **Telephony.** No Twilio, no PSTN, no phone number. Documented in `docs/TELEPHONY.md` as a path, not a claim.
- **Custom LLM bridge.** ElevenLabs hosted LLM only. The OpenAI compatible proxy pattern is described in `docs/ARCHITECTURE.md`.
- **Outbound calling, multi language, CRM push.** `lead_captures` is the shape a CRM sync would read from. Nothing is wired.
- **Authentication beyond the passcode.** No user accounts, no roles, no Supabase Auth.
- **The embed widget.** Custom SDK integration only.
- **Any paid tier.** No card on file, no recurring cost. The free tier carries no commercial license, so this is a portfolio artifact and says so.
- **Public unauthenticated voice.** The quota is the reason.
- **Rate limiting beyond `demo_sessions`.** No WAF, no bot detection, no per IP throttle.
- **Real time streaming of tool events to the dashboard.** `/calls` is request time rendered.
- **Editing or deleting call records from the UI.** Read only dashboard.

Enforced at every commit, a violation does not ship: no ElevenLabs key in client code or any `NEXT_PUBLIC_` variable; no unverified webhook payload reaching the database; no agent configuration living only in the dashboard; no unvalidated boundary; no ungated voice session; no AI attribution strings in code, comments, commit messages, or meta tags; no README claim absent from `docs/CLAIMS.md`; no em-dashes in any copy, docs, or UI text.

---

## 11. VERIFICATION

### 11.1 The single command

```bash
pnpm verify:all
```

which is `typecheck && vitest run && check-copy && playwright test`, where `check-copy` is `scripts/check-copy.sh`, failing on any em-dash or any of `Claude`, `Anthropic`, `Co-Authored-By`, `Generated with` across `README.md docs/ src/ agent/`. `.claude/verify.sh` runs `typecheck` and `vitest run` only, so the Stop hook stays fast; Playwright runs at the Phase 4 gate.

### 11.2 Phase 1 gate, a real booking with no voice

```bash
curl -sS -X POST "$BASE/api/tools/availability" \
  -H 'content-type: application/json' -H "x-vd-tool-secret: $TOOL_SHARED_SECRET" \
  -d '{"conversation_id":"curl_test_1","timezone":"Asia/Karachi","days":3}' | jq

curl -sS -X POST "$BASE/api/tools/book" \
  -H 'content-type: application/json' -H "x-vd-tool-secret: $TOOL_SHARED_SECRET" \
  -d '{"conversation_id":"curl_test_1","timezone":"Asia/Karachi",
       "start_utc":"<start_utc from the call above>",
       "name":"Curl Test","email":"you+voxdesk@example.com"}' | jq
```

Passes when the second call returns `ok: true` with a `booking_uid`, the booking is visible in the Cal.com dashboard, and `tool_invocations` holds two rows for `curl_test_1` with non zero `latency_ms`. A request with a wrong or missing `x-vd-tool-secret` returns 401.

### 11.3 Phase 3 gate, signature enforcement

```bash
# unsigned, must be 401 and must write nothing
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/webhooks/post-call" \
  -H 'content-type: application/json' -d @tests/fixtures/post-call.json

# correctly signed, must be 200
BODY=$(cat tests/fixtures/post-call.json); T=$(date +%s)
SIG=$(printf '%s.%s' "$T" "$BODY" | openssl dgst -sha256 -hmac "$ELEVENLABS_WEBHOOK_SECRET" -r | cut -d' ' -f1)
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/webhooks/post-call" \
  -H 'content-type: application/json' -H "ElevenLabs-Signature: t=$T,v0=$SIG" -d "$BODY"
```

Passes when the first prints `401` with no new database row and the second prints `200` twice in a row with exactly one `conversations` row, proving idempotency.

### 11.4 End to end, the definition of done

One spoken call, on the deployed URL, behind the passcode, completing in under three minutes:

1. `/` redirects to `/gate` without a cookie. Correct passcode admits, wrong passcode does not.
2. The agent answers a service question from the KB.
3. The agent calls `check_availability`, reads back slots in the browser's timezone, then calls `book_meeting`.
4. The booking exists on the real Cal.com calendar.
5. Within a minute of hangup, `/calls` shows the conversation, and `/calls/[id]` shows the transcript beside both tool invocations with their latencies and the extracted lead fields.
6. `pnpm verify:all` is green.
7. `git log --format=%B | grep -Ei 'claude|anthropic|co-authored|generated with'` returns nothing.

---

## 12. CLAIMS BOUNDARY

`docs/CLAIMS.md` is authoritative and every README line, portfolio entry, and proposal is checked against it.

**Claimable:** deployed a voice agent on the ElevenLabs Agents platform; server side tool integration taking real actions mid call including live calendar booking; HMAC verified post call ingestion with signature validation before persistence; a RAG knowledge base so answers come from a controlled document rather than model priors; a custom React SDK frontend rather than the embed widget; full call observability with per tool payloads, latencies, and extracted lead fields; the entire agent configuration held as versioned code and pushed via API.

**Not claimable under any framing:** building the speech pipeline, since ElevenLabs owns STT, the LLM, turn taking, and TTS; commercial or client deployment, since the free tier carries no commercial license; telephony or phone support; any usage metric, call volume, or conversion number; production scale, since this is production grade architecture scoped to demo scale and the minute cap is the honest reason.

**Attribution obligation.** The ElevenLabs free plan grants no commercial rights and requires attribution wherever its output is published. The demo video carries a visible "Voice by ElevenLabs" credit, and the README states the same in the stack section. This is a licence term, not a stylistic choice, and it is checked at the Phase 4 gate alongside the CLAIMS.md pass.

---

**END OF SPEC**
