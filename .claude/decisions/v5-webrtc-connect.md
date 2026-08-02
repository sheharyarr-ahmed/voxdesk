# V5 · WebRTC connects from the browser

**Date:** 2026-08-02
**Phase:** 0, verification sweep, SPEC.md §9
**Verdict:** PARTIAL. Auth half proven, handshake deferred to Phase 2, mitigation adopted up front.

This one is not recorded as a pass. The honest state is written out below rather than rounded up.

## Question

Connection 1 of SPEC.md §2 is the browser talking directly to ElevenLabs over WebRTC via `@elevenlabs/react`. If that handshake does not complete, the whole architecture changes shape.

## Why this was scoped down

A real WebRTC handshake needs the browser SDK, which needs `node_modules`, which needs the Next.js scaffold that Phase 1 creates. Phase 0 has no `package.json` by design, and building one would touch files outside the phase file list. The SPEC.md §9 instruction to run all seven checks "before any application code" is not satisfiable for this check as literally written.

Scoped decision, taken deliberately: verify the half that can be verified today at zero cost, and pre commit the mitigation for the half that cannot.

## What was verified

Connection 2, the server side session token mint, which is the precondition for the handshake:

```
GET /v1/convai/conversation/token?agent_id=agent_1401kz0x1h1xfsk8x4vh5hxpjezg
  -> http=200  time=0.73s
  token: eyJhbGciOiJI...KtE9zk  (1039 chars, JWT)
  conversation_id: conv_3301kz1...y8wey7  (33 chars)
```

This establishes three things. The `xi-api-key` in `.env.local` carries Agents scope, so the SPEC.md §6.1 flow of `POST /api/session` minting a token server side will work. The agent id resolves. And a conversation token is issued on a free workspace without a tier rejection.

Zero voice minutes consumed. No repo files created.

## What was not verified

The ICE negotiation and media path between the browser and the ElevenLabs LiveKit stack. That runs at the Phase 2 gate.

## Mitigation adopted now rather than after a failure

SPEC.md §6.8 and BLUEPRINT.md §8 both record that `livekit-client` newer than `2.16.1` has failed the handshake with `/rtc/v1` 404s. Rather than wait to hit it, Phase 1 pins `livekit-client` to exactly `2.16.1` in `package.json` at scaffold time.

Second fallback if the pin is not sufficient: `connectionType: 'websocket'` on `startSession`. Both fallbacks live behind `src/lib/voice/use-elevenlabs-session.ts`, which is the only file in the tree that touches the SDK, so either change is a one line edit inside the SPEC.md §6.7 adapter seam and does not reach the console or any route.

Workspace setting observed today, relevant if the handshake does misbehave: `GET /v1/convai/settings` reports `default_livekit_stack: "standard"`.

## Blast radius of the deferral

Small, which is why the deferral is acceptable where the V4 deferral would not have been. A V5 failure changes one line inside one adapter file. A V4 failure would have changed both tool contracts in SPEC.md §4.1, the two route handlers, and the agent prompt.

## Closing condition

This record is updated at the Phase 2 gate with the observed result of a real browser session, and the verdict moves to PASS or to FALLBACK TAKEN with the transport named. Until then Phase 0 closes with six of seven checks resolved and this one explicitly open.
