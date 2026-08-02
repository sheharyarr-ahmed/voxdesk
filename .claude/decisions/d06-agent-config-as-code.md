# Agent configuration held as versioned code

**Date:** 2026-08-02
**Phase:** 0, decisions log seed, BLUEPRINT.md §15
**Status:** settled before build

## Decision

Agent configuration held as versioned code.

## Alternative rejected

Configuring the agent by hand in the ElevenLabs dashboard.

## Reason

Dashboard configuration is invisible, unversioned, and unreviewable. Holding the prompt, the knowledge base document, both tool definitions, and the data collection schema in `agent/` and pushing them via API means the repo is the source of truth and a reviewer can read the agent's behaviour without an account.

## Note

Enforced as anti pattern 3 in BLUEPRINT.md §9. Phase 0 already respects it: the prompt and knowledge base were pushed from the repo files via API, never typed into the dashboard. Phase 2 formalises it as `pnpm agent:push`, which resolves entities by name so re running is idempotent.
