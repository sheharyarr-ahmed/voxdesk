# V6 · Tool round trip under 3s with Cal.com latency included

**Date:** 2026-08-03
**Phase:** 0, verification sweep, SPEC.md §9
**Verdict:** DEFERRED to the Phase 1 deploy. Measurement moved to the environment it actually describes.

## Question

SPEC.md §6.2 requires every tool route to answer within 3s, with the Cal.com fetch carrying `AbortSignal.timeout(2500)`. Does real Cal.com latency fit inside that budget?

## Why this could not be measured here, and why that is fine

Blocked by the same Cloudflare interception documented in `v4-calcom-booking.md`. Every request to Cal.com from this machine returns 403 with `cf-mitigated: challenge` before reaching the API, so no timing sample exists.

The more useful point is that a local measurement would have been the wrong measurement. The 2500ms budget describes a Vercel function calling `api.cal.com`. Timing that hop from a laptop in Rawalpindi measures a different network path with different geography, a different peering route, and a different TLS termination point. Even with a working curl, the resulting p50 and p95 would not have applied to the budget they were being compared against.

So this check does not lose fidelity by moving to Phase 1. It gains it.

## What the design already does, independent of the number

The SPEC.md §6.2 policy is built so that the number is a tuning input rather than a load bearing assumption. Three mechanisms absorb a slow upstream:

1. **The fetch aborts at 2500ms**, inside the 3s route budget, so the route always answers.
2. **Abort is a structured outcome, not an exception.** The route returns HTTP 200 with `{ ok: false, reason: 'upstream_timeout', speak: '...' }`, so the agent reads a sentence written in advance rather than improvising. A non 2xx would make it improvise.
3. **The row is still written.** `tool_invocations` records the real `latency_ms` and `status_code` even on timeout, so a slow upstream is visible in the dashboard that a prospect inspects rather than silently absent.

Plus a 60s module scope cache keyed by `${date}|${timezone}`, which absorbs the common case of the agent re-checking availability inside one conversation.

A slow Cal.com therefore degrades the demo rather than breaking it. That property is what makes the deferral safe.

## What Phase 1 must measure

From the deployed Vercel function, not locally:

1. Ten sequential `GET /v2/slots` calls, reporting p50 and p95.
2. The same after cache warm, confirming the 60s cache returns without a network hop.
3. End to end `POST /api/tools/availability` latency, which is what ElevenLabs actually experiences.

Threshold: if upstream p95 exceeds 2500ms, the SPEC.md §9 fallback is to widen the cache window. Record that as the fallback taken rather than raising the abort, since raising it eats the 3s route budget and the platform tool timeout minimum is 5s per `v2-webhook-tools-free-tier.md`.

Note the platform side ceiling from V2: `response_timeout_secs` has a minimum of 5 on ElevenLabs, so the tool definition declares 5 while our own budget stays 3. Those are not in conflict. The platform value is the outer bound before the agent gives up; ours is the promise the route keeps.

## Closing condition

Updated at the Phase 1 gate with p50 and p95 measured from the deployed function. Verdict moves to PASS or to FALLBACK TAKEN with the widened cache window recorded.
