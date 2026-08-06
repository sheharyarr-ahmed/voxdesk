'use client';

/**
 * SPEC.md section 6.3, the honest degradation path.
 *
 * Capture is voice first and the agent spells the address back before booking. When
 * speech to text still mangles it, `book_meeting` answers HTTP 200 with
 * `{ ok: false, reason: 'invalid_email' }` so the agent reads our sentence aloud, and
 * this field appears so the visitor can type it. The value goes into the live session
 * with `sendContextualUpdate` and the agent retries.
 *
 * Validation is deliberately thin here. The address is checked by `EmailSchema` inside
 * the route that books, which is the boundary that matters. This field only refuses to
 * send something obviously empty, so a visitor is never blocked by our own guess about
 * what an address looks like.
 */
import { useState } from 'react';

export type EmailFallbackFieldProps = {
  onSubmit: (email: string) => void;
  onDismiss: () => void;
};

export function EmailFallbackField({ onSubmit, onDismiss }: EmailFallbackFieldProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mt-6 rounded border border-line bg-raise px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        if (trimmed === '') {
          setError('Type the address you want the invitation sent to.');
          return;
        }
        setError(null);
        setValue('');
        onSubmit(trimmed);
      }}
    >
      <label
        htmlFor="fallback-email"
        className="font-mono text-xs uppercase tracking-[0.15em] text-faint"
      >
        Type your email
      </label>
      <p className="mt-2 text-sm text-faint">
        Speech to text gets addresses wrong. Type it and the agent will use exactly this.
      </p>

      <div className="mt-3 flex flex-wrap gap-3">
        {/*
          Tailwind's preflight sets input backgrounds to transparent, which on this true
          black surface renders an invisible box on an invisible background. That is the
          defect phase 3 found on /gate. The background, the border and the focus ring are
          all explicit here for that reason, and `color-scheme` is inherited from the page.
        */}
        <input
          id="fallback-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          spellCheck={false}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="you@company.com"
          aria-describedby={error ? 'fallback-email-error' : undefined}
          className="min-w-0 flex-1 rounded border border-line bg-ink px-3 py-2 text-sm text-body placeholder:text-faint focus:border-body focus:outline-none"
        />
        <button
          type="submit"
          className="rounded border border-line px-4 py-2 font-mono text-xs uppercase tracking-[0.15em] text-body transition-colors hover:bg-line focus:border-body focus:outline-none"
        >
          Send to agent
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded px-2 py-2 font-mono text-xs uppercase tracking-[0.15em] text-faint transition-colors hover:text-body focus:outline-none"
        >
          Dismiss
        </button>
      </div>

      {error ? (
        <p id="fallback-email-error" role="alert" className="mt-3 text-sm text-body">
          {error}
        </p>
      ) : null}
    </form>
  );
}
