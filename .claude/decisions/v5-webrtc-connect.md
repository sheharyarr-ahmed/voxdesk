# V5 · WebRTC connects from the browser

**Date:** 2026-08-02, closed 2026-08-06
**Phase:** 0, verification sweep, SPEC.md §9. Closed at the Phase 4 gate.
**Verdict:** **PASS.** A token authorised WebRTC connect from our own bundle completed and
carried a full conversation. No fallback taken, transport is `webrtc`.

The original PARTIAL verdict and its reasoning are kept below unedited, because the
scoping decision is the defensible part and rounding it up after the fact would erase it.
The closing evidence is at the end.

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

## Closing condition, corrected 2026-08-05 in Phase 2 planning

**This record previously said the verdict closes at the Phase 2 gate. That was wrong, and it is corrected here rather than discovered at the Phase 4 gate.**

V5 is specifically WebRTC from **our** browser bundle: `@elevenlabs/react` inside our Next.js build, with `livekit-client` resolved to the `2.16.1` we pinned, reached through the SPEC.md §6.7 `useVoiceSession` seam. Every one of those things is built in Phase 4. `voice-console.tsx` and `src/lib/voice/` do not exist yet. There is no browser client of ours to run a handshake from, so Phase 2 structurally cannot close this check, in the same way Phase 0 structurally could not.

The Phase 2 gate is a spoken conversation that books a real slot. It runs through the ElevenLabs dashboard test call, which the ElevenLabs quickstart describes as using their own React SDK under the hood for real time conversations. That is a genuine browser WebRTC session against this agent, and it is worth recording as a data point, but it is **their** bundle and **their** resolved dependency versions, not ours. It cannot discharge a check about our client.

Why the deferral is still small, unchanged from the original reasoning: a failure is a one line edit inside `src/lib/voice/use-elevenlabs-session.ts`, either the pin or `connectionType: 'websocket'`.

**New closing condition:** this record is updated at the **Phase 4** gate with the observed result of a session started from our own console, and the verdict moves to PASS or to FALLBACK TAKEN with the transport named.

**Evidence gathered in Phase 2, recorded but not sufficient to close:**

- The `livekit-client` 2.16.1 pin is measured rather than asserted, one resolved version reached directly and transitively, agreeing with `@elevenlabs/client@1.17.0`'s own dependency. From the Phase 1 gate record.
- Server side tool execution does not depend on the client at all. A text simulation run entirely inside the ElevenLabs backend, with no browser anywhere, reached both of our deployed tool routes and created a real Cal.com booking. Recorded in `phase-2-tool-sequence-tuning.md`. This is what made the dashboard call safe to plan on, and it is also why a V5 failure would not touch the tool layer.

---

## Closed at the Phase 4 gate, 2026-08-06

A session started from our own deployed console, through the SPEC.md §6.7 seam, with
`@elevenlabs/react` 1.12.0 and `livekit-client` resolved to the pinned `2.16.1`.

```
conv_3901kzbgzjtner8vj1kx8hke7rzb   status done   29 s   3 messages   call_successful: success
```

Every element the corrected closing condition demanded is present. Our bundle, our pinned
dependency, our adapter seam, a token minted by our own `POST /api/session` under
`enable_auth: true`, and a conversation that carried real audio in both directions rather
than a connection that merely opened.

**Both halves of the residual risk are discharged at once.** The Phase 2 record left open
whether a token authorised connect would actually work now that the agent refuses
unauthenticated conversations. It does. The token was minted server side, the browser never
saw the API key, and no agent id entered the client bundle, because the private WebRTC
session config accepts `conversationToken` and declares `agentId?: never`.

The mitigation adopted up front was never needed: the `2.16.1` pin held and no `/rtc/v1`
404 appeared. Transport is `webrtc`, not the websocket fallback.

### A correction to this record's own fallback claim

This record said twice that a failure would be a one line edit inside
`use-elevenlabs-session.ts`, either the pin or `connectionType: 'websocket'`. **The second
of those is wrong**, and it is corrected here rather than left as a trap for a future
session.

Read out of the SDK types rather than recalled: `PrivateWebSocketSessionConfig` requires a
`signedUrl` and declares `conversationToken?: never`. A conversation token cannot be used
over the websocket transport at all. So with `enable_auth: true`, switching transports also
requires `POST /api/session` to mint a signed URL from a different endpoint instead of a
token. That is a two file change, not one line.

The blast radius argument still holds, since both files are ours and neither is a route the
agent calls. But the cost was understated, and that understatement is part of why closing
this early rather than at recording time was worth 337 credits.
