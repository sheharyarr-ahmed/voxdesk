// The gated voice console. Reaching this page at all is the evidence that
// src/middleware.ts admitted a valid session cookie.
//
// This stays a server component. It reads DEFAULT_TIMEZONE and hands it down as a prop,
// the same way calls/[id]/page.tsx passes timeZone into CallDetail, because
// src/lib/env.ts throws by design if it is ever pulled into a client bundle. The browser
// replaces the value with its own resolved zone after mount.
import { VoiceConsole } from '@/components/voice-console';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

export default function Home() {
  return <VoiceConsole fallbackTimeZone={env.DEFAULT_TIMEZONE} />;
}
