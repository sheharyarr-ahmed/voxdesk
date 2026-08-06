import { GateForm } from './gate-form';

// Pinned so nobody later opts this segment into the Edge runtime, where the
// server action's node:crypto passcode comparison would stop resolving.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function GatePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')
    ? next
    : '/';

  return (
    // The surface is applied here rather than on `body`. Phase 3 put true black on the
    // body element and Tailwind's preflight, which sets input backgrounds transparent,
    // turned the passcode field into an invisible box on an invisible background. The
    // field below now carries an explicit background and border for that reason.
    <div className="min-h-screen bg-ink text-body [color-scheme:dark]">
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-faint">Passcode</p>
        <h1 className="mt-2 font-mono text-lg tracking-tight">VoxDesk</h1>
        <p className="mt-3 text-sm leading-relaxed text-faint">
          This demo is passcode gated. The gate is a quota defence, not a security posture. Voice
          minutes are metered, so the passcode is what stops ten open tabs draining the month.
        </p>

        <GateForm next={target} />

        <p className="mt-16 border-t border-line pt-6 font-mono text-xs text-faint">
          Voice by ElevenLabs
        </p>
      </main>
    </div>
  );
}
