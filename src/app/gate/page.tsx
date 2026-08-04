import { GateForm } from './gate-form';

// Pinned so nobody later opts this segment into the Edge runtime, where the
// server action's node:crypto passcode comparison would stop resolving.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Styling lands in phase 4 with the rest of the brand system. This is the
// working gate, not the finished one.
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
    <main>
      <h1>VoxDesk</h1>
      <p>This demo is passcode gated. The gate is a quota defence, not a security posture.</p>
      <GateForm next={target} />
    </main>
  );
}
