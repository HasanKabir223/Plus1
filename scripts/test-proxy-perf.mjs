import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression guard for the slow-navigation bug: proxy.ts used to run a
// profiles-table query (plus an Auth-server call) before every page
// could render, which showed up as multi-second proxy.ts timings.
// These structural checks keep the proxy off the database.
const proxySource = readFileSync('proxy.ts', 'utf8');
const authSource = readFileSync('lib/auth-context.tsx', 'utf8');

assert.ok(
  !proxySource.includes(".from('profiles')"),
  'proxy.ts must not query the profiles table on the request path'
);
console.log('✓ proxy.ts performs no profiles-table query');

const fastPathIndex = proxySource.indexOf("includes('auth-token')");
const clientIndex = proxySource.indexOf('createServerClient(supabaseUrl');
assert.ok(fastPathIndex !== -1, 'proxy.ts must keep the no-cookie fast path');
assert.ok(
  fastPathIndex < clientIndex,
  'no-cookie fast path must run before any Supabase client is created'
);
console.log('✓ logged-out requests skip Supabase entirely');

assert.ok(
  proxySource.includes('supabase.auth.getSession()'),
  'proxy.ts must read the session locally with getSession(), not getUser()'
);
assert.ok(
  !proxySource.includes('supabase.auth.getUser()'),
  'proxy.ts must not call getUser() (Auth-server round trip per request)'
);
console.log('✓ proxy.ts reads sessions locally with getSession() (no per-request Auth round trip)');

// Onboarding gating moved client-side; it must still exist there.
assert.ok(
  authSource.includes("router.push('/onboarding')"),
  'AuthProvider must keep sending un-onboarded users to /onboarding'
);
console.log('✓ onboarding enforcement still present in AuthProvider');

console.log('\nALL TESTS PASSED SUCCESSFULLY!');
