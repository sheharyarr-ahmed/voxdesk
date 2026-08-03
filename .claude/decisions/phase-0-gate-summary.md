# Phase 0 gate summary

**Date:** 2026-08-03
**Verdict:** Condition 1 met. Condition 2 partially met. **The gate is not fully closed.**

Written this way deliberately. SPEC.md §8 says do not proceed past a failed gate, so the state has to be legible rather than rounded up into a pass.

## Gate condition 1 · Text conversation answers three service questions from the KB

**MET.** Three questions asked through `simulate-conversation` against the live agent with the real prompt and the real RAG indexed knowledge base. All three answered correctly, including a clean refusal on the out of scope question. Transcript recorded verbatim in `gate-text-console-kb-recall.md`.

## Gate condition 2 · All seven §9 checks recorded as pass or as fallback taken

**PARTIALLY MET.** All seven are recorded. Two are recorded as deferred, which is neither of the two states the gate names.

| # | Check | Verdict | Record |
|---|---|---|---|
| V1 | Post call webhooks configurable on free | **PASS** | `v1-post-call-webhooks.md` |
| V2 | Webhook tools available on free tier | **PASS** | `v2-webhook-tools-free-tier.md` |
| V3 | Does text mode consume voice minutes | **PASS** | `v3-text-mode-minutes.md` |
| V4 | Cal.com key issues, booking permitted | **DEFERRED** | `v4-calcom-booking.md` |
| V5 | WebRTC connects from the browser | **PARTIAL** | `v5-webrtc-connect.md` |
| V6 | Tool round trip under 3s | **DEFERRED** | `v6-tool-latency.md` |
| V7 | KB indexes with RAG over 500 bytes | **PASS** | `v7-rag-indexing.md` |

Four pass, one partial, two deferred. No fallback was taken on any check, so no disclosure is owed in `docs/CLAIMS.md` at this point.

## Why the three unresolved checks are unresolved

**V5, partial.** A real WebRTC handshake needs the browser SDK, which needs the Next.js scaffold that Phase 1 creates. The token mint half was verified at zero cost. The mitigation, pinning `livekit-client` to 2.16.1, is adopted up front rather than after a failure. Blast radius of a failure is one line inside the SPEC.md §6.7 adapter seam.

**V4 and V6, deferred.** Cal.com's Cloudflare bot management challenges every request from this machine, including the unauthenticated site root, so the API key was never evaluated. Not a plan gate, not a key problem, not fixable with headers. For V6 the deferral is an improvement, since the 2500ms budget describes a Vercel function calling Cal.com and a laptop measurement never applied to it.

## What this means for proceeding

Proceeding to Phase 1 is defensible, and the reason is that Phase 1 resolves all three near its start rather than its end:

- SPEC.md §8 Phase 1 already creates the Vercel project and deploys early so tool URLs point at a stable domain.
- SPEC.md §11.2 already makes a real Cal.com booking the Phase 1 gate, which is V4.
- V6 is measured from that same deployment.
- V5 resolves at the Phase 2 gate on the first real voice run.

**One ordering constraint, and it is not optional.** V4 carries a residual risk that Cal.com also challenges Vercel's datacenter egress, which would block the entire booking path. The first Cal.com work in Phase 1 is a single deployed route calling `GET /v2/slots`, checked for a 200, before `src/lib/cal.ts` is built out. Building the client first and discovering the block afterwards is the exact failure this sweep exists to prevent, and the sweep could not prevent it here.

## Carried forward into Phase 1 and Phase 2

Findings that constrain later work, each sourced from the record that produced it:

1. **`response_timeout_secs` minimum is 5** on ElevenLabs tools. Tool JSON declares 5, our route budget stays 3. From V2.
2. **A `POST` tool requires `request_body_schema`.** Both SPEC.md §4.1 tools are POST. From V2.
3. **The shared secret in `api_schema.request_headers` is accepted.** Confirms the `x-vd-tool-secret` design. From V2.
4. **Workspace webhook create body nests under `settings`**, and registering the webhook is separate from setting `post_call_webhook_id`. Missing the second step means deliveries never fire. From V1.
5. **The API key needs Webhooks access**, a single toggle rather than split read and write. Already enabled. From V1.
6. **All Phase 2 prompt iteration is free** through `simulate-conversation`, so the 15 voice minutes stay intact for the Phase 2 gate run and the Phase 4 recording. From V3.
7. **RAG retention is 10 days on this workspace** and free tier indexed content is capped at 1MB. A demo left idle may need its index recomputed before a vetting call. Belongs in `docs/DEPLOY_CHECKLIST.md`. From V7.
8. **Cal.com is unreachable from the development machine.** Vitest coverage of the Cal.com client mocks `fetch`. Live checks run against the deployed URL only. From V4.

## Open item that affects the claims boundary

`rag_retrieval_info` came back null on every turn of the simulated conversation, so it is established that the document is RAG indexed but not that retrieval fires at runtime rather than the platform inlining the document. Until a live conversation shows a retrieval with chunks, `docs/CLAIMS.md` should say the knowledge base is a controlled, RAG indexed document and should not assert that every answer was retrieved. Re testable at the Phase 2 gate. From V7.

## Remote state as left by Phase 0

| Entity | Value |
|---|---|
| Agent | `agent_1401kz0x1h1xfsk8x4vh5hxpjezg`, renamed `VoxDesk Concierge` |
| System prompt | applied from `agent/prompts/system.md`, 4919 bytes |
| Knowledge base document | `CgTt6RU8cZj1519ZGoUU`, 3845 bytes |
| RAG index | `ZUXaCwee9tnYAo5BoPxw`, `succeeded`, `e5_mistral_7b_instruct` |
| Tools | none, Phase 2 |
| Workspace webhooks | none, both probes deleted |
| Voice minutes consumed | zero |

Prompt and knowledge base were pushed from the repo files via API, never hand edited in the dashboard, which holds BLUEPRINT.md §9 anti pattern 3 from the first commit. Phase 2 formalises this as `pnpm agent:push`.
