'use client';

/**
 * The scripted fake behind the SPEC.md section 6.7 seam, reached only when a build is
 * compiled with `NEXT_PUBLIC_VOICE_MOCK=1`, which happens in exactly one place: the
 * Playwright web server command in `playwright.config.ts`.
 *
 * It exists so the console's state machine can be driven end to end in CI without a
 * microphone, a WebRTC handshake, or a single ElevenLabs credit. The script mirrors the
 * shape of the Phase 2 gate call rather than inventing a flow, so a passing e2e run is
 * evidence about the real sequence and not about a fiction.
 *
 * It never imports the SDK. That is the whole point of the seam.
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';

import {
  initialVoiceState,
  voiceReducer,
  type VoiceEvent,
  type VoiceSession,
  type VoiceSessionOptions,
} from '@/lib/voice/use-voice-session';

export function MockSessionProvider({ children }: { children: React.ReactNode }) {
  // The real implementation needs a ConversationProvider. The fake needs nothing, and
  // saying so explicitly keeps the two providers interchangeable at the call site.
  return children;
}

const MOCK_CONVERSATION_ID = 'conv_mock000000000000000000000000';

/**
 * The script carries its own offsets, so each step declares the event without a clock
 * and the clock is stamped at fire time. `Omit` has to distribute across the event union
 * by hand here: applied to the union directly it collapses to the keys every member
 * shares, which is only `type`.
 */
type WithoutClock<T> = T extends { atMs: number } ? Omit<T, 'atMs'> : T;

/** Offsets are from the moment the connection lands, in milliseconds. */
type ScriptedStep = { atMs: number; event: WithoutClock<VoiceEvent> };

const SCRIPT: ScriptedStep[] = [
  { atMs: 150, event: { type: 'mode', mode: 'speaking' } },
  {
    atMs: 200,
    event: {
      type: 'message',
      role: 'agent',
      text: 'You are through to the SheryLabs concierge. What are you building?',
    },
  },
  { atMs: 800, event: { type: 'mode', mode: 'listening' } },
  {
    atMs: 900,
    event: {
      type: 'message',
      role: 'user',
      text: 'I want a voice agent that answers questions on my site and books demos.',
    },
  },
  { atMs: 1300, event: { type: 'mode', mode: 'speaking' } },
  {
    atMs: 1400,
    event: {
      type: 'message',
      role: 'agent',
      text: 'That is a production build. Shall I look at what is open this week?',
    },
  },
  { atMs: 1900, event: { type: 'mode', mode: 'listening' } },
  { atMs: 2000, event: { type: 'message', role: 'user', text: 'Yes, what times do you have?' } },
  {
    atMs: 2200,
    event: { type: 'tool_request', toolCallId: 'mock_avail_1', toolName: 'check_availability' },
  },
  {
    atMs: 2600,
    event: {
      type: 'tool_response',
      toolCallId: 'mock_avail_1',
      toolName: 'check_availability',
      isError: false,
    },
  },
  {
    atMs: 2750,
    event: {
      type: 'message',
      role: 'agent',
      text: 'I have three thirty, three forty five, or four in the afternoon.',
    },
  },
  { atMs: 3200, event: { type: 'message', role: 'user', text: 'The first one works.' } },
  {
    atMs: 3450,
    event: { type: 'tool_request', toolCallId: 'mock_book_1', toolName: 'book_meeting' },
  },
  {
    atMs: 4150,
    event: {
      type: 'tool_response',
      toolCallId: 'mock_book_1',
      toolName: 'book_meeting',
      isError: false,
    },
  },
  {
    atMs: 4300,
    event: {
      type: 'message',
      role: 'agent',
      text: 'You are booked. A calendar invitation is on its way.',
    },
  },
];

export function useMockSession(_options: VoiceSessionOptions): VoiceSession {
  void _options;
  const [state, dispatch] = useReducer(voiceReducer, initialVoiceState);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const start = useCallback(() => {
    clearTimers();
    dispatch({ type: 'start_requested' });

    // Two frames of "connecting" so the console's transitional states are observable to
    // a test rather than skipped over in one tick.
    timers.current.push(
      setTimeout(() => dispatch({ type: 'connecting' }), 100),
      setTimeout(() => {
        dispatch({ type: 'connected', conversationId: MOCK_CONVERSATION_ID, atMs: performance.now() });

        SCRIPT.forEach((step) => {
          timers.current.push(
            setTimeout(() => {
              dispatch({ ...step.event, atMs: performance.now() } as VoiceEvent);
            }, step.atMs),
          );
        });
      }, 400),
    );
  }, [clearTimers]);

  const stop = useCallback(() => {
    clearTimers();
    dispatch({ type: 'ending' });
    timers.current.push(setTimeout(() => dispatch({ type: 'disconnected' }), 120));
  }, [clearTimers]);

  const submitEmail = useCallback((email: string) => {
    dispatch({
      type: 'message',
      role: 'user',
      text: `Typed into the page: ${email}`,
      atMs: performance.now(),
    });
    dispatch({ type: 'email_fallback_close' });
  }, []);

  return {
    status: state.status,
    mode: state.mode,
    entries: state.entries,
    conversationId: state.conversationId,
    error: state.error,
    emailFallbackOpen: state.emailFallbackOpen,
    start,
    stop,
    openEmailFallback: useCallback(() => dispatch({ type: 'email_fallback_open' }), []),
    dismissEmailFallback: useCallback(() => dispatch({ type: 'email_fallback_close' }), []),
    submitEmail,
  };
}
