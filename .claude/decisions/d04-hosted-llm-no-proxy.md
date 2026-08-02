# ElevenLabs hosted LLM

**Date:** 2026-08-02
**Phase:** 0, decisions log seed, BLUEPRINT.md §15
**Status:** settled before build

## Decision

ElevenLabs hosted LLM.

## Alternative rejected

A custom LLM proxy behind an OpenAI compatible endpoint, or a LangGraph orchestrator.

## Reason

The binding constraint on this build is zero cash. A hosted LLM adds no provider, no key, and no failure surface. The bridge pattern is supported by the platform and is described in docs/ARCHITECTURE.md as a path rather than built.

## Note

The agent currently runs gemini-2.5-flash, the free tier default. If a client needs their own model or their own orchestration, the swap point is documented and is a configuration change, not a rewrite.
