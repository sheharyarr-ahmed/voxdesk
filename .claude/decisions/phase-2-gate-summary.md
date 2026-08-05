# Phase 2 gate summary

**Date:** 2026-08-05
**Verdict:** **PASS.** A spoken conversation booked a real slot end to end in 2 minutes 19 seconds.
**Conversation:** `conv_6701kz8fyrk5fzbre5jprd6s5hbk`, 139 s, 22 messages, `call_successful: success`.

## Gate condition

SPEC.md §8: *a spoken conversation books a real slot end to end in under three minutes.*

| # | Evidence | Result |
|---|---|---|
| 1 | Real Cal.com booking created during the call | **`9Vhn8RCrD39GkRvgA4DkGQ`**, `2026-08-05T10:30:00.000Z`, `sheharyar.softwareengineer@gmail.com` |
| 2 | Both tool invocations logged with real latencies | `check_availability` 434 ms, `book_meeting` 2296 ms, both HTTP 200, both `ok: true` |
| 3 | ElevenLabs conversation record | `conv_6701kz8fyrk5fzbre5jprd6s5hbk`, 139 s |
| 4 | Under three minutes | **2:19** |

Both `tool_invocations` rows and the `bookings` row are anchored to the real ElevenLabs conversation id, and the `conversations` row sits at `status: in_progress` exactly as SPEC.md §5.1 intends, because the post call webhook is Phase 3.

## The sequence held under voice

The tool discipline the whole phase was spent on survived a live call.

```
[agent] ... That sounds like a production build, which is phase two of our engagement.
[user]  That works. Uh, what times do you have?
        -> check_availability            434 ms
[agent] I have a few openings today. How about three thirty PM, three forty-five PM, or four PM?
[user]  The first one works.
[agent] Can I get your full name and email address?
[user]  It's Shahriar Ahmed, and the mail is shahriar.softwareengineer@gmail.com
[agent] Could you spell out the email address for me, just to make sure I have it right?
[user]  S-H-E-H-A-R-Y-A-R.S-O-F-T-W-A-R-E-E-N-G-I-N-E-E-R@gmail.com
[agent] Booking your meeting now.
        -> book_meeting                 2296 ms
[agent] You are booked for Wednesday, August five at three thirty PM.
```

`book_meeting` was called with `start_utc: 2026-08-05T10:30:00.000Z`, which is byte for byte the first slot `check_availability` returned. The agent never constructed a time.

**Speech to text mangled the name to "Shahriar" and the email to "shahriar."** The spell back rule caught both, and the booking went to the correct address. SPEC.md §6.3 argues for voice first capture with a spell back before booking, and this is that argument holding under a real microphone rather than in prose.

`force_pre_tool_speech` did its job too. "Booking your meeting now" covers the 2.3 s write, so the pause is a sentence rather than dead air.

## Two things Phase 0 left open, both now closed

**RAG retrieval fires at runtime.** Phase 0 could only prove the document was indexed, because `rag_retrieval_info` came back null on every simulated turn, and `v7-rag-indexing.md` plus the Phase 0 summary both held `docs/CLAIMS.md` to "controlled, RAG indexed document" until a live conversation showed chunks. It now does, on **9 of the call's turns**:

```json
{"chunks": [{"document_id": "CgTt6RU8cZj1519ZGoUU", "chunk_id": "Mbjmvh8E0BxVhtFPjU9j", "vector_distance": 0.133},
            {"document_id": "CgTt6RU8cZj1519ZGoUU", "chunk_id": "0nPF4Dg266npWoYZ7UHU", "vector_distance": 0.171}],
 "embedding_model": "e5_mistral_7b_instruct", "retrieval_query": "What are you working on at SheryLabs?",
 "rag_latency_secs": 0.19, "used_chunk_ids": []}
```

Real chunks from our document, real vector distances, 0.19 s retrieval. Stated precisely, because the distinction is the whole point of the original caveat: **retrieval demonstrably ran against the document.** `used_chunk_ids` came back empty, which is a separate signal about attribution and is not being read as more than it says. The claim may now assert retrieval; it may not assert that every answer was grounded in a retrieved chunk.

**Lead extraction works, a phase early.** `analysis.data_collection_results` came back populated from the six fields this phase pushed, which is the input Phase 3's `ingestConversation` is built to parse:

| Field | Extracted |
|---|---|
| `name` | `Sheharyar Ahmed` |
| `email` | `sheharyar.softwareengineer@gmail.com` |
| `company` | null, never mentioned |
| `project_type` | `a voice agent that answers questions on my site and books demos` |
| `timeline` | `in about six weeks` |
| `budget_band` | `production_build` |

`budget_band` came back as exactly one of the three values the field description constrains it to. The `name` rationale is worth keeping: the extractor reconciled the mangled "Shahriar Ahmed" against the spelled out email and returned the correct spelling.

## The credits rate, finally measured rather than inferred

`phase-2-testing-surface-cost.md` had to work from the inference that 10000 credits maps to the advertised 15 Agents minutes, near enough 667 credits per minute. The gate call measures it directly.

```
before 8006 of 10000   ->   after 8812 of 10000   =   806 credits for 139 s
```

**About 348 credits per minute, roughly half the inferred rate.** The budget was never as tight as it looked. Text simulation is the expensive surface per unit of value, at about 640 credits per simulated conversation against 806 for a full spoken booking. That is the number to plan Phase 4's recording against.

Ledger for the phase: **8812 of 10000 credits, 1188 remaining**, reset 2026-08-29. Phase 2's nominal budget was 4 of 15 minutes; the gate call itself spent 2:19 of it and the rest went on the five test simulations that found the reconciliation defect.

## Recorded so no future session has to guess it

The agent's test call page is:

```
https://elevenlabs.io/app/agents/agents/agent_1401kz0x1h1xfsk8x4vh5hxpjezg/preview
```

The `agents/agents/` segment is doubled. `/app/agents` alone is the Agents analytics dashboard and shows no agent list at all, and `/app/agents/{id}` is a 404. `/app/conversational-ai/agents/{id}` still redirects correctly and is the reliable way in.

On that page, **Mock tools** must read **Off** for real tools to fire, and the **Variables** panel is where `visitor_timezone` appears. It was pre-filled with `Asia/Karachi` from the `dynamic_variable_placeholders` this phase pushed, which is the thing that stops a dashboard call failing on `timezone` being empty.

## A live exposure found after the gate, and closed

Asking where a second unexpected Cal.com booking came from turned up something larger than the answer to the question.

**The answer to the question first, because it is not alarming.** Every booking traces to a deliberate action. Two came from Phase 1 curl by hand, two from `happy-path`, which sets `mocking_strategy: "none"` and therefore creates a real booking on every run, and one from the gate call. Nothing runs on a schedule: no crons in the repository, no `vercel.json` or `vercel.ts`, no background process, `simulation_library.enabled: false`. A test being *attached* to the agent is not a test being scheduled.

**The larger finding.** The agent was configured `auth.enable_auth: false`, `allowlist: []`, alongside `daily_limit: 100000` and `agent_concurrency_limit: -1`. Its id is in five files in pushed history on a repository `gh` confirms is `PUBLIC`, `SPEC.md` among them. So anyone reading the repository could open a conversation straight against ElevenLabs, walk around the §6.1 passcode gate entirely, book real calendar events and drain the remaining credits.

That breaks SPEC.md §10, which puts "public unauthenticated voice" out of scope and names the quota as the reason, and it defeats the whole three layer defence in §6.1, which only ever guarded *our* route to voice minutes and never the agent id itself.

**Closed** by adding `platform_settings.auth.enable_auth: true` to `agent/agent.config.json` and pushing it. This is the design §6.1 already assumed rather than a new one: `POST /api/session` mints a conversation token server side with the API key, which is exactly the authorisation the platform now demands.

Verified by connecting as an attacker would, not by reading the setting back:

```
GET /v1/convai/conversation?agent_id=... with websocket upgrade headers, no credentials
  -> HTTP/1.1 101 Switching Protocols
  -> first frame: "This agent requires conversations to be authorized.
                   Please generate a signed link for conversation starting using /v1/co..."
```

Stated precisely, because the 101 matters. The websocket **transport** handshake still completes and the refusal happens at the application layer immediately after. That is auth in the right place, not a network level block, and anyone reading only the status line would draw the wrong conclusion.

What a rejected attempt costs: credits unchanged at 8812, and the attempt **does** leave an ElevenLabs conversation record, `status: failed`, `0 s`, zero turns, `cost: None`. It never reaches our routes, and no row appears in our `conversations` table. Two such stubs exist from this probe and are expected.

Our own path was confirmed unbroken in the same pass: `GET /v1/convai/conversation/token?agent_id=...` with `xi-api-key` still returns `200` with a 1039 character token.

**Residual risk, stated rather than glossed.** The token mints and unauthenticated access is refused, but a token authorised WebRTC connect cannot be proven end to end until the Phase 4 client exists. If it misbehaves there, `enable_auth` is a one line revert in `agent/agent.config.json`. This belongs in the Phase 4 gate alongside V5.

**A first probe that proved nothing, kept as a warning.** The same request over HTTP/2 returned `404`, which looks like a clean refusal and is not one: HTTP/2 does not carry the classic `Upgrade` header, so the request never reached the websocket endpoint. `--http1.1` is required or the check silently measures the wrong thing.

## Deviations recorded this phase

Numbering continues from the Phase 1 gate record.

| # | Deviation | Reason |
|---|---|---|
| 17 | `platform_settings.auth.enable_auth` is set to `true` and held in `agent/agent.config.json` | SPEC.md never names this field, because §6.1 assumed the gate was the whole defence. It is not: the gate guards our route, and the agent id is a second, public door. See the section above. |
| 14 | `book_meeting` declares `response_timeout_secs: 10`, `check_availability` declares `5` | The range is 5 to 120, not a fixed 5. Deviation 13's 4.3 s route budget leaves about 700 ms under a 5 s ceiling, and blowing that ceiling hands the agent no structured body at all. See `phase-2-tool-timeout-bounds.md`. |
| 15 | `agent/tests/*.json` added outside the SPEC.md §4 tree | Five committed simulation tests. The deterministic tool mock is what caught the inverted reconciliation, and a live call cannot provoke that state on demand. |
| 16 | `agent/push.ts` gains `--dry`, `--run-tests` and `--only=` modes | §6.8 specifies `--dry` only. The test runner lives in the same file rather than a second one so the tree gains one file, not two, and `--only` exists because the test surface is metered. |

## State left for Phase 3

| Item | Value |
|---|---|
| Agent | `agent_1401kz0x1h1xfsk8x4vh5hxpjezg`, prompt 9464 bytes, both tools attached |
| Tools | `check_availability` `tool_4201kz8d74e8fdf957q6acyfx2rg`, `book_meeting` `tool_7401kz8d75rze5at5353jeeqrrsw` |
| Tests | five, attached, all passing, ids in `agent/ids.json` |
| Workspace secret | `TOOL_SHARED_SECRET` as `qe8rWFylNWUu4hlQKTNy`, value never handled by a session |
| Conversation for Phase 3 to ingest | `conv_6701kz8fyrk5fzbre5jprd6s5hbk`, transcript and analysis both present |
| Post call webhook | none. Phase 3, and `ELEVENLABS_WEBHOOK_SECRET` is still the one unset variable |
| Credits | 1188 of 10000, reset 2026-08-29 |
| Cal.com | `9Vhn8RCrD39GkRvgA4DkGQ` is the gate booking. Both `dana.whitfield@example.com` test bookings cancelled |
| Agent auth | `enable_auth: true`. Every conversation now needs a token from `POST /api/session`. Phase 4 must confirm a token authorised WebRTC connect actually works |
| Standing hazard | `happy-path` creates a real Cal.com booking on every run, by design. Cancel it afterwards, and use `--only=` when iterating on anything else |

V5 remains open by design and now closes at the Phase 4 gate. See the corrected record in `v5-webrtc-connect.md`.
