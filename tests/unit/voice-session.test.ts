// The SPEC.md section 6.7 seam decides every console transition in one pure reducer, so
// the states a visitor can reach are testable without a DOM, a socket or a microphone.
//
// Importing this module also loads the seam's full graph, including the SDK behind
// use-elevenlabs-session.ts, under a plain node environment. That is deliberate: if the
// SDK ever reaches for `window` at import time it breaks the unit suite here rather than
// at build time on Vercel.
import { describe, expect, it } from 'vitest';

import {
  initialVoiceState,
  isInvalidEmailRefusal,
  voiceReducer,
  type VoiceEvent,
  type VoiceState,
} from '@/lib/voice/use-voice-session';

function run(events: VoiceEvent[], from: VoiceState = initialVoiceState): VoiceState {
  return events.reduce(voiceReducer, from);
}

const connected: VoiceEvent[] = [
  { type: 'start_requested' },
  { type: 'connecting' },
  { type: 'connected', conversationId: 'conv_test', atMs: 1_000 },
];

describe('connection lifecycle', () => {
  it('walks idle to connected and records the conversation id', () => {
    const state = run(connected);
    expect(state.status).toBe('connected');
    expect(state.conversationId).toBe('conv_test');
    expect(state.startedAtMs).toBe(1_000);
  });

  it('reports a refused microphone as its own state, not as a generic error', () => {
    const state = run([{ type: 'start_requested' }, { type: 'mic_denied' }]);
    expect(state.status).toBe('mic_denied');
    expect(state.error).toContain('Microphone');
  });

  it('clears a previous transcript when a new call is started', () => {
    const first = run([
      ...connected,
      { type: 'message', role: 'agent', text: 'hello', atMs: 1_100 },
      { type: 'disconnected' },
    ]);
    expect(first.entries).toHaveLength(1);

    const second = voiceReducer(first, { type: 'start_requested' });
    expect(second.entries).toHaveLength(0);
    expect(second.conversationId).toBeNull();
  });

  it('keeps the transcript after a hangup, because /calls has no row until the webhook lands', () => {
    const state = run([
      ...connected,
      { type: 'message', role: 'agent', text: 'booked', atMs: 1_100 },
      { type: 'disconnected' },
    ]);
    expect(state.status).toBe('idle');
    expect(state.entries).toHaveLength(1);
  });

  it('does not lose an error state to a following disconnect', () => {
    const state = run([
      ...connected,
      { type: 'error', message: 'the call dropped' },
      { type: 'disconnected' },
    ]);
    expect(state.status).toBe('error');
    expect(state.error).toBe('the call dropped');
  });
});

describe('transcript', () => {
  it('offsets every turn from the moment the call connected', () => {
    const state = run([
      ...connected,
      { type: 'message', role: 'user', text: 'hi', atMs: 3_500 },
    ]);
    expect(state.entries[0]).toMatchObject({ kind: 'turn', role: 'user', atSeconds: 2.5 });
  });

  it('drops an empty message rather than rendering a blank turn', () => {
    const state = run([
      ...connected,
      { type: 'message', role: 'agent', text: '   ', atMs: 1_100 },
    ]);
    expect(state.entries).toHaveLength(0);
  });

  it('gives every entry a distinct key so React never collapses two turns', () => {
    const state = run([
      ...connected,
      { type: 'message', role: 'agent', text: 'same', atMs: 1_100 },
      { type: 'message', role: 'agent', text: 'same', atMs: 1_200 },
    ]);
    expect(new Set(state.entries.map((entry) => entry.id)).size).toBe(2);
  });
});

describe('tool latency, measured in the browser', () => {
  it('pairs a response to its request and reports the round trip', () => {
    const state = run([
      ...connected,
      { type: 'tool_request', toolCallId: 'c1', toolName: 'check_availability', atMs: 2_000 },
      {
        type: 'tool_response',
        toolCallId: 'c1',
        toolName: 'check_availability',
        isError: false,
        atMs: 2_434,
      },
    ]);

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({
      kind: 'tool',
      toolName: 'check_availability',
      latencyMs: 434,
      isError: false,
    });
    expect(state.pendingTools).toEqual({});
  });

  it('shows a pending tool with no latency yet', () => {
    const state = run([
      ...connected,
      { type: 'tool_request', toolCallId: 'c1', toolName: 'book_meeting', atMs: 2_000 },
    ]);
    expect(state.entries[0]).toMatchObject({ kind: 'tool', latencyMs: null });
  });

  it('renders a response whose request was never seen, without inventing a latency', () => {
    const state = run([
      ...connected,
      { type: 'tool_response', toolCallId: 'orphan', toolName: 'book_meeting', isError: true, atMs: 2_500 },
    ]);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({ kind: 'tool', latencyMs: null, isError: true });
  });

  it('ignores a duplicate request for one tool call id', () => {
    const state = run([
      ...connected,
      { type: 'tool_request', toolCallId: 'c1', toolName: 'book_meeting', atMs: 2_000 },
      { type: 'tool_request', toolCallId: 'c1', toolName: 'book_meeting', atMs: 2_100 },
    ]);
    expect(state.entries).toHaveLength(1);
    expect(state.pendingTools.c1?.startedAtMs).toBe(2_000);
  });

  it('never reports a negative latency when events arrive out of order', () => {
    const state = run([
      ...connected,
      { type: 'tool_request', toolCallId: 'c1', toolName: 'book_meeting', atMs: 2_500 },
      { type: 'tool_response', toolCallId: 'c1', toolName: 'book_meeting', isError: false, atMs: 2_400 },
    ]);
    expect(state.entries[0]).toMatchObject({ latencyMs: 0 });
  });
});

describe('email fallback, SPEC.md section 6.3', () => {
  it('opens on a book_meeting refusal of a mangled address', () => {
    const state = run([
      ...connected,
      {
        type: 'tool_response',
        toolCallId: 'b1',
        toolName: 'book_meeting',
        isError: false,
        atMs: 2_500,
        result: JSON.stringify({ ok: false, reason: 'invalid_email', speak: 'Could you type it?' }),
      },
    ]);
    expect(state.emailFallbackOpen).toBe(true);
  });

  it('stays closed for any other refusal reason', () => {
    const state = run([
      ...connected,
      {
        type: 'tool_response',
        toolCallId: 'b1',
        toolName: 'book_meeting',
        isError: false,
        atMs: 2_500,
        result: JSON.stringify({ ok: false, reason: 'slot_taken', speak: 'That slot went.' }),
      },
    ]);
    expect(state.emailFallbackOpen).toBe(false);
  });

  it('does not fire on a transcript that merely contains the words', () => {
    expect(isInvalidEmailRefusal('book_meeting', 'the reason was invalid_email apparently')).toBe(false);
    expect(isInvalidEmailRefusal('check_availability', JSON.stringify({ ok: false, reason: 'invalid_email' }))).toBe(false);
    expect(isInvalidEmailRefusal('book_meeting', undefined)).toBe(false);
  });

  it('can be opened and dismissed by hand, so the path never rests on one optional event', () => {
    const opened = run([...connected, { type: 'email_fallback_open' }]);
    expect(opened.emailFallbackOpen).toBe(true);
    expect(voiceReducer(opened, { type: 'email_fallback_close' }).emailFallbackOpen).toBe(false);
  });
});
