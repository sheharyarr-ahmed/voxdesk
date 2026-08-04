'use client';

import { useActionState } from 'react';

import { submitPasscode, type GateState } from './actions';

const initialState: GateState = { error: null };

export function GateForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(submitPasscode, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="passcode">Passcode</label>
      <input
        id="passcode"
        name="passcode"
        type="password"
        autoComplete="off"
        autoFocus
        required
        aria-describedby={state.error ? 'passcode-error' : undefined}
      />
      <button type="submit" disabled={pending}>
        {pending ? 'Checking' : 'Enter'}
      </button>
      {state.error ? (
        <p id="passcode-error" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
