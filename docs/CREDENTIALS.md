# Credentials

Capture guide for every secret VoxDesk needs. Written in Phase 0 and kept current as each one is captured.

`.env.example` lists every name with empty values and is the only tracked env file. `.env.local` holds the real values and is gitignored. `src/lib/env.ts` Zod parses `process.env` at import from Phase 1 onward, so a missing or malformed variable fails at boot rather than mid call.

## The handover rule, non negotiable

Per SPEC.md §7, a secret value is never typed into an agent session and never appears in a tool result. At each blocking point the session prints the capture guide and the variable name, then stops. You write the value yourself. The session then verifies presence and shape only, and prints a masked form.

```
me:  ELEVENLABS_API_KEY is needed now. <capture guide>
     ! read -s K && echo "ELEVENLABS_API_KEY=$K" >> .env.local
you: done
me:  ELEVENLABS_API_KEY  sk_...9f2c  ok (51 chars)
```

Appending to `.env.local` when an empty placeholder line for the same name already exists leaves two assignments. `set -a && . ./.env.local` takes the last one, so a trailing empty line silently blanks the value. Delete the placeholder first:

```bash
sed -i '' '/^VARIABLE_NAME=$/d' .env.local
```

## Count

SPEC.md §7 says "all nine secrets" while its own table lists ten rows. This document covers all ten, plus the two tunables that are not secrets. The discrepancy is recorded here rather than silently resolved in one direction.

## Order of first need

| Phase | Variable | Secret | Status |
|---|---|---|---|
| 0 | `ELEVENLABS_API_KEY` | yes | captured |
| 0 | `ELEVENLABS_AGENT_ID` | no, an identifier | captured |
| 0 | `CAL_API_KEY` | yes | captured, not yet exercised, see below |
| 0 | `CAL_EVENT_TYPE_ID` | no, an identifier | captured |
| 1 | `DATABASE_URL` | yes | captured, connection verified |
| 1 | `DIRECT_URL` | yes | captured, connection verified |
| 1 | `TOOL_SHARED_SECRET` | yes | captured, generated locally |
| 1 | `SESSION_SECRET` | yes | captured, generated locally |
| 1 | `DEMO_PASSCODE` | yes | captured |
| 3 | `ELEVENLABS_WEBHOOK_SECRET` | yes | pending, needs a deployed URL first |
| any | `DAILY_SESSION_CAP` | no, a tunable | default 6 |
| any | `DEFAULT_TIMEZONE` | no, a tunable | default Asia/Karachi |

SPEC.md §7 places `CAL_API_KEY` and `CAL_EVENT_TYPE_ID` at Phase 1. They are listed at Phase 0 here because V4 and V6 are blocking Phase 0 checks that cannot run without them. This table is the corrected order of first need.

---

## 1 · `ELEVENLABS_API_KEY`

Server only. Mints conversation tokens at `POST /api/session`, connection 2 of SPEC.md §2. Never reaches the client and never appears in a `NEXT_PUBLIC_` variable.

1. Sign in at elevenlabs.io.
2. Avatar menu, bottom left, then API Keys. Direct path: `elevenlabs.io/app/settings/api-keys`.
3. Create a new key.
4. **Keys are restricted by default.** Grant these scopes or calls fail with `401 missing_permissions` rather than a tier error:
   - **Agents**, read and write. Without it the token mint fails.
   - **Webhooks**. The dashboard exposes this as one toggle with two states, access or no access, rather than separate read and write. Set it to access. Without it `POST /v1/workspace/webhooks` returns `401 missing_permissions: webhooks_write`, while `GET` on the same path still returns 200, so the gap is easy to miss until a write fails. Needed for V1 and again in Phase 3.
5. Copy the value once. It is not shown again.

```bash
sed -i '' '/^ELEVENLABS_API_KEY=$/d' .env.local
read -s K && echo "ELEVENLABS_API_KEY=$K" >> .env.local
```

Shape: begins `sk_`, 51 characters.

Verify:
```bash
curl -sS -H "xi-api-key: $ELEVENLABS_API_KEY" https://api.elevenlabs.io/v1/user/subscription | jq .tier
```

## 2 · `ELEVENLABS_AGENT_ID`

Not a secret, but environment specific. Identifies the agent the token is minted against.

Either created by the first `pnpm agent:push` in Phase 2, or read from the agent page URL at `elevenlabs.io/app/agents/<this>`.

Shape: begins `agent_`, 34 characters.

## 3 · `CAL_API_KEY`

Server only. Reads availability and creates real bookings, the SPEC.md §4.1 tool contracts.

1. Sign in at app.cal.com. The free plan is sufficient.
2. Settings, Developer, API keys.
3. Add a key. Set expiry to **Never Expires**, otherwise the demo breaks silently on the expiry date.
4. Copy the value once.

```bash
sed -i '' '/^CAL_API_KEY=$/d' .env.local
read -s K && echo "CAL_API_KEY=$K" >> .env.local
```

Shape: begins `cal_`.

**This key has not been exercised yet, and V4 passed without it.** `GET /v2/slots` and `POST /v2/bookings` are public for a public event type, so a real booking was created and cancelled with no `Authorization` header at all. `src/lib/cal.ts` should still send the key: relying on an endpoint staying public is relying on a policy that can tighten without notice, and the Phase 3 dashboard read path will need authenticated access regardless.

Two operational notes from V4, both of which cost debugging time if unknown:

- **The `cal-api-version` header is mandatory.** Without it the request returns `404 NotFoundException: Cannot GET /v2/slots`, which reads like a wrong URL rather than a missing header. Slots use `2024-09-04`; bookings and cancel use `2024-08-13`.
- **curl cannot reach Cal.com from this machine.** Cloudflare scores the client fingerprint, so curl is challenged on every host and path while Chrome from the same IP passes. This is a local development constraint only. Unit tests mock `fetch`, and live checks run against the deployed URL.

## 4 · `CAL_EVENT_TYPE_ID`

Not a secret. The numeric id of the event type the agent books into.

1. app.cal.com, Event Types.
2. Create the discovery call event type if it does not exist. Keep the duration short, 15 or 30 minutes, so a test booking is cheap to cancel.
3. Open it for editing. The id is the number in the URL: `app.cal.com/event-types/<THIS>`.

```bash
sed -i '' '/^CAL_EVENT_TYPE_ID=$/d' .env.local
read -p "event type id: " E && echo "CAL_EVENT_TYPE_ID=$E" >> .env.local
```

Shape: digits only.

## 5 · `DATABASE_URL`

Server only. Runtime connection, used by `src/lib/db/client.ts` with `postgres(url, { prepare: false })`.

1. supabase.com, new project, named `voxdesk`. Free tier. Set a database password and save it to a password manager immediately, since it is embedded in both connection strings and is not shown again.
2. Connect button, top of the project page.
3. Take the **Transaction pooler** string, **port 6543**.
4. Substitute the real password for the placeholder in the string.

**The one mistake that costs an hour.** Supabase prints the string as `...:[YOUR-PASSWORD]@...`. Replace the **brackets too**, not just the text between them. Leaving them produces a password of `[realpassword]`, which fails with `28P01 password authentication failed` and looks exactly like a wrong password rather than a formatting error. This happened during setup. Percent-encoding the brackets does not help, since it faithfully preserves a character that was never meant to be there.

Related: if the password itself contains any of `@ : / ? # [ ]` it must be percent-encoded, because those are reserved in a URI. Simplest to avoid the problem entirely by resetting the password to letters and digits under Settings, Database, Reset database password.

**Verify by connecting, not by reading.** Shape checks pass on a string that does not authenticate. The bracket bug survived three separate visual inspections and was caught only by an actual query.

Not the anon key and not the service role key. Per SPEC.md §6.9 deviation 1, VoxDesk ships no Supabase keys at all. Every read and write is server side over a connection string, and RLS stays enabled with no permissive policies.

Project setup decisions, made once at creation:

- **Region matches the Vercel function region**, not the developer's location. Vercel Hobby usually lands in Washington DC, `iad1`, so East US, North Virginia. The tool routes write `tool_invocations` inside the SPEC.md §6.2 3s budget, and a cross continent hop spends that budget for nothing. No query ever originates from a developer machine.
- **Exposed schemas is emptied**, under Settings then API. That disables PostgREST entirely. Nothing here uses it, and an unused public surface is a liability with no upside. It is the logical completion of SPEC.md §6.9 deviation 1.
- **No Auth provider is enabled.** SPEC.md §10 rules out Supabase Auth. The passcode gate is the only auth in this build.
- **RLS is not automatic.** Drizzle creates tables without it, so migrations must carry `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;` for all five tables, with zero policies. No policy means no access for `anon` or `authenticated`, while the server still reaches the data as the owner over `DATABASE_URL`.

**Operational trap: free projects pause after 7 days of inactivity.** A paused database fails the demo mid call, and a cold restore takes a minute or two. Wake it deliberately before any scheduled vetting call. This pairs with the 10 day RAG index retention recorded in the V7 decision record, so treat warming the demo as one pre call step covering both. Belongs in `docs/DEPLOY_CHECKLIST.md` at Phase 4.

Shape: `postgresql://postgres.<ref>:<password>@<host>:6543/postgres`.

## 6 · `DIRECT_URL`

Server only, migrations only. `drizzle.config.ts` points here because the transaction pooler on 6543 does not support prepared statements or DDL.

Same Supabase Connect panel, **Session pooler**, **port 5432**.

Shape: `postgresql://postgres.<ref>:<password>@<host>:5432/postgres`.

## 7 · `TOOL_SHARED_SECRET`

Server only. The `x-vd-tool-secret` header ElevenLabs sends to both tool routes so they are not open endpoints. Generated locally, so there is no dashboard to visit.

```bash
sed -i '' '/^TOOL_SHARED_SECRET=$/d' .env.local
echo "TOOL_SHARED_SECRET=$(openssl rand -hex 32)" >> .env.local
```

The same value is stored as an ElevenLabs workspace secret and referenced from both tool definitions as `{{TOOL_SHARED_SECRET}}`. V2 confirmed the API accepts a shared secret in `api_schema.request_headers`.

Shape: 64 hex characters.

## 8 · `SESSION_SECRET`

Server only. HMAC key for the passcode session cookie, SPEC.md §6.1.

```bash
sed -i '' '/^SESSION_SECRET=$/d' .env.local
echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env.local
```

Shape: 64 hex characters. Rotating it invalidates every live session, which is the intended emergency lever.

## 9 · `DEMO_PASSCODE`

Server only. Compared with `timingSafeEqual` in the `/gate` server action. Chosen by you, spoken on a vetting call, never committed.

```bash
sed -i '' '/^DEMO_PASSCODE=$/d' .env.local
read -s K && echo "DEMO_PASSCODE=$K" >> .env.local
```

Make it pronounceable. You will be reading it to someone over a call.

## 10 · `ELEVENLABS_WEBHOOK_SECRET`

Server only. Verifies the HMAC on the post call webhook before anything touches the database, SPEC.md §6.6.

Captured in Phase 3, once a stable production URL exists, because the webhook needs a real destination.

Two paths. Both were exercised against the free workspace during V1.

**Dashboard.** elevenlabs.io/app/agents/settings, create the post call webhook pointing at `https://<production-domain>/api/webhooks/post-call`. The secret is shown once at creation. Copy it immediately.

**API.** The create response returns the secret directly:

```bash
curl -sS -X POST https://api.elevenlabs.io/v1/workspace/webhooks \
  -H "xi-api-key: $ELEVENLABS_API_KEY" -H 'content-type: application/json' \
  -d '{"settings":{"name":"voxdesk-post-call",
       "webhook_url":"https://<production-domain>/api/webhooks/post-call",
       "auth_type":"hmac"}}' \
| python3 -c 'import sys,json;print("ELEVENLABS_WEBHOOK_SECRET="+json.load(sys.stdin)["webhook_secret"])' \
>> .env.local
```

The three fields nest under `settings`, not at the top level. Getting that wrong returns 422, not 401.

**Run that command yourself.** Piping straight into `.env.local` is deliberate: the value never reaches a terminal, a scrollback buffer, or an agent session transcript. If an agent runs it, the secret lands in a tool result, and the handover rule at the top of this document exists precisely to prevent that. Any masking applied to a response body must key on the exact field name, which here is `webhook_secret` and not `secret`.

Shape: `wsec_` followed by 64 hex characters, 69 total.

Then point the workspace at it, which is a separate step. Creating the webhook leaves `webhooks.post_call_webhook_id` null and no deliveries fire until it is set:

```bash
curl -sS -X PATCH https://api.elevenlabs.io/v1/convai/settings \
  -H "xi-api-key: $ELEVENLABS_API_KEY" -H 'content-type: application/json' \
  -d '{"webhooks":{"post_call_webhook_id":"<webhook_id from the create response>"}}'
```

Defaults observed on this workspace, which suit VoxDesk without change: `events: ["transcript"]`, `transcript_format: "json"`, `send_audio: false`. Audio stays off. There is no use for stored voice recordings here and it keeps the payload small.

Also add the secret to the Vercel project environment, or the deployed route rejects every delivery.

Header format is `ElevenLabs-Signature: t=<unix>,v0=<hex>`. The signed string is `${t}.${rawBody}`, HMAC-SHA256, hex digest, secret used raw, compared with `timingSafeEqual`, timestamp tolerance 1800s. Multiple `v0=` values may appear and any match accepts.

## 11 · `DAILY_SESSION_CAP`

Not a secret. Voice sessions permitted per 24 hours before `POST /api/session` returns 429, counted in the `demo_sessions` table. Default `6`. The counter lives in Postgres because a serverless in memory counter does not survive a cold start.

## 12 · `DEFAULT_TIMEZONE`

Not a secret. Used only when a browser reports a timezone that fails validation against `Intl.supportedValuesOf('timeZone')`. Default `Asia/Karachi`.

---

## Deployment

Every server variable above is set again in the Vercel project environment. `.env.local` covers local development only. `DIRECT_URL` is needed in CI or locally for migrations but not by the running application.

## If a secret leaks

1. Rotate at the source first, then update `.env.local` and Vercel.
2. `ELEVENLABS_API_KEY`: revoke the key in the dashboard. Voice minutes are the exposure.
3. `TOOL_SHARED_SECRET`: regenerate, update the ElevenLabs workspace secret, redeploy. Until all three agree, tool calls return 401 and the agent reads its failure line, which degrades honestly rather than breaking.
4. `DEMO_PASSCODE` or `SESSION_SECRET`: rotating `SESSION_SECRET` invalidates every live session immediately and is the faster lever.
5. Database URLs: rotate the database password in Supabase, which changes both strings at once.
