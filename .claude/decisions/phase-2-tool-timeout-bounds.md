# Phase 2 · Deviation 14, three timeout bounds and why they differ

**Date:** 2026-08-05
**Phase:** 2

## The numbers

```
                     upstream abort   route budget   platform ceiling   margin
check_availability        2500 ms         2800 ms          5 s          2.2 s
book_meeting              4000 ms         4300 ms         10 s          5.7 s
```

Three different things, which is why they are three different numbers.

- **Upstream abort** is a promise to Cal.com's client: stop waiting and turn the wait into a structured outcome.
- **Route budget** is a promise to the agent: this route always answers, and `withToolLogging` enforces it.
- **Platform ceiling** is `response_timeout_secs`, the longest ElevenLabs will wait before it gives up on us.

## What changed from the plan

V2 established that `response_timeout_secs` has a platform **minimum** of 5, and Phase 0 finding 1 recorded "tool JSON declares 5, our route budget stays 3". Both tool files were expected to declare 5.

Two things happened after that was written.

**Deviation 13 raised `book_meeting`'s route budget to 4.3 s.** An aborted `POST /v2/bookings` still creates the booking upstream, so the original 2500 ms abort sat on the failure boundary and turned a slow answer into a double booking.

**The range is 5 to 120, not a fixed 5.** The API reference for webhook tools states "Must be between 5 and 120 seconds (inclusive)". V2 only ever saw the lower bound, because it only ever tripped over it.

## The decision

`check_availability` declares 5. `book_meeting` declares 10.

At 5, `book_meeting` has about 700 ms of margin for network transit plus the awaited `tool_invocations` write. Blowing that ceiling is not a slow answer: ElevenLabs abandons the request, the agent receives no structured body at all, and it improvises about a booking that may already exist on the calendar. That is precisely the double booking deviation 13 was written to prevent, reintroduced one layer up.

Raising the ceiling costs nothing. It is a maximum wait, not a fixed one. The route still answers by 4.3 s, so in every non pathological case the agent waits exactly as long as it waited before. The only behaviour that changes is the one we do not want: the platform pulling the plug while our answer is in flight.

## Alternative rejected

Declaring 5 on both, for symmetry with V2's record and because two identical numbers read more cleanly than two different ones. Symmetry is not a reason. The two tools have different risk profiles, which is already why deviation 13 gave them different route budgets, and matching the ceiling to the risk is the same argument applied one layer out.

## Also set on `book_meeting`, and worth recording

`force_pre_tool_speech: true`. The booking write runs 2.1 s to 2.9 s upstream. Silence that long mid conversation reads as a broken agent, so it speaks before it waits. `check_availability` runs at a 187 ms p95 and does not need it.
