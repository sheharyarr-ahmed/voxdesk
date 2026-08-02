# WebRTC as the browser transport

**Date:** 2026-08-02
**Phase:** 0, decisions log seed, BLUEPRINT.md §15
**Status:** settled before build

## Decision

WebRTC as the browser transport.

## Alternative rejected

WebSocket.

## Reason

WebRTC is the platform default for voice and handles jitter, packet loss, and echo control that a raw WebSocket does not.

## Note

Fallback is `connectionType: 'websocket'`, plus the known `livekit-client` 2.16.1 pin for the `/rtc/v1` 404 handshake failure. Both sit behind the SPEC.md §6.7 adapter seam in `src/lib/voice/use-elevenlabs-session.ts`, so switching transport is a one line edit that reaches no other file. See v5-webrtc-connect.md for the Phase 0 result and why the handshake itself is verified at Phase 2.
