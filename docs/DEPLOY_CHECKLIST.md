# DEPLOY CHECKLIST

Run top to bottom. Three of these have already caused a failure that was green in every
local check, and they are marked.

---

## 1. Before anything, wake the two things that go to sleep

| Service | Behaviour | Check |
|---|---|---|
| **Supabase** | Pauses after 7 days idle. A paused project fails the connection rather than answering slowly | Open `/calls` on the deployment, or run any SELECT. If it is paused, resume it from the dashboard and wait for it to come up |
| **ElevenLabs RAG index** | **Retention is 10 days on this workspace.** An expired index does not error. The agent answers from model priors and sounds exactly the same | The command below. **Do this before any demo or recording** |

```bash
curl -sS -H "xi-api-key: $ELEVENLABS_API_KEY" \
  "https://api.elevenlabs.io/v1/convai/knowledge-base/CgTt6RU8cZj1519ZGoUU/rag-index"
```

Wants `"status": "succeeded"`. If the index is gone, re-index and wait for `succeeded`
before dialling:

```bash
curl -sS -X POST -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"model":"e5_mistral_7b_instruct"}' \
  "https://api.elevenlabs.io/v1/convai/knowledge-base/CgTt6RU8cZj1519ZGoUU/rag-index"
```

**This is the check that silently voids the central claim if it is skipped.** A missing
index does not break the demo, it makes the demo prove nothing. The Phase 0 standard was
that the document exists, and it was not enough.

Retrieval can also be exercised directly. This is the cheapest possible confidence check
before a recording, and it is the one that distinguishes a live index from an expired one,
because an expired index does not error and the agent still answers. **Measured at zero
credits on 2026-08-06**, 1188 remaining before and after, and it creates no conversation:

```bash
curl -sS -X POST -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -H 'content-type: application/json' -d '{"query":"what does SheryLabs do"}' \
  "https://api.elevenlabs.io/v1/convai/agents/agent_1401kz0x1h1xfsk8x4vh5hxpjezg/knowledge-base/rag-query"
```

---

## 2. Environment, 12 variables, all required

Set in Vercel for **production**. `src/lib/env.ts` parses at import and throws on a
missing or malformed value, so a misconfiguration fails at boot rather than mid call.

| Variable | Source | Trap |
|---|---|---|
| `ELEVENLABS_API_KEY` | elevenlabs.io, avatar menu, API Keys | Needs Agents scope |
| `ELEVENLABS_AGENT_ID` | `agent/ids.json` | Must start with `agent_` |
| `CAL_API_KEY` | cal.com, Settings, Developer, API keys, v2 | |
| `CAL_EVENT_TYPE_ID` | numeric id in the event type edit URL | Digits only |
| `DATABASE_URL` | Supabase Connect, **transaction** pooler | **Port must be 6543.** Replace the `[YOUR-PASSWORD]` placeholder; `env.ts` rejects it if you forget |
| `DIRECT_URL` | Supabase Connect, **session** pooler | **Port must be 5432.** Used by drizzle-kit only |
| `TOOL_SHARED_SECRET` | `openssl rand -hex 32` | Must match the ElevenLabs workspace secret of the same name |
| `SESSION_SECRET` | `openssl rand -hex 32` | Rotating this invalidates every live gate cookie |
| `DEMO_PASSCODE` | chosen | 8 characters minimum |
| `ELEVENLABS_WEBHOOK_SECRET` | shown once when the post call webhook is created | **Cannot be read back later.** If it is lost, delete the webhook and make a new one |
| `DAILY_SESSION_CAP` | default `6` | |
| `DEFAULT_TIMEZONE` | default `Asia/Karachi` | Only a fallback. The browser's own zone replaces it after mount |

**`NEXT_PUBLIC_VOICE_MOCK` is not in this table and must never be set in Vercel.** It
lives in exactly one place, the Playwright web server command in `playwright.config.ts`.
Setting it in a deployed environment would ship a build whose console is a scripted fake.
Per SPEC.md section 6.7 it gates behaviour only, and no secret ever rides a
`NEXT_PUBLIC_` name.

---

## 3. Platform state

```bash
# The webhook is registered, enabled, and has not been auto disabled
curl -sS -H "xi-api-key: $ELEVENLABS_API_KEY" \
  https://api.elevenlabs.io/v1/workspace/webhooks

# The workspace actually points at it
curl -sS -H "xi-api-key: $ELEVENLABS_API_KEY" \
  https://api.elevenlabs.io/v1/convai/settings
```

Wants `is_disabled: false`, `is_auto_disabled: false`, `auth_type: "hmac"`, and
`webhooks.post_call_webhook_id` set. **Read `most_recent_failure_error_code` and write the
value down before a demo call**, because it is how the next section tells a rejected
delivery from one that never arrived.

Ten consecutive delivery failures auto disable a webhook. Our route answers 401 or 400 on
anything malformed and neither retries, so only our own 5xx triggers a retry, which is
exactly the case where redelivery is wanted.

Also confirm the agent still requires authorisation:

```bash
curl -sS -H "xi-api-key: $ELEVENLABS_API_KEY" \
  "https://api.elevenlabs.io/v1/convai/agents/agent_1401kz0x1h1xfsk8x4vh5hxpjezg" \
  | grep -o '"enable_auth":[^,]*'
```

Wants `true`. With it false, anyone reading this public repository can open a conversation
straight against the agent, walk around the passcode gate entirely, book real calendar
events and drain the month.

---

## 4. Verify, then ship

```bash
pnpm verify:all
```

Typecheck, then the unit suite, then the copy check, then Playwright. Playwright builds
the app itself with the mock flag, so this takes a couple of minutes and that is expected.

**`pnpm verify:all` overwrites `.next` with a mock build.** `.next` is gitignored and is
never uploaded, so the mock cannot reach production. Do not pair it with
`vercel deploy --prebuilt`, which would ship whatever is sitting in `.next`.

```bash
git push                    # source of truth, but does NOT trigger a build
vercel deploy --prod --yes  # this is what deploys
```

**This project has no git integration.** It was created with `vercel link` and every
deployment in its history was made from the CLI. Pushing to `main` publishes the code and
changes nothing that is running. Both commands are required, in that order.

Two failure modes worth knowing, because both have happened:

- **`ERR_PNPM_OUTDATED_LOCKFILE`.** Vercel installs with `--frozen-lockfile`, so editing a
  version in `package.json` without running `pnpm install` fails the build. The log names
  the offending specifier exactly.
- **Polling the URL and seeing no change.** With no git integration there is nothing to
  wait for. Check `vercel ls` for a deployment newer than the push before assuming the
  build is slow.

Then, on the deployment:

```bash
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://voxdesk-seven.vercel.app/
curl -sS -o /dev/null -w '%{http_code}\n'                https://voxdesk-seven.vercel.app/gate
```

Wants `307` to `/gate?next=%2F` and `200`. A `200` on the first line means the middleware
is not gating and the deployment must not be shown to anyone.

---

## 5. After a live call

The three step check that closes the signature construction, in order:

1. `GET /v1/workspace/webhooks`, read `most_recent_failure_error_code` against the value
   recorded in section 3. Non null means the delivery reached us and was rejected, and the
   code says how.
2. Confirm that call's `conversations` row moved to `completed` with a transcript, with no
   hand signed curl involved.
3. If it did not land, the Vercel function log for `/api/webhooks/post-call` carries
   exactly one of `missing_header`, `malformed_timestamp`, `missing_signature`,
   `timestamp_out_of_tolerance`, `signature_mismatch`. Those five separate a wrong
   construction from a wrong secret from a clock problem without guessing.

Then cancel any Cal.com booking the call created, unless it was meant to stand.

---

## 6. Known traps, each of which shipped green once

- **A timestamptz is not a Date.** `src/lib/db/client.ts` sets `fetch_types: false`, so
  postgres-js returns the Postgres text form. Any new query casts through
  `to_json(col) #>> '{}'`. Typecheck and the unit suite were green while both dashboard
  pages returned 500.
- **Tailwind preflight makes inputs transparent.** On a true black surface an unstyled
  input is an invisible box on an invisible background, and `color-scheme: dark` does not
  rescue it because the transparency is an authored rule. Every input in this build
  carries an explicit background and border, and the e2e suite asserts it.
- **`happy-path` in `agent/tests` creates a real Cal.com booking on every run**, by
  design. Cancel it afterwards and use `--only=` when iterating on anything else.
- **A grep pattern is not case insensitive by default.** `scripts/check-copy.sh` silently
  passed a file carrying one of the four banned attribution strings, because the pattern
  is lowercase and all four are capitalised. It was caught by running the check against a
  deliberate violation rather than by reading it.
