// Layer 2 of SPEC.md section 6.1. Redirects / and /calls* to the gate when the
// session cookie is absent or invalid.
//
// This runs on the Edge runtime, so nothing in its import graph may reach
// node:crypto, the Drizzle client, src/lib/cal.ts or src/lib/schemas.ts.
// session-cookie.ts is built on Web Crypto for exactly this reason.
import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE, verifySession } from '@/lib/session-cookie';

export const config = {
  // /calls/:path* covers /calls as well as /calls/<id>, so these two entries
  // cover section 6.1's "/ and /calls*".
  matcher: ['/', '/calls/:path*'],
};

export async function middleware(request: NextRequest): Promise<NextResponse> {
  if (await verifySession(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = '/gate';
  url.search = '';
  url.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(url);
}
