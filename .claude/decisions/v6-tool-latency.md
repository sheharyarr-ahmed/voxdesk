# V6 · Tool round trip under 3s with Cal.com latency included

**Date:** 2026-08-03
**Phase:** 0, verification sweep, SPEC.md §9
**Verdict:** PASS with a stated caveat. Measured on a worse network path than production, with a 4x margin.

Supersedes the earlier deferral in this file's history, which was written when Cal.com appeared unreachable.

## Question

SPEC.md §6.2 requires every tool route to answer within 3s, with the Cal.com fetch carrying `AbortSignal.timeout(2500)`. Does real Cal.com latency fit inside that budget?

## Measurement

Ten sequential `GET /v2/slots` calls from Chrome on the development machine in Rawalpindi, same origin against `api.cal.com`, event type 5725517, five day window, `Asia/Karachi`.

```
samples (ms, sorted):
  367, 372, 374, 379, 383, 384, 393, 408, 544, 609

p50: 384 ms
p95: 609 ms
```

Against the 2500 ms upstream budget: **p95 leaves a 4.1x margin**. Against the 3s route budget, 4.9x.

## Why this is a pass despite not being the production path

The budget describes a Vercel function calling `api.cal.com`. This measured a laptop in Rawalpindi calling `api.cal.com`, which is a **worse** path on every axis that matters: further from Cal.com's infrastructure, over consumer transit rather than datacenter peering, with a longer TLS handshake.

A worse path clearing the budget by more than 4x is meaningful evidence that the better path clears it too. The remaining uncertainty is directional and favourable, which is not the situation that would justify holding the check open.

Two caveats stated rather than buried:

1. **This is a floor, not the production number.** Phase 1 re measures from the deployed function and records the real figure. If that number is worse than expected the design still holds, see below.
2. **Conditional on V4's open half.** If Cal.com challenges Vercel's egress, latency is irrelevant because there is no response at all. That risk is tracked in `v4-calcom-booking.md` and is the first thing Phase 1 tests.

## The design does not depend on this number anyway

SPEC.md §6.2 is built so latency is a tuning input rather than a load bearing assumption. Three mechanisms absorb a slow upstream:

1. **The fetch aborts at 2500 ms**, inside the 3s route budget, so the route always answers.
2. **Abort is a structured outcome, not an exception.** The route returns HTTP 200 with `{ ok: false, reason: 'upstream_timeout', speak: '...' }`, so the agent reads a sentence written in advance rather than improvising. A non 2xx would make it improvise.
3. **The row is still written.** `tool_invocations` records the real `latency_ms` and `status_code` even on timeout, so a slow upstream is visible in the dashboard a prospect inspects rather than silently absent.

Plus the 60s module scope cache keyed by `${date}|${timezone}`, which absorbs the agent re checking availability inside one conversation. At a 384 ms p50 the cache is a courtesy rather than a necessity, which is a comfortable place to be.

## Phase 1 re measurement

From the deployed function, not locally:

1. Ten sequential `GET /v2/slots` calls, p50 and p95.
2. The same after cache warm, confirming the 60s cache returns without a network hop.
3. End to end `POST /api/tools/availability`, which is what ElevenLabs actually experiences and is the only number that includes our own overhead.

If upstream p95 exceeds 2500 ms there, the SPEC.md §9 fallback is to widen the cache window. Record that as the fallback taken rather than raising the abort, since raising it eats the 3s route budget.

Note the platform side ceiling from V2: `response_timeout_secs` has a minimum of 5 on ElevenLabs, so the tool definition declares 5 while our own budget stays 3. Not a conflict. The platform value is the outer bound before the agent gives up; ours is the promise the route keeps.
