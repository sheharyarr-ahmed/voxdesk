# Phase 1 gate summary

**Date:** 2026-08-04
**Verdict:** **PASS.** All three gate conditions met against the deployed production URL.
**Deployed at:** `https://voxdesk-seven.vercel.app`, Vercel project `voxdesk`, region `iad1`.

## Gate conditions

| # | SPEC.md §8 condition | Result |
|---|---|---|
| 1 | The §11.2 curl creates a real Cal.com booking | **PASS.** `qnaH6daQ3PwhT27jMSmkXj` on 2026-08-05 09:30 `Asia/Karachi` |
| 2 | `pnpm test` green | **PASS.** 74 tests, 5 files |
| 3 | `.claude/verify.sh` blocks on a deliberately broken test | **PASS.** Blocks on both legs, exit codes below |

## Condition 1, the §11.2 sequence

Run against the production alias, secrets sourced from `.env.local` and referenced by name only.

```
POST /api/tools/availability  -> 200 in 1.53s
{"ok":true,"timezone":"Asia/Karachi","slots":[
  {"start_utc":"2026-08-05T04:30:00.000Z","label":"Wednesday, August 5 at 9:30 AM"}, ...5 slots]}

POST /api/tools/book          -> 200 in 3.25s
{"ok":true,"booking_uid":"qnaH6daQ3PwhT27jMSmkXj","start_utc":"2026-08-05T04:30:00.000Z",
 "label":"Wednesday, August 5 at 9:30 AM","speak":"You are booked for ..."}
```

`tool_invocations` for `curl_gate_final`, read back over `DIRECT_URL`:

| tool_name | latency_ms | status_code |
|---|---|---|
| `check_availability` | 496 | 200 |
| `book_meeting` | 2433 | 200 |

`bookings` holds one row, `qnaH6daQ3PwhT27jMSmkXj`, slot `2026-08-05T04:30:00.000Z`, status `accepted`.
The `conversations` row was created by the tool route itself, confirming the §5.1 write ordering:
no client supplied identifier is trusted and the webhook is not required to exist first.

### The 401 paths write nothing

| Request | Result |
|---|---|
| `/api/tools/availability`, wrong secret | 401 |
| `/api/tools/availability`, no secret | 401 |
| `/api/tools/book`, no secret | 401 |
| `conversations` rows for `curl_test_401` | **0** |

### The gate, independently

| Request | Result |
|---|---|
| `GET /` with no cookie | 307 to `/gate?next=%2F` |
| `GET /gate` | 200 |
| `POST /api/session` with no cookie | 401 |

## Condition 3, the verify script blocks

Four runs, both legs broken separately, reverted each time.

| Run | Exit | Evidence |
|---|---|---|
| green baseline | 0 | `verify: ok` |
| broken test leg | 1 | `AssertionError: expected 5 to be 4`, 1 failed of 74 |
| broken typecheck leg | 2 | `error TS2322: Type 'string' is not assignable to type 'number'` |
| restored | 0 | `verify: ok` |

Breaking only the test leg would have proved half a gate, since a hook that catches a failing
assertion but waves through a type error is not a gate. Registered as a Stop hook in
`.claude/settings.local.json`, which is gitignored, so no file outside the SPEC.md §4 tree is
added to the repository.

## The one real bug this phase found

**An aborted `POST /v2/bookings` still creates the booking.**

The first gate attempt timed out at the SPEC.md §6.2 abort of 2500ms and returned
`{ ok: false, reason: 'upstream_timeout' }`, which is the designed degradation. The next
availability call showed that slot gone. Cal.com had completed the write; only our client had
stopped listening.

That turns a slow answer into a double booking. The agent reads the timeout line, offers to try
again, and books a second slot while the first is already on the calendar.

Measured latencies from the deployed function, which is what made the abort marginal:

| Call | Latency |
|---|---|
| `GET /v2/slots` | p50 111 ms, p95 187 ms |
| `POST /v2/bookings` | 2.1 s to 2.9 s |

A single 2500ms abort therefore sat exactly on the booking failure boundary. Three changes:

1. **The budget is per tool.** `check_availability` keeps 2500ms upstream inside a 2800ms route
   budget, where it has 13x margin. `book_meeting` gets 4000ms upstream inside 4300ms.
2. **4.3s stays legal.** V2 established that the ElevenLabs platform minimum
   `response_timeout_secs` is 5, so the agent waits at least that long. SPEC.md §6.2's 3s was our
   own promise, not a platform limit, and it is the wrong promise for a write that creates real
   calendar state. Recorded as deviation 13.
3. **The timeout line no longer promises a retry.** It sends the agent back to
   `check_availability`, where the slot having disappeared is the evidence that the booking
   landed.

Verified after the change: a booking taking 3.25s end to end succeeded where it would previously
have been cut off.

**Still open, and it belongs to Phase 2 rather than here.** Widening the window makes a timeout
rare, it does not make it impossible, and the underlying race is not closed. The honest fix is a
reconciliation read after an abort, and the cheapest version is exactly what the new speak line
prompts: the agent re checks availability, and a missing slot means the booking exists. The
Phase 2 prompt should encode that explicitly rather than leaving it to the model.

## Other findings

1. **A booking failure classification bug, caught by unit tests before it shipped.** Cal.com's
   out of bounds message contains double quotes, and the raw response body escapes those as `\"`.
   Matching markers against the raw JSON meant a genuine `invalid_slot` would have been reported
   as `upstream_error`. Classification now runs on the decoded message. The live `slot_taken`
   path was then confirmed against the real calendar: re booking a taken slot returns
   `{ ok: false, reason: 'slot_taken' }` in 1.1s.
2. **`vercel link` appended `.env*` to `.gitignore`**, which shadowed the `!.env.example`
   negation on line 4. `.env.example` survived only because it was already tracked; deleted and
   re added it would have silently vanished, and it is the SPEC.md §7 contract for every variable
   name. Reverted. Worth knowing before any future `vercel link`.
3. **RLS verified rather than assumed.** Five tables, `relrowsecurity` true, `relforcerowsecurity`
   false, zero policies, owner `postgres`. The app reads and writes because Postgres exempts a
   table's owner from RLS. `FORCE ROW LEVEL SECURITY` would revoke that and silently return zero
   rows to every server query, so it is called out in `src/lib/db/schema.ts`.
4. **The `livekit-client` 2.16.1 pin is measured, not asserted.** `pnpm why` reports one resolved
   version reached both directly and transitively through `@elevenlabs/react`, and
   `node_modules/.pnpm` holds exactly one matching directory. `@elevenlabs/client@1.17.0` already
   depends on that exact version, so the override agrees with upstream rather than fighting it.
   V5's mitigation is in place ahead of the Phase 2 handshake.

## Deviations recorded this phase

Numbering continues from SPEC.md §6.9.

| # | Deviation | Reason |
|---|---|---|
| 5 | `signSession` and `verifySession` return promises | Middleware runs on Edge, where `node:crypto` does not exist. Web Crypto is async, costs no dependency, and `crypto.subtle.verify` supplies the constant time compare. |
| 6 | `withToolLogging` type parameters are `<N extends ToolName, O extends ToolOutput<N>>` | The declared signature takes no schemas. A registry keyed by the name literal lets `name` select them. Runtime signature and call sites unchanged. |
| 7 | Tool path conversations upsert uses `DO UPDATE SET status = conversations.status RETURNING id` | §5.1's `DO NOTHING` returns no row on conflict, so resolving the foreign key id would need a second round trip or would race to NULL. The no op update always returns the row and never modifies it. |
| 8 | Session cookie is `secure` only in production | A secure cookie is never set over `http://localhost`, which would make the gate untestable in development. |
| 9 | `ELEVENLABS_WEBHOOK_SECRET` is schema optional, read through a throwing accessor | Phase 1 must boot without it, and HMAC with an empty key is a valid HMAC, so an unset secret has to be a hard stop at the point of use rather than a silently weak verifier. |
| 10 | Timezone validity by constructing `Intl.DateTimeFormat` rather than `Intl.supportedValuesOf` | The constructor accepts valid IANA aliases such as `Asia/Calcutta` that `supportedValuesOf` omits, so §6.4 as written would reject a real browser. |
| 11 | Slots cache key gains the window length: `${date}:${days}d|${timeZone}` | §6.2's two part key collides across `days`, so a one day answer would be served to a three day request. |
| 12 | Three foreign keys carry `ON DELETE cascade` | §5 specifies no referential action. Nothing in the app deletes, per §10. |
| 13 | `book_meeting` runs a 4s upstream timeout inside a 4.3s route budget | See the bug above. §6.2's single 3s budget sits on the booking failure boundary, and the failure is a double booking rather than a slow answer. Inside the platform's 5s. |

Build configuration files added that are not in the §4 tree, all unavoidable and none of them
application code: `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `src/app/globals.css`,
`vitest.config.mts`, `pnpm-lock.yaml`, and `drizzle.config.ts`, which §6.9 deviation 2 already
names in prose without listing in the tree. `src/lib/timezone.ts` was added for the §6.4
normalisation shared by both routes.

## State left for Phase 2

| Item | Value |
|---|---|
| Production URL | `https://voxdesk-seven.vercel.app` |
| Vercel project | `voxdesk`, region `iad1`, Node 24.x, framework nextjs |
| Env vars set in Vercel | 11 of 12. `ELEVENLABS_WEBHOOK_SECRET` is Phase 3, by design |
| Database | 5 tables migrated, RLS on, zero policies |
| Cal.com | 3 verification bookings created on 2026-08-05, all to be cancelled |
| Voice minutes consumed | zero |
| Git | committed locally, not pushed, no Vercel git connection |

Deploys are CLI driven, so the temporary Cal.com egress probe never entered the repository
history at all.
