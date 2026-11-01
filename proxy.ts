import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Skip if Supabase is not configured (e.g. local offline dev)
  if (!supabaseUrl || !supabaseAnonKey || !supabaseUrl.startsWith('https://')) {
    return NextResponse.next();
  }

  // Normalize pathname by stripping trailing slashes (e.g. /signup/ -> /signup)
  const rawPathname = request.nextUrl.pathname;
  const pathname = rawPathname.replace(/\/+$/, '') || '/';

  // Public unauthenticated routes (including /signin alias)
  const publicRoutes = ['/', '/login', '/signup', '/signin'];
  const isPublicRoute = publicRoutes.includes(pathname);

  // Alias /signin to /login
  if (pathname === '/signin') {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Fast path: without an auth cookie the visitor is logged out, so no
  // Supabase call is needed at all. Client-side guards and RLS enforce
  // the rest, which keeps public pages instant.
  const hasAuthCookie = request.cookies
    .getAll()
    .some((cookie) => cookie.name.includes('auth-token'));

  if (!hasAuthCookie) {
    if (!isPublicRoute && !pathname.startsWith('/api/')) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // Verify the user against the Supabase Auth server. This proxy only
  // decides redirects; onboarding gating is enforced again client-side
  // in AuthProvider, and RLS guards the data itself.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Let API routes handle their own authentication
  if (pathname.startsWith('/api/')) {
    return supabaseResponse;
  }

  // Send logged-out users to /login (except /, /login, /signup, /signin)
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Send logged-in users away from the auth pages. AuthProvider sends
  // un-onboarded users on to /onboarding from there.
  if (
    user &&
    (pathname === '/login' || pathname === '/signup' || pathname === '/signin')
  ) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, icons, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
