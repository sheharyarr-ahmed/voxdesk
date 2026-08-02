# Passcode gated voice demo

**Date:** 2026-08-02
**Phase:** 0, decisions log seed, BLUEPRINT.md §15
**Status:** settled before build

## Decision

Passcode gated voice demo.

## Alternative rejected

An open public demo anyone can talk to.

## Reason

The free plan carries 15 voice minutes per month. One curious visitor holding a conversation drains a meaningful share of that, and ten tabs drains the month. The gate is not a security posture, it is a quota defence, and SPEC.md §6.1 layers a Postgres backed session counter behind it because a cookie alone does not stop one person with the passcode.

## Note

It also happens to be the stronger sales motion. The live session is opened during a vetting call, where it is watched, rather than left running unattended.
