'use client';

/**
 * The only file in the tree that imports the ElevenLabs SDK.
 *
 * Connection 1 of SPEC.md section 2: the browser talks to ElevenLabs directly over
 * WebRTC and our server is never in the audio path. Connection 2 is the token mint just
 * below, which is the only reason this file calls our own origin at all.
 *
 * The agent carries `enable_auth: true` since Phase 2, so a conversation cannot start
 * without a token from `POST /api/session`. The private WebRTC session config accepts
 * `conversationToken` and forbids `agentId`, which is why no agent id reaches this bundle.
 */
import { createElement, useCallback, useEffect, useReducer, useRef } from 'react';

import { ConversationProvider, useConversation } from '@elevenlabs/react';

import { SessionResponse } from '@/lib/schemas';
import {
  initialVoiceState,
  voiceReducer,
  type VoiceSession,
  type VoiceSessionOptions,
} from '@/lib/voice/use-voice-session';

export function ElevenLabsSessionProvider({ children }: { children: React.ReactNode }) {
  return createElement(ConversationProvider, null, children);
}

/**
 * `POST /api/session` answers 200 with `{ conversationToken }` and nothing else, while
 * every failure answers `{ ok: false, reason }`. The success body carries no `ok` field,
 * so this branches on the status and never on the body. SPEC.md section 6.1.
 */
function sessionErrorMessage(status: number, body: unknown): string {
  const reason =
    typeof body === 'object' && body !== null && 'reason' in body
      ? (body as { reason?: unknown }).reason
      : undefined;

  if (reason === 'daily_cap_reached') {
    const cap =
      typeof body === 'object' && body !== null && 'cap' in body
        ? (body as { cap?: unknown }).cap
        : undefined;
    return typeof cap === 'number'
      ? `The demo is capped at ${cap} calls a day and today is spent. Try again tomorrow.`
      : 'The daily call cap is reached. Try again tomorrow.';
  }
  if (reason === 'unauthorized') {
    return 'This session expired. Reload the page and enter the passcode again.';
  }
  if (reason === 'counter_unavailable') {
    return 'The session counter is unreachable, so the call was not started. Try again shortly.';
  }
  if (reason === 'token_mint_failed') {
    return 'The voice platform did not issue a session token. Try again shortly.';
  }
  return `The session could not be started (HTTP ${status}).`;
}

export function useElevenLabsSession({ timeZone }: VoiceSessionOptions): VoiceSession {
  const [state, dispatch] = useReducer(voiceReducer, initialVoiceState);

  // The reducer decides transitions from a clock passed in, so the hook only has to
  // supply one. `performance.now()` is monotonic, which matters because these deltas are
  // reported as latencies and a wall clock can step backwards mid call.
  const now = () => performance.now();

  // `startSession` is called from an async function that outlives the render it started
  // in. This guards a dispatch landing after the visitor already hung up.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const conversation = useConversation({
    onConnect: ({ conversationId }) => {
      dispatch({ type: 'connected', conversationId, atMs: now() });
    },
    onDisconnect: () => {
      dispatch({ type: 'disconnected' });
    },
    onError: (message) => {
      dispatch({ type: 'error', message: message || 'The call ended on an error.' });
    },
    onMessage: ({ message, source }) => {
      dispatch({
        type: 'message',
        role: source === 'user' ? 'user' : 'agent',
        text: message,
        atMs: now(),
      });
    },
    onModeChange: ({ mode }) => {
      dispatch({ type: 'mode', mode: mode === 'speaking' ? 'speaking' : 'listening' });
    },
    // The SDK's tool events carry `tool_name`, `tool_call_id` and `is_error` but no
    // duration, so the round trip is timed here. This is a browser observed number and
    // is not the server measured `latency_ms` that /calls renders. docs/CLAIMS.md says so.
    onAgentToolRequest: ({ tool_name, tool_call_id }) => {
      dispatch({ type: 'tool_request', toolCallId: tool_call_id, toolName: tool_name, atMs: now() });
    },
    onAgentToolResponse: (payload) => {
      dispatch({
        type: 'tool_response',
        toolCallId: payload.tool_call_id,
        toolName: payload.tool_name,
        isError: payload.is_error,
        atMs: now(),
        result: 'full_tool_result' in payload ? payload.full_tool_result : undefined,
      });
    },
  });

  const { startSession, endSession, sendContextualUpdate } = conversation;

  const start = useCallback(() => {
    void (async () => {
      dispatch({ type: 'start_requested' });

      // Permission first, token second. A visitor who refuses the microphone should not
      // have burned a `demo_sessions` row or a minted token against the daily cap.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        if (live.current) dispatch({ type: 'mic_denied' });
        return;
      }

      if (!live.current) return;
      dispatch({ type: 'connecting' });

      let token: string;
      try {
        const response = await fetch('/api/session', { method: 'POST' });
        const body: unknown = await response.json().catch(() => null);

        if (!response.ok) {
          if (live.current) {
            dispatch({ type: 'error', message: sessionErrorMessage(response.status, body) });
          }
          return;
        }

        const parsed = SessionResponse.safeParse(body);
        if (!parsed.success) {
          if (live.current) {
            dispatch({ type: 'error', message: 'The session token came back in a shape we do not accept.' });
          }
          return;
        }
        token = parsed.data.conversationToken;
      } catch {
        if (live.current) {
          dispatch({ type: 'error', message: 'The session request did not complete. Check the connection and try again.' });
        }
        return;
      }

      if (!live.current) return;

      startSession({
        conversationToken: token,
        connectionType: 'webrtc',
        // SPEC.md section 6.4. Both tools receive this as {{visitor_timezone}}, so slots
        // are labelled in the visitor's zone and never in the server's.
        dynamicVariables: { visitor_timezone: timeZone },
      });
    })();
  }, [startSession, timeZone]);

  const stop = useCallback(() => {
    dispatch({ type: 'ending' });
    endSession();
  }, [endSession]);

  const submitEmail = useCallback(
    (email: string) => {
      // SPEC.md section 6.3. The typed address goes into the live session as context and
      // the agent retries the booking, so the voice path degrades rather than dead ends.
      sendContextualUpdate(
        `The visitor typed their email address into the page: ${email}. Use exactly this address for the booking.`,
      );
      dispatch({ type: 'email_fallback_close' });
    },
    [sendContextualUpdate],
  );

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
