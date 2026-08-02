# Next.js route handlers on Vercel

**Date:** 2026-08-02
**Phase:** 0, decisions log seed, BLUEPRINT.md §15
**Status:** settled before build

## Decision

Next.js route handlers on Vercel.

## Alternative rejected

FastAPI on a free Python host.

## Reason

Free Python hosts cold start in the tens of seconds. The tool routes run synchronously inside a live conversation, so a cold start means the caller sits in silence mid sentence while the agent waits. Vercel functions warm in well under the SPEC.md §6.2 budget of 3s.

## Note

This is the answer to 'why not Python for an AI project'. The constraint is not language preference, it is that a human is waiting on the other end of the call.
