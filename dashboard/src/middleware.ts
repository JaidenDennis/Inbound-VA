import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * UI gate only. The backend API is the real security boundary — it verifies the
 * JWT signature (with its own JWT_SECRET) on every request. This middleware just
 * decides which page to show, so it only checks that a token cookie is present
 * and not expired. It deliberately does NOT verify the signature: doing so would
 * require duplicating JWT_SECRET into the dashboard, and Next.js inlines env vars
 * into the Edge-runtime middleware bundle at BUILD time — so a runtime secret
 * never reaches it and every token would falsely fail. Decoding (not verifying)
 * the payload sidesteps that entirely.
 */
function tokenIsLive(token: string | undefined): boolean {
  if (!token) return false;
  try {
    const part = token.split('.')[1];
    if (!part) return false;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { exp?: number };
    if (typeof payload.exp !== 'number') return false;
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get('gravvia_token')?.value;
  const authed = tokenIsLive(token);

  // Already signed in → keep them out of the login page.
  if (pathname === '/login') {
    if (authed) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return NextResponse.next();
  }

  // Protected area: must be authenticated.
  if (pathname.startsWith('/dashboard')) {
    if (!authed) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/login'],
};
