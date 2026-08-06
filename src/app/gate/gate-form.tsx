'use client';

import { useActionState } from 'react';

import { submitPasscode, type GateState } from './actions';

const initialState: GateState = { error: null };

export function GateForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(submitPasscode, initialState);

  return (
    <form action={formAction} className="mt-8">
      <input type="hidden" name="next" value={next} />

      <label
        htmlFor="passcode"
        className="font-mono text-xs uppercase tracking-[0.15em] text-faint"
      >
        Passcode
      </label>

      {/*
        Background, border and focus ring are all explicit. Tailwind's preflight sets
        `background-color: transparent` on inputs, and that is an authored rule rather
        than a browser default, so `color-scheme: dark` does not rescue it on true black.
        This is the exact defect phase 3 found by screenshotting the deployed page while
        typecheck, the unit suite and the build were all green.
      */}
      <input
        id="passcode"
        name="passcode"
        type="password"
        autoComplete="off"
        autoFocus
        required
        aria-describedby={state.error ? 'passcode-error' : undefined}
        className="mt-2 block w-full rounded border border-line bg-raise px-3 py-2 text-sm text-body placeholder:text-faint focus:border-body focus:outline-none"
      />

      <button
        type="submit"
        disabled={pending}
        className="mt-4 w-full rounded border border-line px-4 py-2 font-mono text-xs uppercase tracking-[0.15em] text-body transition-colors hover:bg-line focus:border-body focus:outline-none disabled:text-faint"
      >
        {pending ? 'Checking' : 'Enter'}
      </button>

      {state.error ? (
        <p id="passcode-error" role="alert" className="mt-3 text-sm text-faint">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
