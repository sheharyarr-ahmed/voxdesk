# VoxDesk · Project Blueprint

**Owner:** Sheharyar Ahmed · SheryLabs
**Type:** Portfolio artifact. Voice agent proof piece.
**Status:** Not started. This document is the pre-build source of truth.
**Created:** July 2026
**Loads into:** Claude Code. Feed to `/spec` to generate `SPEC.md`, then build phase by phase.

---

## 0. HOW TO USE THIS FILE IN CLAUDE CODE

1. Create the repo, drop this file at `docs/BLUEPRINT.md`, commit it as the first commit.
2. Run `/spec` in a fresh session. Point it at this file. It writes `SPEC.md` at repo root using the standard shape (Goal, Files, Decisions, Out of scope, Verification).
3. Install `.claude/verify.sh` (§10) and `chmod +x` it. The global Stop hook picks it up automatically.
4. Build one phase per session (§7). Each session opens by reading `SPEC.md` and the phase block below. Do not build across phase boundaries in one session.
5. Run `/defend` after Phase 4 against §12 to rehearse the vetting answers before this goes on any profile.

**Session opener template:**
> Read SPEC.md and docs/BLUEPRINT.md section 7, Phase N. Build only Phase N. Stop at the acceptance gate. Do not touch files outside the phase file list.

---

## 1. WHAT THIS IS

A voice concierge for SheryLabs. A visitor opens the demo page, talks to an AI agent in the browser, asks about services, gets qualified through natural conversation, and the agent checks live Cal.com availability and books a real discovery call. When the call ends, the transcript, the tool timeline, and the extracted lead fields land in Supabase and render on a call log dashboard.

**Why this project exists, in order of importance:**

1. Unlock the ElevenLabs and voice agent job class on Upwork, where the competition is weak and the volume is high.
2. Add real voice agent experience to the stack so the capability claim is defensible in a live vetting call.
3. Produce the single best demo video in the portfolio, because voice demos better on video than anything else already shipped.

**What this is not:** a flagship architecture piece. ReelMind stays the lead in technical interviews because a self built 7 node state machine is a deeper claim than a managed voice platform integration. VoxDesk is category coverage, and it is honest about that.

**Name:** VoxDesk. `vox` is the voice morpheme the 2026 voice AI space runs on. `Desk` is the function. Matches the existing naming family (AuditDoc, LoadLane, QuoteLens, Airlock). Repo slug `voxdesk`.

---

## 2. THE CORE ARCHITECTURAL FACT

**ElevenLabs Agents is ears, brain, and mouth. Our server is never in the audio path.**

The browser connects directly to ElevenLabs over WebRTC. Speech to text, the LLM that decides the reply, turn taking, interruption handling, and text to speech all run on their infrastructure. Our code is reached only at four defined points.

| # | Connection | Direction | Transport | When |
|---|---|---|---|---|
| 1 | Live conversation | Browser to ElevenLabs | WebRTC via React SDK | Whole call |
| 2 | Session auth | Our server to ElevenLabs | REST | Before call starts |
| 3 | Tool call | ElevenLabs to our server | HTTPS webhook, synchronous | Mid call |
| 4 | Post call ingest | ElevenLabs to our server | HTTPS webhook, HMAC signed | After call ends |

**One call, start to finish:**

1. Visitor clicks talk. Our `/api/session` route asks ElevenLabs for a short lived conversation token using the server side API key. Key never reaches the browser.
2. Browser connects. Mic opens. Transcript events stream to our UI.
3. Visitor asks what SheryLabs does. Agent answers from the knowledge base. Our server is idle.
4. Visitor asks to book. Agent calls `check_availability`, then `book_meeting`. Our routes hit Cal.com and return JSON. Agent speaks the confirmation.
5. Call ends. ElevenLabs POSTs the transcript and extracted data. We verify the HMAC signature, then write to Supabase.

**Our defensible engineering surface:** tool contracts and their schemas, HMAC verification, the Cal.com integration, the data model, the observability dashboard, the custom SDK frontend, and the agent configuration held as versioned code. Not the speech pipeline. Never claim the speech pipeline.

---

## 3. STACK, LOCKED

| Layer | Choice | Why, in one line |
|---|---|---|
| Framework | Next.js 15 App Router | Matches ReelMind. One deploy target for UI and all four routes. |
| Language | TypeScript strict | No `any`. Standing rule. |
| UI | React 19, Tailwind v4, shadcn/ui | Same as ReelMind. Zero new learning cost. |
| Voice platform | ElevenLabs Agents, free tier | The whole point of the piece. |
| Voice client | `@elevenlabs/react`, `useConversation` | Custom UI. Never the drop in embed widget. |
| Agent LLM | ElevenLabs hosted, their credentials | Zero cash. Custom LLM bridge documented, not built. |
| Validation | Zod at every boundary | Tool input, tool output, webhook body, form input. |
| Database | Supabase Postgres, RLS on every table | Free tier. Matches existing pattern. |
| ORM | Drizzle | Matches ReelMind. |
| Calendar | Cal.com API v2 | Already owned. Real bookings, not a mock. |
| Testing | Vitest unit, Playwright E2E | Gates the Stop hook. |
| Hosting | Vercel Hobby | Sub second cold start. Load bearing, see §4. |
| Package manager | pnpm | Standing default. |

**Rejected, with reasons worth defending out loud:**

- **FastAPI backend.** Free Python hosts (Render free, HF Spaces) cold start at 30 seconds or more. A caller is waiting mid sentence for the tool result. Vercel functions cold start sub second. Latency beat language preference.
- **Twilio and any phone number.** Costs money, needs a paid ElevenLabs tier, and is not required to prove the architecture. Documented as an extension path in `docs/TELEPHONY.md`.
- **Self built STT or TTS (Whisper, Deepgram, raw TTS calls).** Buyers are searching for ElevenLabs by name. Rebuilding the pipeline burns weeks and matches nothing anyone is hiring for.
- **The embed widget.** It is what every low effort bidder ships. The SDK integration is the differentiator.
- **Custom LLM via OpenAI compatible proxy.** Real and buildable at zero cash by fronting a free tier model, but it adds a failure surface for no portfolio gain in v1. Documented in `docs/ARCHITECTURE.md` as the stretch path.

---

## 4. FREE TIER BUDGET, THE HARDEST CONSTRAINT

**ElevenLabs free tier as of this writing:** 15 minutes of agent conversation per month, 4 concurrent calls, workflow builder, knowledge base, and website widget. 10,000 credits per month. Knowledge base capped at 20MB for non enterprise. RAG will not enable on documents under 500 bytes. **No commercial license on the free tier.**

Fifteen minutes is roughly three to four short conversations. Voice minutes are the scarce resource and the entire build order is designed around spending as few as possible.

**Minute ledger, planned:**

| Phase | Work | Minutes |
|---|---|---|
| 0 | Agent bring up, prompt and KB, text console only | 0 |
| 1 | Routes, Cal.com, tests, all via curl | 0 |
| 2 | First voice end to end, scripted | 4 |
| 3 | Webhook capture, real calls needed | 3 |
| 4 | Demo video, scripted, 2 to 3 takes | 5 |
| Reserve | Live demos on vetting calls | 3 |
| **Total** | | **15** |

**Cycle split, deliberate.** Run Phases 0 through 2 in the current billing cycle, spending about 4 minutes. Let the quota reset, then run Phases 3 and 4 on a fresh 15 minutes so the demo video is recorded with room for retakes. This is a scheduling decision, not an optimization. Do not compress it.

**Standing rules from the budget:**

- Every route is tested with `curl` before it is ever tested with a voice.
- Every prompt change is validated in the dashboard text console before a voice run.
- The public live demo is gated behind a passcode. A fully open voice demo lets one curious visitor drain the month in a single conversation. The public artifacts are the video, the dashboard, and the repo.
- No card on file. No paid tier. If a paying client engagement ever justifies it, the $5 Starter tier is the upgrade and it carries the commercial license.

---

## 5. FILE TREE

```
voxdesk/
├── SPEC.md
├── README.md
├── .githooks/commit-msg
├── .claude/
│   ├── verify.sh
│   ├── rules/architecture.md
│   └── decisions/
├── agent/
│   ├── agent.config.json          agent settings, versioned
│   ├── prompts/system.md          system prompt, single source
│   ├── knowledge/sherylabs.md     KB document, RAG source
│   ├── tools/check_availability.json
│   ├── tools/book_meeting.json
│   └── push.ts                    pushes config to ElevenLabs via API
├── src/
│   ├── app/
│   │   ├── page.tsx               landing plus gated voice UI
│   │   ├── calls/page.tsx         call log dashboard
│   │   └── api/
│   │       ├── session/route.ts            connection 2
│   │       ├── tools/availability/route.ts connection 3
│   │       ├── tools/book/route.ts         connection 3
│   │       └── webhooks/post-call/route.ts connection 4
│   ├── components/
│   │   ├── voice-console.tsx      mic state, live transcript, brand UI
│   │   └── call-detail.tsx        transcript plus tool timeline
│   └── lib/
│       ├── cal.ts                 Cal.com client
│       ├── verify-hmac.ts         signature verification
│       ├── schemas.ts             all Zod schemas
│       └── db/{schema.ts,client.ts}
├── docs/
│   ├── ARCHITECTURE.md            the four connections, diagrammed
│   ├── CLAIMS.md                  honest claims ledger, §12
│   ├── TELEPHONY.md               Twilio extension path, not built
│   └── DEPLOY_CHECKLIST.md
└── tests/
    ├── unit/                      Vitest
    └── e2e/                       Playwright
```

---

## 6. DATA MODEL

Supabase Postgres. RLS enabled on every table. No table is publicly readable by default.

**`conversations`**
`id` uuid pk · `el_conversation_id` text unique · `started_at` timestamptz · `ended_at` timestamptz · `duration_seconds` int · `status` text · `transcript` jsonb · `summary` text · `created_at` timestamptz

**`lead_captures`**
`id` uuid pk · `conversation_id` uuid fk · `name` text · `email` text · `company` text · `project_type` text · `timeline` text · `budget_band` text · `extracted_at` timestamptz

**`tool_invocations`**
`id` uuid pk · `conversation_id` uuid fk · `tool_name` text · `request_payload` jsonb · `response_payload` jsonb · `latency_ms` int · `status_code` int · `invoked_at` timestamptz

**`bookings`**
`id` uuid pk · `conversation_id` uuid fk · `cal_booking_uid` text · `slot_start` timestamptz · `attendee_email` text · `status` text

`tool_invocations` is the observability table. It is the direct analogue of ReelMind's `agent_traces` and it is what the dashboard renders. It is also the screenshot a prospect looks at to verify the agent actually did something rather than just talked.

---

## 7. BUILD PHASES

Each phase is one Claude Code session. Each ends at an acceptance gate. Do not proceed past a failed gate.

### Phase 0 · Agent bring up and verification sweep
**Minutes: 0. Estimated: 3h.**

Create the ElevenLabs account and agent. Write `agent/prompts/system.md` (qualification flow, tool sequencing logic, prompt injection defense using delimited input, refusal rules for anything not in the KB). Write `agent/knowledge/sherylabs.md` from the master config, defensible claims only, over 500 bytes so RAG will index it. Upload the KB. Run the seven verification checks in §8 and record every result in `.claude/decisions/`.

**Gate:** a text console conversation answers three service questions correctly from the KB, and all seven §8 verifications are recorded as pass or as fallback taken.

### Phase 1 · Routes and Cal.com, no voice
**Minutes: 0. Estimated: 5h.**

Scaffold the Next.js app. Build `/api/session`, `/api/tools/availability`, `/api/tools/book`, and `src/lib/cal.ts`. Zod schemas for every input and output. Shared secret header on both tool routes so they are not open endpoints. Supabase schema and migrations. Vitest suite covering schema validation, Cal.com client, and HMAC verification. Install `.claude/verify.sh`.

**Gate:** `curl` against `/api/tools/book` creates a real booking on the Cal.com demo event type. `pnpm test` green. Stop hook blocks on a deliberately broken test.

### Phase 2 · Wire the agent, first voice
**Minutes: 4. Estimated: 3h.**

Register both tools on the agent pointing at deployed URLs. Tune the qualification flow in the text console until it sequences tools correctly. Then, and only then, one scripted voice run.

**Gate:** a spoken conversation books a real slot end to end in under three minutes.

### Phase 3 · Observability
**Minutes: 3. Estimated: 4h.**

Build `/api/webhooks/post-call`. Verify the HMAC signature before anything touches the database. Persist conversation, transcript, extracted lead fields, and tool invocations. Build the `/calls` dashboard and the call detail view showing transcript alongside the tool timeline with latencies.

**Gate:** a completed call appears in the dashboard with transcript, both tool calls with latencies, and extracted lead fields. An unsigned POST is rejected with 401.

### Phase 4 · Frontend, docs, ship
**Minutes: 5. Estimated: 5h.**

Custom voice console on the brand system. True black, mint accent used once, Space Grotesk display with tight tracking, Space Mono labels. Mic permission states, connecting, listening, agent speaking, error. Live transcript pane. Passcode gate on the voice session. Deploy. Write README with the architecture diagram, `ARCHITECTURE.md`, `CLAIMS.md`, `TELEPHONY.md`, `DEPLOY_CHECKLIST.md`. Playwright smoke tests. Then script and record the 60 to 90 second demo video, one take target.

**Gate:** deployed, video recorded, README reviewed against `CLAIMS.md` line by line.

### Phase 5 · Distribution
**Minutes: 0. Estimated: 2h.**

Upwork portfolio entry. LinkedIn Featured tile and Projects entry. Company page post plus founder reshare via the existing skills. GitHub repo metadata, topics, social preview image.

**Total: 22 hours, 15 minutes of voice quota.**

---

## 8. VERIFICATION SWEEP (PHASE 0, BLOCKING)

Every one of these is a real risk of discovering mid build that the plan does not work on a free account. Run all seven before writing application code. Record each result in `.claude/decisions/`.

| # | Check | If it fails |
|---|---|---|
| V1 | Post call webhooks configurable on a free workspace | Poll the conversations API on an interval instead. Dashboard still works, ingest becomes pull not push. |
| V2 | Webhook tools (server tools) available on free tier | Fall back to client tools executed in the browser, which then call our routes. Weaker architecture, still shippable, must be disclosed in CLAIMS.md. |
| V3 | Does text only mode consume voice minutes | If it does not, all prompt iteration moves to text and the minute budget loosens significantly. If it does, cut Phase 2 testing to a single run. |
| V4 | Cal.com API v2 key issues, and booking creation permitted on the plan | Fall back to a read only availability tool plus a booking link the agent reads aloud. Weaker demo. Try hard to avoid. |
| V5 | WebRTC connects from the browser | Known issue: `livekit-client` newer than 2.16.1 can fail the handshake with `/rtc/v1` 404s. Pin the version in package.json, or switch `connectionType` to websocket. |
| V6 | Tool route round trip under the Vercel Hobby function timeout, with Cal.com latency included | Cache availability windows. Split the booking into a fire and forget confirmation the agent narrates optimistically. |
| V7 | KB document indexes with RAG (needs over 500 bytes) | Pad the document with genuine service detail. Do not fabricate to hit a byte count. |

---

## 9. ANTI-PATTERN CHECKLIST

Enforced at every commit. A build that violates any of these does not ship.

1. No ElevenLabs API key in client code or any `NEXT_PUBLIC_` variable. Session tokens are minted server side only.
2. No unverified webhook payload reaches the database. Signature check first, always.
3. No agent configuration living only in the dashboard. `agent/` is the source of truth and is pushed via API.
4. No embed widget. Custom SDK integration only.
5. No unvalidated boundary. Zod on tool input, tool output, and webhook body.
6. No ungated public voice session. The minute quota is the reason.
7. No AI attribution strings anywhere in code, comments, commit messages, or meta tags.
8. No claim in the README that is not in `docs/CLAIMS.md`.
9. No paid tier, no card on file, no recurring cost.
10. No em-dashes in any copy, README, docs, or UI text.

---

## 10. VERIFY GATE

`.claude/verify.sh`, `chmod +x`, picked up by the global Stop hook.

```bash
#!/usr/bin/env bash
set -e
if [ -z "$(git status --porcelain)" ]; then exit 0; fi
pnpm -s typecheck
pnpm -s test
```

Read only turns pass instantly because the tree is clean. Dirty tree means typecheck and unit tests must pass before the session turn completes.

**Git discipline:** `.githooks/commit-msg` rejects "Claude", "Co-Authored-By", "Generated with", and "Anthropic" in any commit message. `git config core.hooksPath .githooks` so the hook travels with the repo. Conventional commits, imperative mood, single author throughout.

---

## 11. ENVIRONMENT VARIABLES

**Server only, never prefixed with `NEXT_PUBLIC_`:**
`ELEVENLABS_API_KEY` · `ELEVENLABS_AGENT_ID` · `ELEVENLABS_WEBHOOK_SECRET` · `TOOL_SHARED_SECRET` · `CAL_API_KEY` · `CAL_EVENT_TYPE_ID` · `SUPABASE_SERVICE_ROLE_KEY` · `DEMO_PASSCODE`

**Public:**
`NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY`

`.env.local` in `.gitignore`. Verified before the first commit, not after.

---

## 12. HONEST CLAIMS LEDGER

Lives in the repo at `docs/CLAIMS.md`. Every README line, portfolio entry, proposal, and profile claim is checked against this. This section is the whole reason the project is safe to put on a profile.

**Can claim:**
- Designed and deployed a production grade voice agent on the ElevenLabs Agents platform.
- Built server side tool integration so the agent takes real actions during a call, including live calendar booking.
- Implemented HMAC verified post call webhook ingestion with signature validation before persistence.
- Built a RAG knowledge base so the agent answers from a controlled document rather than model priors.
- Built a custom React SDK frontend rather than using the drop in embed widget.
- Built full call observability: transcript, per tool request and response payloads, latencies, and extracted lead fields.
- Held the entire agent configuration as versioned code pushed via API, not hand edited in a dashboard.

**Cannot claim, under any framing:**
- Built the speech pipeline. ElevenLabs owns STT, the LLM, turn taking, and TTS.
- Deployed commercially or for a paying client. The free tier carries no commercial license. This is a portfolio artifact.
- Telephony or phone support. No Twilio, no PSTN. The extension path is documented, not built.
- Any usage metric, call volume, conversion number, or client outcome. None exist.
- Production scale. It is production grade architecture scoped to demo scale, and the minute cap is the honest reason.

**Disclosure script, for vetting calls and proposals:**
> The speech loop is ElevenLabs Agents. My layer is the tool contracts, the calendar integration, webhook signature verification, the data model, the observability dashboard, and the conversation design. Phone is a documented Twilio extension I have not built. The demo runs WebRTC in browser to stay inside the free tier, which carries no commercial license, so it is a portfolio artifact rather than a live product.

**The questions `/defend` must be run against before this goes public:**
Why Vercel rather than a Python backend. What happens if the tool call times out mid conversation. How do you stop someone injecting instructions through speech. Why HMAC rather than a bearer token on the post call webhook. What breaks first at 100 concurrent calls. Why is the agent configuration in the repo rather than the dashboard. What would you change to make this handle a real phone line.

---

## 13. UPWORK AND PORTFOLIO POSITIONING

**Bid strength impact:**

| Job class | Without | With |
|---|---|---|
| ElevenLabs agent build | 3/10 | 9/10 |
| AI receptionist, booking or intake agent | 4/10 | 9/10 |
| Generic voice AI integration | 4/10 | 8/10 |
| Twilio phone agent | 3/10 | 6/10, architecture transfers, disclose no PSTN |

**Target keywords:** ElevenLabs, conversational AI, voice agent, AI receptionist, appointment booking agent, voice AI developer, AI phone agent, Vapi, Retell.

**Proposal pattern, three phase, consistent with the standing structure:**
- Phase 1: conversation design plus tool contract mapping. 1 week, $750 to $1,500.
- Phase 2: production voice agent build with real system integration. 4 to 6 weeks, $4,000 to $8,000.
- Phase 3: retainer for new flows, integrations, and prompt tuning. Monthly, $1,000 to $2,500.

**Public artifacts:** demo video, dashboard screenshots, public repo, architecture doc. The live voice session stays behind the passcode and is opened during vetting calls, which is the strongest use of it anyway.

---

## 14. DEFERRED, DOCUMENTED, NOT PROMISED

Each of these goes in `docs/` as a described path so a prospect sees the thinking without the claim.

- **Twilio phone integration.** `TELEPHONY.md`. Media Streams relay, agent on a real number. Blocked on paid tier and a phone number cost.
- **Custom LLM bridge.** OpenAI compatible endpoint fronting a free tier model, or a LangGraph orchestrator behind it. The pattern is supported and documented by ElevenLabs. Real stretch path, no v1 value.
- **Outbound calling.** Different product, different tier.
- **Multi language.** Supported by the platform, not configured.
- **CRM push.** The lead capture table is the shape a CRM sync would read from. Not wired.
- **Commercial deployment on sherylabs.com.** Blocked on the $5 Starter tier and its commercial license. Unlocks on the first client win.

---

## 15. DECISIONS LOG SEED

Copy each into `.claude/decisions/` as its own entry with the alternative considered and the reason, so it can be defended from memory months later.

| Decision | Alternative rejected | Reason |
|---|---|---|
| ElevenLabs Agents platform | Self built STT plus LLM plus TTS | Buyers search the platform by name. Rebuilding matches no job posting. |
| Next.js routes on Vercel | FastAPI on a free Python host | 30s cold starts are fatal when a caller waits mid sentence for a tool result. |
| Custom React SDK UI | Drop in embed widget | The widget is what every low effort bidder ships. |
| ElevenLabs hosted LLM | Custom LLM proxy | Zero cash and zero extra failure surface in v1. Bridge documented. |
| Real Cal.com bookings | Mock calendar | A mock makes the whole tool layer theatre. The write to a real calendar is the proof. |
| Agent config as code | Dashboard configuration | Versioned config is the senior signal and makes the repo inspectable. |
| Passcode gated demo | Open public demo | One curious visitor drains 15 monthly minutes in a single conversation. |
| WebRTC | WebSocket | Platform default for voice. Fallback to websocket if V5 fails. |

---

## 16. RISK REGISTER

| Risk | Likelihood | Mitigation |
|---|---|---|
| Free tier gates a needed feature | Medium | §8 sweep runs before any application code. Every check has a named fallback. |
| Minute quota exhausted before the demo video | Medium | Cycle split. Phases 0 and 1 spend zero. Every route curl tested first. |
| Tool latency breaks conversation flow | Medium | V6 measures it in Phase 0. Cache availability. Optimistic narration if needed. |
| WebRTC handshake failure | Low | Known LiveKit version issue with a known pin. Websocket fallback exists. |
| Platform API changes mid build | Low | Config is versioned in `agent/`. Re push rather than re click. |
| Scope creep toward telephony | Medium | It is in §14 as deferred. If it comes up mid build, it stays deferred. |
| Overclaiming in the write up | Medium | §12 is checked line by line before anything is published. `/defend` run before publication. |

---

## 17. DEFINITION OF DONE

- [ ] All seven §8 verifications recorded with results
- [ ] Real booking created by voice, end to end, under three minutes
- [ ] Unsigned webhook POST rejected with 401
- [ ] Dashboard shows transcript, both tool calls with latencies, extracted lead fields
- [ ] `pnpm test` green, Stop hook gating confirmed
- [ ] Deployed, passcode gate working
- [ ] README, ARCHITECTURE.md, CLAIMS.md, TELEPHONY.md, DEPLOY_CHECKLIST.md written
- [ ] Demo video recorded, 60 to 90 seconds
- [ ] Zero em-dashes across all copy, verified by script
- [ ] Zero AI attribution strings in commit history
- [ ] Every README claim traced to a line in CLAIMS.md
- [ ] `/defend` run against §12, scorecard passed
- [ ] Upwork entry, LinkedIn Featured and Projects, company post and founder reshare published
- [ ] 3 reserve minutes remaining for live vetting demos

---

**END OF BLUEPRINT**
