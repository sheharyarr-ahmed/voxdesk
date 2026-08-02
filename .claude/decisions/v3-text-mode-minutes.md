# V3 · Does text only mode consume voice minutes

**Date:** 2026-08-02
**Phase:** 0, verification sweep, SPEC.md §9
**Verdict:** PASS for the simulation surface. Prompt iteration is free. Scope limit stated below.

## Question

The free plan carries 15 voice minutes per month and the SPEC.md §8 minute ledger spends zero of them in Phases 0 and 1. If text iteration is metered, Phase 2 tuning has to be cut to a single run. If it is free, all prompt work moves to text and the entire quota is preserved for the demo recording.

## Method

Measured, not inferred. The account had never been used, so the baseline was genuinely zero and any delta is attributable to the one action taken between the two snapshots.

Three instruments, read before and after a full five turn text conversation run through
`POST /v1/convai/agents/{agent_id}/simulate-conversation`:

1. `GET /v1/usage/character-stats?breakdown_type=product_type` over a 30 day window
2. `GET /v1/convai/conversations`
3. `GET /v1/user/subscription`

## Evidence

| Instrument | Before | After |
|---|---|---|
| `usage/character-stats` | `{"usage":{}}` | `{"usage":{}}` |
| `convai/conversations` | `count: 0` | `count: 0` |
| `subscription.character_count` | `0 of 10000` | `0 of 10000` |

The conversation itself completed normally: `http=200` in 11.1s, five turns, `analysis.call_successful: "success"`.

## Result

A simulated text conversation registers against no metered surface visible on this account. It does not create a conversation record, does not consume characters, and does not appear in product type usage.

**Consequence for Phase 2:** all qualification flow and tool sequencing iteration runs through `simulate-conversation`. The full 15 minute quota is preserved for the single scripted voice run at the Phase 2 gate and the Phase 4 demo recording, with the 3 reserve minutes for live vetting demos intact.

## Scope limit, stated rather than glossed

This measures the **simulation** endpoint, which is a distinct product surface from live Chat mode. Public ElevenLabs pricing material indicates text messages in live Chat mode bill at roughly 0.003 USD each rather than against call minutes. That was not tested here, because simulation covers the actual need. The claim is therefore narrow: simulation is free and is the correct iteration tool. It is not a claim that all text interaction is free.

A second limitation: `simulate-conversation` carries a deprecation notice pointing at `/v1/convai/agent-testing/create` and `/v1/convai/agents/{id}/run-tests`. It returned 200 today. If it is withdrawn before Phase 2, the newer testing endpoints are the migration target and the zero cost finding should be re-measured against them rather than assumed to carry over.
