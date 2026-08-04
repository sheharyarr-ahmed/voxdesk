# V6 · Tool round trip under 3s with Cal.com latency included

**Date:** 2026-08-03, production number taken 2026-08-04
**Phase:** 0, verification sweep, SPEC.md §9
**Verdict:** **PASS, caveat discharged.** Measured at 4.1x margin from the development machine, then re measured from the deployed `iad1` function at **13.4x**. Both caveats below are now closed.

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

## Phase 1 re measurement, taken 2026-08-04

Ten sequential `GET /v2/slots` from the deployed function in `iad1`, same event type `5725517`, three day window, `Asia/Karachi`. Full context in `phase-1-cal-egress-probe.md`.

```
samples (ms, sorted): 88, 89, 106, 109, 111, 115, 115, 116, 120, 187

p50: 111 ms
p95: 187 ms
```

| Path | p50 | p95 | margin on the 2500 ms abort |
|---|---|---|---|
| Rawalpindi laptop, 2026-08-03 | 384 ms | 609 ms | 4.1x |
| `iad1` function, 2026-08-04 | **111 ms** | **187 ms** | **13.4x** |

Against the 3s route budget the p95 margin is 16x. Caveat 1 is discharged: the laptop figure was a floor, and production is roughly three times faster on both percentiles, exactly as predicted. Caveat 2 is discharged by V4 closing, since Cal.com does serve Vercel's egress.

**No fallback taken.** Upstream p95 is nowhere near 2500 ms, so the 60s cache window in SPEC.md §6.2 stays as written and nothing is owed in `docs/CLAIMS.md`.

Two measurements from the original plan are deferred to the Phase 1 gate rather than skipped, because neither existed yet when this number was taken: the cache warm path returning without a network hop, which `tests/unit/slots.test.ts` asserts directly, and the end to end `POST /api/tools/availability` figure, which is the only number that includes our own overhead and is recorded from the SPEC.md §11.2 curl.

Note the platform side ceiling from V2: `response_timeout_secs` has a minimum of 5 on ElevenLabs, so the tool definition declares 5 while our own budget stays 3. Not a conflict. The platform value is the outer bound before the agent gives up; ours is the promise the route keeps.
