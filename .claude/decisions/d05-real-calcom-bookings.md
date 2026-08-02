# Real Cal.com bookings

**Date:** 2026-08-02
**Phase:** 0, decisions log seed, BLUEPRINT.md §15
**Status:** settled before build

## Decision

Real Cal.com bookings.

## Alternative rejected

A mocked calendar returning fabricated slots.

## Reason

A mock makes the whole tool layer theatre. The write to a real calendar is the proof that the agent takes actions rather than describing them. It is also the single most inspectable thing in the demo: a prospect can watch the invite arrive.

## Note

This is why V4 in the SPEC.md §9 sweep is blocking rather than deferrable. If booking creation were not permitted, both tool contracts in SPEC.md §4.1 would change shape.
