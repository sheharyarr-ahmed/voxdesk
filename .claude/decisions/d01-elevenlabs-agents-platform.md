# ElevenLabs Agents as the speech platform

**Date:** 2026-08-02
**Phase:** 0, decisions log seed, BLUEPRINT.md §15
**Status:** settled before build

## Decision

ElevenLabs Agents as the speech platform.

## Alternative rejected

Self built pipeline: separate speech to text, LLM, and text to speech, with turn taking written by hand.

## Reason

Buyers search for the platform by name. A job posting says ElevenLabs, or Vapi, or Retell. Rebuilding the stack from parts matches no posting and takes weeks to reach the quality the platform gives on day one. Turn taking and interruption handling in particular are the hard part, and they are solved.

## Note

The tradeoff is that the speech loop is not mine, and SPEC.md §12 says so plainly. The layer that is mine is the tool contracts, the calendar integration, the signature verification, the data model, and the conversation design.
