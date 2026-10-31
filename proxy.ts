import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

function isDummyUsername(username?: string | null): boolean {
  if (!username) return true;
  const clean = username.trim().toLowerCase();
  if (!clean) return true;
  if (clean.startsWith('user_') || /^user_[a-f0-9]{8}$/i.test(clean)) return true;
  return false;
}

function isDummyProfileName(profilename?: string | null): boolean {
  if (!profilename) return true;
  const clean = profilename.trim().toLowerCase();
  if (!clean) return true;
  return clean === 'new member';
}

export async function proxy(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Skip if Supabase is not configured (e.g. local offline dev)
  if (!supabaseUrl || !supabaseAnonKey || !supabaseUrl.startsWith('https://')) {
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

  // Use getUser() for secure server-side session authentication
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Normalize pathname by stripping trailing slashes (e.g. /signup/ -> /signup)
  const rawPathname = request.nextUrl.pathname;
  const pathname = rawPathname.replace(/\/+$/, '') || '/';

  // Public unauthenticated routes (including /signin alias)
  const publicRoutes = ['/', '/login', '/signup', '/signin'];
  const isPublicRoute = publicRoutes.includes(pathname);

  // Let API routes handle their own authentication
  if (pathname.startsWith('/api/')) {
    return supabaseResponse;
  }

  // Alias /signin to /login
  if (pathname === '/signin') {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // 1. Send logged-out users to /login (except /, /login, /signup, /signin)
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // 2. Logged-in users handling
  if (user) {
    // Check if user has completed onboarding in public.profiles
    const { data: profile } = await supabase
      .from('profiles')
      .select('username, profilename')
      .eq('id', user.id)
      .maybeSingle();

    const username = profile?.username;
    const profilename = profile?.profilename;

    const isOnboarded = Boolean(
      !isDummyUsername(username) &&
      !isDummyProfileName(profilename)
    );

    // Send logged-in users away from /login, /signup, /signin
    if (pathname === '/login' || pathname === '/signup' || pathname === '/signin') {
      const url = request.nextUrl.clone();
      url.pathname = isOnboarded ? '/' : '/onboarding';
      return NextResponse.redirect(url);
    }

    // Send logged-in un-onboarded users strictly to /onboarding
    if (!isOnboarded && pathname !== '/onboarding') {
      const url = request.nextUrl.clone();
      url.pathname = '/onboarding';
      return NextResponse.redirect(url);
    }

    // If on /onboarding but already onboarded, send to /
    if (pathname === '/onboarding' && isOnboarded) {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }
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
