# Phase 2 · The testing surface is metered. V3 does not carry over

**Date:** 2026-08-05
**Phase:** 2
**Status:** V3's zero cost finding is **retired for the surface Phase 2 actually uses.** It remains true of the endpoint it measured.

## What V3 measured and what it warned about

V3 measured `POST /v1/convai/agents/{id}/simulate-conversation` and found it registered against no metered surface at all: character count unchanged, no conversation record, nothing in product type usage. Phase 0 finding 9 turned that into a plan, "all Phase 2 prompt iteration is free".

V3 also wrote down the thing that saved us here: the endpoint carries a deprecation notice pointing at `/v1/convai/agent-testing/create` and `/v1/convai/agents/{id}/run-tests`, and if it is withdrawn "the zero cost finding should be re-measured against them rather than assumed to carry over".

## Re-measured, and it does not carry over

`simulate-conversation` is still deprecated, now explicitly: "Use the `/v1/convai/agent-testing/create` and `/v1/convai/agents/:agent_id/run-tests` endpoints to create and run simulations." Phase 2 uses the replacement, because a suite of committed tests is the point.

The same three instruments V3 used, read either side of one `run-tests` invocation of five simulations:

| Instrument | Before | After |
|---|---|---|
| `subscription.character_count` | 0 of 10000 | **3779 of 10000** |
| `usage/character-stats`, product type | `{}` | `{"Conversational AI": [... 1410 ...]}` |
| `convai/conversations` | 0 | 0 |

So the new surface **is** metered, at roughly **640 credits per simulated conversation**. It still creates no conversation record, which is why the conversation count is unchanged and why this would have been easy to miss by watching the wrong instrument.

## Why this matters more than it looks

There is one pool. `GET /v1/user/subscription` reports a single `character_count` of `character_limit` 10000 with no separate minutes counter, and Agents usage posts into it under the "Conversational AI" product type. The free plan's "15 minutes" is that same 10000 credits at the Agents conversion rate, near enough 667 credits per minute.

Text iteration and the voice budget are therefore the **same** budget. SPEC.md §8's minute ledger assumed they were not.

## What changed because of it

1. **Tests became individually selectable.** `pnpm agent:test --only=a,b`. Re-running five tests after every prompt edit costs about 3200 credits, and there were four edit cycles. Iterating on only what failed is the difference between finishing this phase and running out.
2. **The ledger is restated honestly.** Phase 2 spent 7565 credits reaching a green suite, which is roughly 11 minutes equivalent against a nominal 15, leaving 2435 for the gate call. That is enough for a call under three minutes and no retake. The quota resets 2026-08-29, which is what SPEC.md §8 already schedules Phases 3 and 4 behind.
3. **A claim is retired.** Nothing may say prompt iteration on this build was free. It was free on the endpoint V3 measured and is not free on the one that replaced it.

## What was not re-measured

Whether `simulate-conversation` is still free today. It very likely is, since nothing suggests it changed, but it is deprecated and the suite is the better instrument, so there was no reason to spend credits proving a fact about an endpoint this build does not use.

## Alternative rejected

Staying on `simulate-conversation` to keep iteration free. It would have bought about 3000 credits and cost the ability to commit the tests, attach them to the agent, mock a tool response deterministically, or re-run them after a later prompt edit. The deterministic tool mock is what caught the reconciliation inversion, and that defect would otherwise have shipped. Paying for the instrument that finds the bug is the correct trade.
