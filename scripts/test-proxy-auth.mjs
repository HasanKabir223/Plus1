import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('================================================================');
console.log('--- Running Plus1 Proxy Auth-Check Verification Suite ---');
console.log('================================================================');

// The middleware runs on every request. It must decide redirects from the
// local cookie session, never with a per-request Auth-server round trip.
// Regression: `supabase.auth.getUser()` costs ~300-850ms per request.

console.log('\n[Group 1: No network auth check in proxy.ts]');

const proxyPath = path.resolve('proxy.ts');
assert.ok(fs.existsSync(proxyPath), 'proxy.ts must exist');
const proxySrc = fs.readFileSync(proxyPath, 'utf8');

assert.match(
  proxySrc,
  /supabase\.auth\.getSession\(\)/,
  'proxy.ts must read the session locally via supabase.auth.getSession()'
);
assert.doesNotMatch(
  proxySrc,
  /supabase\.auth\.getUser\(\)/,
  'proxy.ts must NOT call supabase.auth.getUser() (network round trip per request)'
);

console.log('\n[Group 2: Redirect behavior preserved]');

// No-cookie fast path still short-circuits before any Supabase client.
assert.match(
  proxySrc,
  /hasAuthCookie/,
  'proxy.ts must keep the no-auth-cookie fast path'
);
// Logged-out users still bounce off private routes; logged-in users still
// bounce off the auth pages.
assert.match(
  proxySrc,
  /!user && !isPublicRoute/,
  'proxy.ts must still redirect logged-out users to /login'
);
assert.match(
  proxySrc,
  /pathname === '\/login' \|\| pathname === '\/signup'/,
  'proxy.ts must still redirect logged-in users away from auth pages'
);
// Session refresh must still propagate cookies to the response.
assert.match(
  proxySrc,
  /supabaseResponse\.cookies\.set\(name, value, options\)/,
  'proxy.ts must still forward refreshed auth cookies to the response'
);

console.log('\nAll proxy auth-check assertions passed.');
