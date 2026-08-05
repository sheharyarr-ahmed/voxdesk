# Phase 3 gate summary

**Date:** 2026-08-05
**Verdict:** **PASS.** SPEC.md §11.3 passes on both legs against the deployed URL, and the
Phase 2 gate call now renders complete with its transcript, both tool latencies and all six
extracted lead fields.
**Voice minutes spent:** zero. Credits unchanged at 8812 of 10000.

## Gate condition

SPEC.md §8: *§11.3 passes. A completed call renders with transcript, both tool calls with
latencies, and extracted lead fields. An unsigned POST returns 401.*

| # | Evidence | Result |
|---|---|---|
| 1 | Unsigned POST returns 401 and writes nothing | `401`, and 9 conversations / 0 leads before and after, `conv_6701` still `in_progress` |
| 2 | Correctly signed POST returns 200 twice with exactly one row | `200`, `200`, still **9** conversations, **1** row for `conv_6701`, **1** `lead_captures` row |
| 3 | The completed call renders with its transcript | 22 turns, beside `check_availability` 434 ms and `book_meeting` 2296 ms |
| 4 | Extracted lead fields render | all six, with `company` correctly showing as not mentioned |

Row counts were read directly out of Postgres before leg 1, between the legs and after leg
2, not inferred from the status codes. That is the Phase 1 precedent: a 401 that writes
nothing is proven by counting, not by reading the code.

## The sequencing question, decided before building rather than discovered

Post call webhooks fire only for new conversations, and `conv_6701kz8fyrk5fzbre5jprd6s5hbk`
predated any webhook. So the first question of the phase was whether the gate needed a live
delivery at all, and whether one could even be obtained.

**It cannot.** Checked rather than assumed:

- There is no resend, replay or redeliver endpoint on the ElevenLabs API. `retry_enabled`
  exists, retries up to five times, and fires only on `5xx`, `429` or `408`, and only for a
  delivery that was already attempted.
- `simulate-conversation` creates no conversation record at all, measured in V3, so it can
  never trigger one.
- Agent test runs produce `test-trun_*` ids that do **not** appear in
  `GET /v1/convai/conversations`, so they create no conversation record either, and they
  cost about 640 credits each.
- `GET /v1/convai/conversations` holds exactly three records: the gate call and the two
  Phase 2 auth probes. All three predate the webhook.

**So the gate is §11.3 as written, at zero voice minutes**, and the hand signed curl is
sufficient for everything §11.3 asserts. The three things it does not cover were each
closed without spending a minute:

| Gap | Closed by |
|---|---|
| Is the webhook registered against our URL | `GET /v1/workspace/webhooks` returns it, `auth_type: hmac`, `is_disabled: false` |
| Does the workspace point at it | `GET /v1/convai/settings` returns `post_call_webhook_id: 502d684855734b6f89634f1a109cae88` |
| Is our secret the one ElevenLabs signs with | It came from the create response, so it agrees by construction |

**One gap remains open and is named rather than glossed.** The gate signs with the same
`${t}.${body}` construction our verifier checks, so a wrong construction would pass both
legs. Only a delivery signed by ElevenLabs breaks that circularity, and no free surface can
produce one. It is carried below.

## The signature boundary, probed from outside

Beyond the two gate legs, against the deployed route:

```
valid signature, unmodified body ............ 200
same signature, body swapped underneath ..... 401
correctly signed but 1801s old .............. 401
several v0 values, one of them correct ...... 200
no signature header at all .................. 401
signed, event type we did not subscribe to .. 200 with ignored: true, no write
```

The second line is the one that matters. It is the exact attack HMAC is chosen over a
bearer token to defeat: `conv_6701kz8fyrk5fzbre5jprd6s5hbk` was rewritten to
`conv_ATTACKER_INSERTED_00000000000` under a valid signature, and afterwards
`select count(*) from conversations where el_conversation_id like 'conv_ATTACKER%'` returns
**0**.

Before the secret existed in the Vercel environment, the same unsigned request returned
`500 secret_not_configured` rather than 401, and wrote nothing. That is Deviation 9 doing
its job: HMAC-SHA256 with an empty key is a valid HMAC, so an unset secret has to be a hard
stop rather than a silently weak verifier.

## What landed in the database

```
conversations   status completed, 139 s, started 08:17:05Z, ended 08:19:24Z, 22 turns
lead_captures   Sheharyar Ahmed, sheharyar.softwareengineer@gmail.com, company null,
                a voice agent that answers questions on my site and books demos,
                in about six weeks, production_build
```

The `conversations` row is the **same row** the tool routes created mid call, updated in
place. `conv_6701` still has exactly one row and its two `tool_invocations` are still
attached to it. That is SPEC.md §5.1 write ordering completing its second half.

Idempotency held across four signed POSTs of the same body, not two.

**The stored transcript is 4092 bytes, down from 32314 raw**, and the reduction is the
point rather than a saving. `select transcript::text like '%tool_details%'` and
`like '%x-vd-tool-secret%'` both return **false**. See
`phase-3-post-call-payload-shape.md` for why that matters: the raw transcript carries the
tool shared secret in a header, and the column is rendered on a page.

## Three things checked against the live payload before any code was written

Recorded in full in `phase-3-post-call-payload-shape.md`. In short: the webhook body is
wrapped in `{type, event_timestamp, data}` and the conversations GET is not, so a fixture
built from the GET matches nothing. `analysis.data_collection_results` is a map of objects
read through `.value`, not a map of scalars. And the transcript carries the tool shared
secret, which was not expected and is the reason the persisted shape is a whitelist.

`tests/fixtures/post-call.json` is the real call, projected and wrapped, 72524 bytes, no
trailing newline so `BODY=$(cat ...)` signs exactly what is on disk.

## Two defects found, both by looking rather than by reading

**A timestamptz is not a Date.** `src/lib/db/client.ts` sets `fetch_types: false`, so
postgres-js returns the Postgres text form, `2026-08-05 08:17:50.876827+00`, and
`Intl.DateTimeFormat.format` threw `RangeError: Invalid time value` on every row. V8 does
parse that string, but it is not ISO 8601 and nothing should rest on a lenient parser, so
the queries now cast through `to_json` and the formatter takes an ISO string the way
`slotLabel` already does. Typecheck and 85 unit tests were green while both pages 500ed.

**True black on `body` made the passcode field disappear.** Tailwind's preflight sets
`background-color: transparent` on inputs, so on a black body the gate's input became an
invisible box on an invisible background. `color-scheme: dark` does not rescue it, because
the transparency is an explicit rule and not a browser default. The surface moved onto the
two dashboard pages, which own no form controls, and `/gate` and `/` keep the default
surface until Phase 4 styles them and their states together. Found by screenshotting the
deployed page; typecheck, the unit suite and the build were all green while it was unusable.

## Deviations recorded this phase

Numbering continues from the Phase 2 gate record.

| # | Deviation | Reason |
|---|---|---|
| 18 | `status` maps `data.status === 'done'` to `completed` and anything else to `failed` | §5.1's SQL sets `completed` unconditionally, yet §5 declares the enum as `in_progress \| completed \| failed`. This route is the only writer that could ever set `failed`, so without the mapping a declared state is unreachable. |
| 19 | `transcript` stores a narrow projection, not the raw array | `tool_calls[].tool_details.headers` carries `x-vd-tool-secret`. ElevenLabs redacts it on the GET surface, but the column is rendered on a page and relying on an upstream redaction is relying on a policy that can change. |
| 20 | `/calls/[id]` routes on `el_conversation_id` rather than the uuid primary key | It is the natural key §5.1 already declares, so a link is constructible from an ElevenLabs conversation id with no lookup. |
| 21 | A non `post_call_transcription` envelope returns 200 with `ignored: true` rather than 400 | A 4xx does not retry but does count toward the ten consecutive failures that auto disable a webhook. Accepting an event we did not subscribe to is cheaper than losing the subscription. |
| 22 | The webhook is created with `retry_enabled: true` | Our route answers 401 or 400 on anything malformed, neither of which retries, so retries cover only our own 5xx, which is exactly the case where a redelivery is wanted and where no replay endpoint exists. |
| 23 | An unset webhook secret answers 500, not 401 | 500 is the status ElevenLabs retries on, so a delivery arriving during a misconfiguration is redelivered rather than lost. A 401 would discard it permanently. |
| 24 | The brand tokens land in phase 3 and the surface is scoped to `/calls` | SPEC.md §8 assigns the brand to phase 4, but phase 4's line names only `voice-console.tsx`, so a dashboard shipped unstyled here would still be unstyled in the demo video. `/gate` and `/` are untouched. |
| 25 | `callTimestamp` and `durationLabel` live in `src/lib/slots.ts` | That file already owns every `Intl.DateTimeFormat` in the build, the memo maps and the U+202F normalisation. Adding `src/lib/format.ts` for two functions would be a file outside the §4 tree. |

## State left for Phase 4

| Item | Value |
|---|---|
| Webhook | `502d684855734b6f89634f1a109cae88`, hmac, retries on, no failures recorded |
| Workspace | `post_call_webhook_id` set, `events: ["transcript"]`, `transcript_format: json`, `send_audio: false` |
| Env | 12 of 12 set in Vercel production. There is no unset variable left |
| Database | 9 conversations, 1 completed with a transcript, 20 tool invocations, 5 bookings, 1 lead capture |
| Credits | 1188 of 10000, unchanged, reset 2026-08-29 |
| Brand | tokens and both fonts live in `globals.css` and `layout.tsx`. `/gate`, `/` and the console are unstyled and are phase 4's |
| Open | the HMAC construction is still only verified against our own signer. One real delivery closes it |
| Open | V5, a token authorised WebRTC connect, still closes at the phase 4 gate |

## The circularity, and what closes it

The honest limit of this gate is that a hand signed curl and our verifier share a
construction. If `${t}.${body}` were wrong in the same way in both, both legs would still
pass.

**One free attempt was made and it produced nothing.** An unauthenticated websocket connect
against the agent, over `--http1.1`, creates a conversation record at zero credit cost.
`conv_8601kz8yg18bftyrbvx02gyq32ca` appeared at `status: failed`, `0 s`, `0` messages,
credits unchanged at 8812. No delivery followed: `most_recent_failure_error_code` stayed
null, `usage` stayed null, and our own row count stayed at 9. So a rejected connect does
not emit `post_call_transcription`, which is consistent with it emitting
`call_initiation_failure`, an event this workspace does not subscribe to. Worth the attempt
because it cost nothing; recorded because a future session would otherwise try it again.

Nothing else free can close it. `simulate-conversation` creates no conversation record at
all, agent test runs create none either, and both cost credits. The remaining options are a
real spoken call, about 40 s and roughly 230 of the 1188 credits, or waiting for phase 4,
which records a demo call anyway and therefore closes this for free.

Until it closes, the claim is stated narrowly: **signature verification is enforced and its
failure modes are proven from outside, including a valid signature over a tampered body;
the signing construction matches the documentation, V1's record and our own signer, and has
not yet been confirmed against a payload ElevenLabs signed.**
