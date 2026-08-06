# CLAIMS

SPEC.md section 12 makes this file authoritative. Every line of `README.md`, every
portfolio entry and every proposal is checked against it. A claim that is not in the
claimable table below is not made anywhere, in any framing.

The rule this file exists to enforce: **a claim is what was observed, not what the
architecture would allow.** Where the observation is narrower than the architecture, the
narrow version is what gets written down.

Evidence lives in the decision records committed with this repository, one record per
result, each carrying the alternative considered and the reason. Nothing here is asserted
without a pointer to one.

---

## Claimable

| # | Claim | Evidence |
|---|---|---|
| 1 | Deployed a voice agent on the ElevenLabs Agents platform | Agent `agent_1401kz0x1h1xfsk8x4vh5hxpjezg`, live, `phase-2-gate-summary.md` |
| 2 | Server side tool integration taking real actions mid call, including live calendar booking | Booking `9Vhn8RCrD39GkRvgA4DkGQ` created during a spoken call on 2026-08-05, `phase-2-gate-summary.md` |
| 3 | Both tool calls logged with real latencies and full request and response payloads | `check_availability` 434 ms, `book_meeting` 2296 ms, rendered on `/calls/[id]`, `phase-3-gate-summary.md` |
| 4 | Six lead fields extracted at call end and persisted | All six returned populated on the gate call, `company` correctly null, `phase-2-gate-summary.md` |
| 5 | HMAC signature verification enforced before anything touches the database | Unsigned POST returns 401 with the row counts unchanged before and after, `phase-3-gate-summary.md` |
| 6 | A valid signature over a tampered body is rejected | `conv_6701...` rewritten to `conv_ATTACKER_INSERTED_...` under a valid signature, `select count(*)` returns 0 afterwards, `phase-3-gate-summary.md` |
| 7 | Ingest is idempotent | Four signed POSTs of the same body leave exactly one `conversations` row, `phase-3-gate-summary.md` |
| 8 | A RAG knowledge base, so answers come from a controlled document rather than model priors | Document `CgTt6RU8cZj1519ZGoUU`, 3845 bytes, index `ZUXaCwee9tnYAo5BoPxw`, `e5_mistral_7b_instruct`, status `succeeded`. Retrieval ran on 9 turns of the gate call with real chunk ids and vector distances, `phase-2-gate-summary.md`, `v7-rag-indexing.md` |
| 9 | A custom React SDK frontend rather than the embed widget | `src/components/voice-console.tsx` on `@elevenlabs/react`, `useConversation`, `d03-custom-react-sdk-ui.md` |
| 10 | The entire agent configuration held as versioned code and pushed via API | `agent/agent.config.json`, `agent/prompts/system.md`, both tool definitions, `pnpm agent:push`, `d06-agent-config-as-code.md` |
| 11 | The voice session is passcode gated and quota defended in three layers | `src/app/gate/`, `src/middleware.ts`, and the `demo_sessions` counter in `/api/session`, SPEC.md section 6.1 |
| 12 | The agent itself requires authorisation, not just our route | `enable_auth: true`; an unauthenticated websocket connect is refused at the application layer, verified by connecting as an attacker would, `phase-2-gate-summary.md` |
| 13 | Speech to text error on an email address is handled by design, not by luck | The agent spelled the address back and caught a mangled name and address on the gate call, `phase-2-gate-summary.md`, SPEC.md section 6.3 |
| 14 | The transcript is persisted as a narrow projection that excludes the tool shared secret | `select transcript::text like '%x-vd-tool-secret%'` returns false, `phase-3-gate-summary.md` deviation 19 |
| 15 | Row level security is enabled on all five tables with no policy granting `anon` or `authenticated` | `src/lib/db/schema.ts`, `drizzle/`, SPEC.md section 5 |
| 16 | 102 unit tests and 18 end to end tests, with the end to end suite costing zero voice minutes | `pnpm verify:all`, `tests/`, SPEC.md section 6.7 seam |

### Claims with a stated limit

These are claimable **only** in the wording given. The limit is part of the claim.

| # | Claim, as it must be written | Why it is limited |
|---|---|---|
| 17 | "Retrieval demonstrably ran against the controlled document." Not "every answer was grounded in a retrieved chunk." | `rag_retrieval_info` returned real chunks and vector distances on 9 turns, but `used_chunk_ids` came back empty. That is a separate signal about attribution and is not read as more than it says. `phase-2-gate-summary.md` |
| 18 | "The console reports a browser observed tool round trip. The call log reports the latency measured inside our own route." | Two different spans. The SDK's `agent_tool_request` and `agent_tool_response` events carry no duration, so the console times the events it sees. Conflating the two would overstate what either number measures. |
| 19 | See the signature construction row below. | |

### Open, and therefore not yet claimable

| # | Item | Closes when |
|---|---|---|
| 20 | **The signing construction has not been confirmed against a payload ElevenLabs signed.** Signature verification is enforced and its failure modes are proven from outside, including a valid signature over a tampered body. The construction matches the documentation, V1's record and our own signer. It has only ever been checked against a signature we produced ourselves. | A live post call delivery lands and the conversation row moves to `completed` with no hand signed curl involved. There is no replay, resend or test endpoint on the ElevenLabs API, confirmed against the live OpenAPI document, so only a real call closes this. `phase-3-gate-summary.md` |
| 21 | **V5, a token authorised WebRTC connect from our own bundle.** The token mint is proven and unauthenticated access is proven refused. The handshake from `@elevenlabs/react` inside our build has not been run. | A session started from the deployed console reaches `connected`. `v5-webrtc-connect.md` |

---

## Not claimable under any framing

| Claim | Why not |
|---|---|
| Building the speech pipeline | ElevenLabs owns speech to text, the LLM, turn taking and text to speech. This build owns the tools, the persistence, the gate and the client. |
| Commercial or client deployment | The ElevenLabs free tier carries no commercial licence. This is a portfolio artifact and says so. |
| Telephony or phone support | Not built, not stubbed, not wired. `docs/TELEPHONY.md` describes it as a path, not a capability. |
| Any usage metric, call volume, or conversion number | No users. The only calls that exist are the ones enumerated in the decision records. |
| Production scale | Production grade architecture scoped to demo scale. The minute cap is the honest reason and is stated rather than hidden. |
| Multi language, outbound calling, CRM sync | `lead_captures` is the shape a CRM sync would read from. Nothing is wired. |
| Real time streaming of call events to the dashboard | `/calls` is request time rendered. The live transcript in the console is client state and is not persisted from the browser. |

---

## Attribution obligation

The ElevenLabs free plan grants no commercial rights and **requires attribution wherever
its output is published.** This is a licence term, not a stylistic choice.

It is discharged in three places, and the first is the one that matters because it cannot
be forgotten:

1. **In the product.** `Voice by ElevenLabs` renders in the console footer and on the
   gate. Any screenshot or recording of this build carries the credit by construction.
   Asserted by two end to end tests so it cannot be removed silently.
2. **In `README.md`**, in the stack section.
3. **In the demo video**, as a visible credit.

---

## How a README line is checked

Every claim in `README.md` maps to a numbered row above.

Line numbers are from `README.md` as it stands. Every prose line maps to a numbered row
above, or to a row in the not claimable table.

| README line | Traces to |
|---|---|
| 3, what it does | Claims 1, 2, 3, 4, 8 |
| 5, portfolio artifact and the free tier | Not claimable, rows "Commercial or client deployment" and "Production scale" |
| 9, the four connection points and the audio path | Claims 1, 9, and `docs/ARCHITECTURE.md` section 1 |
| 11, the audio path is replaceable | `docs/TELEPHONY.md`, which claims a design property and nothing more |
| 13, the adapter and the zero minute e2e suite | Claim 16 |
| 17, evidence lives in the decision records | The pointers in every row above |
| 19, proven by connecting | Claims 2, 5, 6, 7, 12 |
| 21, stated narrowly on purpose | Claims 17 and 18, quoted in the wording those rows require |
| 23, still open | Claim 20 |
| 27, stack | Checked against `package.json` on 2026-08-06, every entry present. shadcn/ui was removed from this line and from SPEC.md section 3 in phase 4, deviation 26, because it was named in the contract and never installed |
| 29, `Voice by ElevenLabs` | Attribution obligation |
| 33, verification counts | Claim 16. The two counts are the actual suite sizes, not targets |
| 37, deliberately not built | Not claimable table, and SPEC.md section 10 |

A line that cannot be pointed at a row is deleted, not softened.
