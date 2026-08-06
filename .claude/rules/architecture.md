# Architecture rules

Named in SPEC.md section 4 and written at the close of phase 4. These are the invariants a
change is checked against. They are not style preferences, and every one of them is either
a security boundary, a claims boundary, or a constraint that already caused a defect.

A change that violates one of these does not ship, whatever else it improves.

## 1. The four connection surface is fixed

ElevenLabs owns speech to text, the model, turn taking and text to speech. Our server is
never in the audio path and is reached at exactly four points:

1. Session token mint, our server to ElevenLabs, before the call.
2. `check_availability`, ElevenLabs to us, synchronous, mid call.
3. `book_meeting`, ElevenLabs to us, synchronous, mid call.
4. Post call ingest, ElevenLabs to us, HMAC signed, after the call.

**Any code that adds a fifth is out of scope.** A custom LLM bridge is the specific
temptation, and it is described in `docs/ARCHITECTURE.md` as a path deliberately not built,
because it moves our server into the turn loop.

## 2. No secret reaches the client

- The ElevenLabs API key never leaves the server. The browser receives a conversation
  token from `POST /api/session` and nothing else.
- No secret rides a `NEXT_PUBLIC_` variable, ever. The only such variable in the build is
  `NEXT_PUBLIC_VOICE_MOCK`, it gates behaviour only, and it is set in the Playwright web
  server command and nowhere else.
- `src/lib/env.ts` throws if it reaches a client bundle. That guard stays. Server values
  reach client components as props, the way `timeZone` does.
- No agent id in the client bundle. The private WebRTC session config takes
  `conversationToken` and forbids `agentId`, which is what enforces this.

## 3. Nothing unverified touches the database

`/api/webhooks/post-call` reads the raw body with `req.text()`, never `req.json()` first,
because the signature is over the exact bytes. It verifies, then parses, then writes.

- An unset webhook secret returns **500, not 401**. HMAC with an empty key is still a valid
  HMAC, so an unset secret must be a hard stop rather than a silently weak verifier, and
  500 is the status that gets retried.
- Every tool route goes through `withToolLogging`, which is the single choke point for
  secret verification, Zod parse of input and output, the time budget, and the
  `tool_invocations` write. **A tool route that bypasses it fails review.**
- The persisted transcript is a narrow projection, never the raw array. The raw form
  carries the tool shared secret in `tool_calls[].tool_details.headers`, and that column is
  rendered on a page. Do not add `tool_details` back for convenience.

## 4. Write ordering is load bearing

`el_conversation_id` is the natural key. Any route that sees it creates the row with
`ON CONFLICT DO NOTHING`; the webhook later updates the same row. This is what makes ingest
idempotent, keeps a call whose webhook never arrived visible with its tool timeline, and
means no client supplied identifier is ever trusted. Do not invert it by having the webhook
own row creation.

## 5. Every boundary is Zod parsed

Tool input, tool output, the post call payload, the session response. Failure responses on
tool routes return **HTTP 200 with `ok: false` and a `speak` line**, because a non 2xx makes
the agent improvise while a structured body makes it read the sentence we wrote.

## 6. Voice minutes are spent deliberately

Roughly 213 credits fixed per call plus 256 a minute. Never open a conversation to check
something that a free surface can answer. Free surfaces that exist: the RAG index read, the
`rag-query` probe, `GET /v1/workspace/webhooks`, the conversations list, and the entire
Playwright suite through the mock seam.

There is **no replay, resend or test delivery endpoint** on the ElevenLabs API, confirmed
against the live OpenAPI document. A post call delivery can only be produced by a real call.

## 7. Claims are bounded by evidence

`docs/CLAIMS.md` is authoritative. Every `README.md` line traces to a numbered row. A claim
that cannot be pointed at a row is deleted rather than softened, and a claim that is only
true in a narrower wording is written in that narrower wording.

The attribution the ElevenLabs free plan requires renders inside the product, on `/gate` and
in the console footer, so every screenshot carries it by construction. Two end to end tests
assert it. Do not move it into a caption.

## 8. Enforced at every commit

No AI attribution strings in code, comments, commit messages or meta tags. No em-dashes in
any copy, docs or UI text. No README claim absent from `docs/CLAIMS.md`. No ungated voice
session. No agent configuration living only in the dashboard.
