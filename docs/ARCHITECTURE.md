# ARCHITECTURE

The build contract is `SPEC.md`. This file explains the two decisions that shape
everything else, and describes one path that was deliberately not built.

---

## 1. The invariant: ElevenLabs owns ears, brain and mouth

Our server is never in the audio path. It is reached at exactly four points, and any code
that widens that surface is out of scope.

| # | Connection | Direction | Transport | When |
|---|---|---|---|---|
| 1 | Live conversation | Browser to ElevenLabs | WebRTC, `@elevenlabs/react` | Whole call |
| 2 | Session auth | Our server to ElevenLabs | REST, `xi-api-key` | Before the call starts |
| 3 | Tool call | ElevenLabs to our server | HTTPS, shared secret header, synchronous | Mid call |
| 4 | Post call ingest | ElevenLabs to our server | HTTPS, HMAC signed | After the call ends |

Two consequences are worth stating because they are easy to get wrong.

**Audio never touches us, so we cannot be the bottleneck.** Latency the visitor hears is
the platform's, except inside connection 3, which is ours and is held to a 3 second budget
by `src/lib/tool-log.ts`.

**Connection 3 arrives from ElevenLabs, not from the browser.** This was verified rather
than assumed: a text simulation run entirely inside the ElevenLabs backend, with no
browser anywhere, reached both deployed tool routes and created a real booking. That is
why a failure in the browser client cannot break the tool layer.

### The client is ours, and the seam is why

`src/lib/voice/use-voice-session.ts` is an adapter. Everything above it, meaning the
console, the transcript pane and the email fallback, talks to a `VoiceSession` and knows
nothing about the SDK. Two implementations sit behind it: the real one, which is the only
file in the repository that imports `@elevenlabs/react`, and a scripted fake compiled in
only when `NEXT_PUBLIC_VOICE_MOCK=1`, which is set in the Playwright web server command
and nowhere else.

The seam pays for itself twice. Playwright drives the entire console state machine with
zero platform traffic and zero credits, on a build where voice minutes are the binding
constraint. And every state transition is decided by one pure reducer with the clock
passed in rather than read, so the states a visitor can reach are unit testable without a
DOM, a socket or a microphone.

A detail the SDK forces, worth knowing before reading the code: the tool events carry
`tool_name`, `tool_call_id` and `is_error`, but **no duration**. The console therefore
times the round trip between the request event and the response event itself. That is a
browser observed span and is not the same number as the `latency_ms` measured inside our
route and rendered on `/calls`. Both are shown, and both say which they are.

---

## 2. Write ordering, the load bearing decision

Tool calls land mid call. The post call webhook lands after. So the conversation row
cannot be created by the webhook, and `el_conversation_id` is the natural key that any
route seeing it will create:

```sql
-- every tool invocation, before the child write
INSERT INTO conversations (el_conversation_id, status)
VALUES ($1, 'in_progress')
ON CONFLICT (el_conversation_id) DO NOTHING;

-- post call webhook, later, updating the same row in place
INSERT INTO conversations (el_conversation_id, status, transcript, ...)
VALUES (...)
ON CONFLICT (el_conversation_id) DO UPDATE SET status = 'completed', ...;
```

Three things follow, and all three are features rather than accidents:

- **Ingest is idempotent**, so webhook retries are safe. Verified across four signed POSTs
  of the same body leaving exactly one row.
- **A call whose webhook never arrives still shows its tool timeline**, at
  `status: in_progress`. The dashboard degrades to partial rather than to empty.
- **No client supplied identifier is ever trusted.** The id comes from the platform.

### Verification happens before persistence, not after

`/api/webhooks/post-call` reads the raw body with `req.text()` and never `req.json()`
first, because the signature is over the exact bytes. It verifies, then parses, then
writes. A failure at step one returns 401 and nothing touches the database, which was
proven by counting rows before and after rather than by reading the code.

An unset webhook secret answers **500, not 401**. HMAC-SHA256 with an empty key is still a
valid HMAC, so an unset secret has to be a hard stop rather than a silently weak verifier,
and 500 is the status ElevenLabs retries on, so a delivery arriving during a
misconfiguration is redelivered rather than discarded.

The persisted transcript is a **narrow projection, not the raw array**. The raw transcript
carries `tool_calls[].tool_details.headers`, which contains the tool shared secret, and
that column is rendered on a page. ElevenLabs redacts it on their own read surface, but
relying on an upstream redaction is relying on a policy that can change.

---

## 3. The custom LLM bridge, described and not built

SPEC.md section 10 puts a custom LLM bridge out of scope. It is described here because it
is the first question a technical reader asks, and because the answer is a real design
rather than a shrug.

ElevenLabs Agents can call an OpenAI compatible chat completions endpoint instead of a
hosted model. The bridge would be one route that accepts that request shape, runs whatever
orchestration is wanted, and streams back deltas in the same shape.

```
ElevenLabs  ->  POST /api/llm  (OpenAI compatible chat completions)
                  |
                  +-- orchestration: retrieval, routing, a graph, a second model
                  |
                <-  text/event-stream of deltas in the same shape
```

**Why it is not built here.** It moves our server into the turn loop, which is exactly what
section 2's invariant forbids. Every token then depends on our cold start and our latency
budget, and the demo's most impressive property, that turn taking feels natural, becomes
ours to lose. It also adds a paid model provider to a build whose binding constraint is
zero cash.

**When it would be worth it.** When routing has to depend on private state the platform
cannot see, or when a specific model is required for a domain. Neither is true of a
concierge that answers from one document and books a meeting.

---

## 4. What the free tier forced, and what it did not

Worth separating, because only the first group is a compromise.

**Genuine constraints.** 15 agent minutes a month, roughly 348 credits a minute measured
rather than inferred. RAG index retention is 10 days on this workspace, so an index can
expire between demos and has to be checked before one. No commercial licence.

**Not constraints, though they are often assumed to be.** Post call webhooks with HMAC
auth are available. Server side webhook tools are available. Neither fallback in SPEC.md
section 9 was taken, so nothing in this build is a weaker version of itself.
