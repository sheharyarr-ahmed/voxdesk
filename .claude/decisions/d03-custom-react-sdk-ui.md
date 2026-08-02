# Custom React SDK frontend

**Date:** 2026-08-02
**Phase:** 0, decisions log seed, BLUEPRINT.md §15
**Status:** settled before build

## Decision

Custom React SDK frontend.

## Alternative rejected

The drop in ElevenLabs embed widget.

## Reason

The widget is what every low effort bid ships, and it is visibly a widget. Using the SDK directly through `useConversation` means the console state machine, the transcript pane, and the email fallback field are all mine, and it demonstrates SDK integration rather than script tag installation.

## Note

Cost is that the connection states, mic permission, and error handling have to be built rather than inherited. That work is the artifact.
