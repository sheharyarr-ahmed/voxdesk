/**
 * The SPEC.md section 6.7 adapter seam.
 *
 * Everything above this file talks to a `VoiceSession`. Only the two files beside it
 * know whether that session is a real WebRTC conversation or a scripted fake, and only
 * `use-elevenlabs-session.ts` imports the SDK. That is what lets Playwright drive the
 * whole console with zero ElevenLabs traffic and zero voice minutes.
 *
 * The reducer below is exported and pure on purpose. Every state transition the console
 * can make is decided here, with the clock passed in rather than read, so the transitions
 * are unit testable without a DOM, a socket or a microphone.
 */
import { ElevenLabsSessionProvider, useElevenLabsSession } from '@/lib/voice/use-elevenlabs-session';
import { MockSessionProvider, useMockSession } from '@/lib/voice/use-mock-session';

export type VoiceStatus =
  | 'idle'
  | 'requesting_mic'
  | 'mic_denied'
  | 'connecting'
  | 'connected'
  | 'ending'
  | 'error';

export type VoiceMode = 'listening' | 'speaking';

/**
 * One row in the live transcript. Tool rows are interleaved with spoken turns rather
 * than kept in a second column, because during a call the interesting thing is the
 * ordering: the agent said it would check, then it checked, then it read back slots.
 */
export type TranscriptEntry =
  | { kind: 'turn'; id: string; role: 'user' | 'agent'; text: string; atSeconds: number }
  | {
      kind: 'tool';
      id: string;
      toolName: string;
      atSeconds: number;
      latencyMs: number | null;
      isError: boolean;
    };

export type VoiceSessionOptions = {
  /** IANA zone read from the browser, sent to the agent as `visitor_timezone`. */
  timeZone: string;
};

export type VoiceSession = {
  status: VoiceStatus;
  mode: VoiceMode;
  entries: TranscriptEntry[];
  conversationId: string | null;
  /** A sentence to show the visitor. Never an upstream error body. */
  error: string | null;
  emailFallbackOpen: boolean;
  start: () => void;
  stop: () => void;
  openEmailFallback: () => void;
  dismissEmailFallback: () => void;
  submitEmail: (email: string) => void;
};

// ---------------------------------------------------------------------------
// The pure half
// ---------------------------------------------------------------------------

export type VoiceState = {
  status: VoiceStatus;
  mode: VoiceMode;
  entries: TranscriptEntry[];
  conversationId: string | null;
  error: string | null;
  emailFallbackOpen: boolean;
  startedAtMs: number | null;
  /** `tool_call_id` to the moment the request left, so the response can be timed. */
  pendingTools: Record<string, { toolName: string; startedAtMs: number }>;
  seq: number;
};

export type VoiceEvent =
  | { type: 'start_requested' }
  | { type: 'mic_denied' }
  | { type: 'connecting' }
  | { type: 'connected'; conversationId: string | null; atMs: number }
  | { type: 'message'; role: 'user' | 'agent'; text: string; atMs: number }
  | { type: 'mode'; mode: VoiceMode }
  | { type: 'tool_request'; toolCallId: string; toolName: string; atMs: number }
  | {
      type: 'tool_response';
      toolCallId: string;
      toolName: string;
      isError: boolean;
      atMs: number;
      result?: string;
    }
  | { type: 'error'; message: string }
  | { type: 'ending' }
  | { type: 'disconnected' }
  | { type: 'email_fallback_open' }
  | { type: 'email_fallback_close' };

export const initialVoiceState: VoiceState = {
  status: 'idle',
  mode: 'listening',
  entries: [],
  conversationId: null,
  error: null,
  emailFallbackOpen: false,
  startedAtMs: null,
  pendingTools: {},
  seq: 0,
};

function elapsed(state: VoiceState, atMs: number): number {
  if (state.startedAtMs === null) return 0;
  return Math.max(0, (atMs - state.startedAtMs) / 1000);
}

/**
 * True when a `book_meeting` response is our own structured refusal of a mangled
 * address. SPEC.md section 6.3: the route answers HTTP 200 with `ok: false` so the agent
 * reads our sentence, and the console reveals the typed fallback at the same moment.
 *
 * The payload is a string on the wire and is parsed defensively, because this arrives on
 * the full payload variant of the tool response event, which is not guaranteed to fire.
 * The console therefore also exposes the field manually and never depends on this alone.
 */
export function isInvalidEmailRefusal(toolName: string, result: string | undefined): boolean {
  if (toolName !== 'book_meeting' || typeof result !== 'string') return false;
  try {
    const parsed: unknown = JSON.parse(result);
    if (typeof parsed !== 'object' || parsed === null) return false;
    const body = parsed as { ok?: unknown; reason?: unknown };
    return body.ok === false && body.reason === 'invalid_email';
  } catch {
    // A non JSON payload is not a refusal we can read, and guessing from a substring
    // would fire the fallback on any transcript that merely contains the word.
    return false;
  }
}

export function voiceReducer(state: VoiceState, event: VoiceEvent): VoiceState {
  switch (event.type) {
    case 'start_requested':
      return { ...initialVoiceState, status: 'requesting_mic', seq: state.seq };

    case 'mic_denied':
      return {
        ...state,
        status: 'mic_denied',
        error: 'Microphone access was refused. Allow the microphone and start again.',
      };

    case 'connecting':
      return { ...state, status: 'connecting', error: null };

    case 'connected':
      return {
        ...state,
        status: 'connected',
        conversationId: event.conversationId,
        // The clock starts when the conversation does, so every row is offset from the
        // same zero as `time_in_call_secs` on the persisted transcript.
        startedAtMs: state.startedAtMs ?? event.atMs,
        error: null,
      };

    case 'message': {
      if (event.text.trim() === '') return state;
      const id = `turn-${state.seq}`;
      return {
        ...state,
        seq: state.seq + 1,
        entries: [
          ...state.entries,
          {
            kind: 'turn',
            id,
            role: event.role,
            text: event.text,
            atSeconds: elapsed(state, event.atMs),
          },
        ],
      };
    }

    case 'mode':
      return { ...state, mode: event.mode };

    case 'tool_request': {
      const id = `tool-${event.toolCallId}`;
      // A repeated request id would otherwise append a second row and orphan the first.
      if (state.entries.some((entry) => entry.id === id)) return state;
      return {
        ...state,
        pendingTools: {
          ...state.pendingTools,
          [event.toolCallId]: { toolName: event.toolName, startedAtMs: event.atMs },
        },
        entries: [
          ...state.entries,
          {
            kind: 'tool',
            id,
            toolName: event.toolName,
            atSeconds: elapsed(state, event.atMs),
            latencyMs: null,
            isError: false,
          },
        ],
      };
    }

    case 'tool_response': {
      const pending = state.pendingTools[event.toolCallId];
      const id = `tool-${event.toolCallId}`;
      const latencyMs = pending ? Math.max(0, Math.round(event.atMs - pending.startedAtMs)) : null;
      const rest = { ...state.pendingTools };
      delete rest[event.toolCallId];

      const known = state.entries.some((entry) => entry.id === id);
      const updated: TranscriptEntry[] = known
        ? state.entries.map((entry) =>
            entry.id === id && entry.kind === 'tool'
              ? { ...entry, latencyMs, isError: event.isError }
              : entry,
          )
        : [
            // A response with no request seen still shows, without a latency, rather
            // than being dropped. A missing row reads as "no tool ran", which is worse
            // than a row with an unknown duration.
            ...state.entries,
            {
              kind: 'tool',
              id,
              toolName: event.toolName,
              atSeconds: elapsed(state, event.atMs),
              latencyMs: null,
              isError: event.isError,
            },
          ];

      return {
        ...state,
        pendingTools: rest,
        entries: updated,
        emailFallbackOpen:
          state.emailFallbackOpen || isInvalidEmailRefusal(event.toolName, event.result),
      };
    }

    case 'error':
      return { ...state, status: 'error', error: event.message };

    case 'ending':
      return { ...state, status: 'ending' };

    case 'disconnected':
      // The transcript survives the hangup. It is the evidence the call happened, and
      // /calls does not have the row until the post call webhook lands.
      return {
        ...state,
        status: state.status === 'error' ? 'error' : 'idle',
        mode: 'listening',
        pendingTools: {},
        emailFallbackOpen: false,
      };

    case 'email_fallback_open':
      return { ...state, emailFallbackOpen: true };

    case 'email_fallback_close':
      return { ...state, emailFallbackOpen: false };
  }
}

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/**
 * `NEXT_PUBLIC_VOICE_MOCK` is read here and nowhere else, and deliberately not through
 * `src/lib/env.ts`, which throws by design the moment it reaches a client bundle. Next
 * inlines the value at build time, so this constant is fixed for the life of a build and
 * the hook identity below can never change between renders.
 *
 * SPEC.md section 6.7: the flag gates behaviour only. No secret rides a NEXT_PUBLIC_ name.
 */
const USE_MOCK = process.env.NEXT_PUBLIC_VOICE_MOCK === '1';

export const useVoiceSession: (options: VoiceSessionOptions) => VoiceSession = USE_MOCK
  ? useMockSession
  : useElevenLabsSession;

/**
 * The real implementation needs a `ConversationProvider` above it, which the SDK requires
 * as of `@elevenlabs/react` 1.12.0. The mock needs nothing, so it passes children
 * through. The console mounts whichever this resolves to and stays unaware of both.
 */
export const VoiceSessionProvider: (props: { children: React.ReactNode }) => React.ReactNode =
  USE_MOCK ? MockSessionProvider : ElevenLabsSessionProvider;
