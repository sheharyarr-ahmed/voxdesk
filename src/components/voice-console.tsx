'use client';

/**
 * The gated voice console, SPEC.md section 8 phase 4.
 *
 * It owns no SDK knowledge. Everything it can do arrives through the section 6.7 seam,
 * which is why the same component is driven by a real WebRTC conversation in production
 * and by a scripted fake under Playwright, with no branch anywhere in this file.
 *
 * The visual vocabulary is inherited from /calls rather than invented: mono uppercase
 * labels at 0.2em for sections and 0.15em for items, `rounded border border-line bg-raise`
 * cards, a text scale that stops at `text-lg`, `·` as a separator, and prose empty states.
 * Mint appears exactly once in this tree, inside `TranscriptPane`, on a measured latency.
 */
import { useEffect, useState } from 'react';

import { EmailFallbackField } from '@/components/email-fallback-field';
import { TranscriptPane } from '@/components/transcript-pane';
import {
  VoiceSessionProvider,
  useVoiceSession,
  type VoiceSession,
} from '@/lib/voice/use-voice-session';

export type VoiceConsoleProps = {
  /**
   * `DEFAULT_TIMEZONE`, handed down from the server component above. The browser's own
   * zone replaces it after mount. It is a prop rather than an import because
   * src/lib/env.ts throws if it is ever pulled into a client bundle.
   */
  fallbackTimeZone: string;
};

export function VoiceConsole({ fallbackTimeZone }: VoiceConsoleProps) {
  return (
    <VoiceSessionProvider>
      <ConsoleBody fallbackTimeZone={fallbackTimeZone} />
    </VoiceSessionProvider>
  );
}

/** The sentence under the heading. One per state, written to be read out of a screen. */
function statusLine(session: VoiceSession): string {
  switch (session.status) {
    case 'idle':
      return session.entries.length === 0
        ? 'Ready. Start the call and ask about the work.'
        : 'Call ended. The transcript below is what was said.';
    case 'requesting_mic':
      return 'Waiting for microphone permission.';
    case 'mic_denied':
      return 'The microphone was refused.';
    case 'connecting':
      return 'Connecting to the agent.';
    case 'connected':
      return session.mode === 'speaking' ? 'The agent is speaking.' : 'Listening.';
    case 'ending':
      return 'Ending the call.';
    case 'error':
      return 'The call stopped.';
  }
}

/** The short mono tag beside the heading. Greyscale on purpose: mint means measurement. */
function statusTag(session: VoiceSession): string {
  switch (session.status) {
    case 'connected':
      return session.mode === 'speaking' ? 'agent speaking' : 'listening';
    case 'requesting_mic':
      return 'microphone';
    case 'mic_denied':
      return 'microphone refused';
    default:
      return session.status.replace('_', ' ');
  }
}

function ConsoleBody({ fallbackTimeZone }: VoiceConsoleProps) {
  const [timeZone, setTimeZone] = useState(fallbackTimeZone);

  // Resolved after mount, not during render, so the server and the first client render
  // agree and hydration stays quiet. SPEC.md section 6.4: this value travels to the agent
  // as {{visitor_timezone}} and both tools label slots in it.
  useEffect(() => {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (resolved) setTimeZone(resolved);
  }, []);

  const session = useVoiceSession({ timeZone });
  const live = session.status === 'connected' || session.status === 'connecting';
  const busy = live || session.status === 'requesting_mic' || session.status === 'ending';

  return (
    <div className="min-h-screen bg-ink text-body [color-scheme:dark]">
      <main className="mx-auto max-w-4xl px-6 py-16">
        <header className="border-b border-line pb-6">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-faint">Voice console</p>
          <h1 className="mt-2 font-mono text-lg tracking-tight">VoxDesk</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-faint">
            Talk to the agent. It answers from a controlled knowledge base, checks live calendar
            availability, and books a real discovery call during the conversation.
          </p>
        </header>

        <section className="mt-10">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-faint">Session</h2>
            <span
              data-testid="console-status"
              className="font-mono text-xs uppercase tracking-[0.15em] text-faint"
            >
              {statusTag(session)}
            </span>
          </div>

          <p className="mt-4 text-sm" aria-live="polite" data-testid="console-status-line">
            {statusLine(session)}
          </p>

          {session.error !== null ? (
            <p role="alert" data-testid="console-error" className="mt-3 text-sm text-faint">
              {session.error}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {live || session.status === 'ending' ? (
              <button
                type="button"
                data-testid="end-call"
                onClick={session.stop}
                disabled={session.status === 'ending'}
                className="rounded border border-line px-4 py-2 font-mono text-xs uppercase tracking-[0.15em] text-body transition-colors hover:bg-line focus:border-body focus:outline-none disabled:text-faint"
              >
                End the call
              </button>
            ) : (
              <button
                type="button"
                data-testid="start-call"
                onClick={session.start}
                disabled={busy}
                className="rounded border border-line px-4 py-2 font-mono text-xs uppercase tracking-[0.15em] text-body transition-colors hover:bg-line focus:border-body focus:outline-none disabled:text-faint"
              >
                {session.entries.length === 0 ? 'Start the call' : 'Start another call'}
              </button>
            )}

            {session.status === 'connected' && !session.emailFallbackOpen ? (
              // The automatic reveal below rests on an optional SDK event, so the path is
              // always reachable by hand as well.
              <button
                type="button"
                data-testid="open-email-fallback"
                onClick={session.openEmailFallback}
                className="font-mono text-xs uppercase tracking-[0.15em] text-faint transition-colors hover:text-body focus:outline-none"
              >
                Type my email instead
              </button>
            ) : null}
          </div>

          <p className="mt-5 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-faint">
            <span>{timeZone}</span>
            {session.conversationId !== null ? <span>{session.conversationId}</span> : null}
          </p>

          {session.emailFallbackOpen ? (
            <div data-testid="email-fallback">
              <EmailFallbackField
                onSubmit={session.submitEmail}
                onDismiss={session.dismissEmailFallback}
              />
            </div>
          ) : null}
        </section>

        <section className="mt-10" data-testid="transcript">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-faint">Transcript</h2>
          <TranscriptPane entries={session.entries} />
        </section>

        <footer className="mt-16 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-6 font-mono text-xs text-faint">
          {/*
            SPEC.md section 12. The ElevenLabs free plan grants no commercial rights and
            requires attribution wherever its output is published. Putting the credit in
            the console itself means every recording of this page carries it, rather than
            relying on someone remembering to caption the video.
          */}
          <span>Voice by ElevenLabs</span>
          <a href="/calls" className="ml-auto transition-colors hover:text-body">
            Call log
          </a>
        </footer>
      </main>
    </div>
  );
}
