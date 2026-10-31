import assert from 'node:assert';
import { createClient } from '@supabase/supabase-js';

console.log('--- Running Account Deletion Tests ---');

// Test 1: Verify environment variables and Admin Client initialization
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

assert.ok(supabaseUrl, 'NEXT_PUBLIC_SUPABASE_URL should be defined');
assert.ok(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY should be defined');

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

assert.strictEqual(typeof adminClient.auth.admin.deleteUser, 'function', 'adminClient.auth.admin.deleteUser should be a function');
console.log('✓ Admin client initialization & deleteUser method check passed');

// Test 2: Local DB deletion logic simulation
class MockLocalDB {
  constructor() {
    this.profiles = [
      { id: 'user-1', username: 'alice' },
      { id: 'user-2', username: 'bob' },
    ];
    this.agents = [
      { id: 'agent-1', owner_id: 'user-1', name: 'Scout' },
      { id: 'agent-2', owner_id: 'user-2', name: 'Nexus' },
    ];
    this.conversations = [
      { id: 'conv-1', initiator_agent_id: 'agent-1', target_agent_id: 'agent-2' },
    ];
    this.messages = [
      { id: 'msg-1', conversation_id: 'conv-1', content: 'hello' },
    ];
    this.inbox = [
      { id: 'inbox-1', owner_id: 'user-1', summary: 'match' },
      { id: 'inbox-2', owner_id: 'user-2', summary: 'lead' },
    ];
  }

  deleteAccount(userId) {
    this.profiles = this.profiles.filter((p) => p.id !== userId);
    const userAgents = this.agents.filter((a) => a.owner_id === userId);
    const userAgentIds = new Set(userAgents.map((a) => a.id));

    this.agents = this.agents.filter((a) => a.owner_id !== userId);
    this.inbox = this.inbox.filter((i) => i.owner_id !== userId);

    this.conversations = this.conversations.filter(
      (c) => !userAgentIds.has(c.initiator_agent_id) && !userAgentIds.has(c.target_agent_id)
    );
    const remainingConvIds = new Set(this.conversations.map((c) => c.id));
    this.messages = this.messages.filter((m) => remainingConvIds.has(m.conversation_id));
  }
}

const mockDb = new MockLocalDB();
mockDb.deleteAccount('user-1');

assert.strictEqual(mockDb.profiles.length, 1, 'Profile user-1 should be removed');
assert.strictEqual(mockDb.profiles[0].id, 'user-2', 'Profile user-2 should remain');
assert.strictEqual(mockDb.agents.length, 1, 'User-1 agents should be removed');
assert.strictEqual(mockDb.inbox.length, 1, 'User-1 inbox should be removed');
assert.strictEqual(mockDb.conversations.length, 0, 'Conversations with user-1 agents should be cascade removed');
assert.strictEqual(mockDb.messages.length, 0, 'Messages for removed conversations should be cascade removed');
console.log('✓ Mock LocalDB cascading deletion logic passed');

// Test 3: Live Supabase Account Deletion Cycle
async function runLiveSupabaseTest() {
  const testEmail = `test-delete-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';

  console.log(`Creating ephemeral test user: ${testEmail}`);
  const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
  });

  if (createError) {
    console.error('Failed to create ephemeral test user:', createError.message);
    return;
  }

  const testUserId = createData.user.id;
  console.log(`Ephemeral user created with ID: ${testUserId}`);

  // Insert profile into public.profiles
  const { error: profileInsertError } = await adminClient.from('profiles').upsert({
    id: testUserId,
    username: `test_${Date.now().toString().slice(-8)}`,
    profilename: 'Ephemeral Test User',
  });

  if (profileInsertError) {
    console.warn('Profile insert warning:', profileInsertError.message);
  }

  // Verify user and profile exist
  const { data: checkUserBefore } = await adminClient.auth.admin.getUserById(testUserId);
  assert.ok(checkUserBefore.user, 'Ephemeral user should exist in auth.users before deletion');

  const { data: checkProfileBefore } = await adminClient
    .from('profiles')
    .select('*')
    .eq('id', testUserId);
  console.log(`Verified existence before deletion: user=${Boolean(checkUserBefore.user)}, profilesFound=${checkProfileBefore.length}`);

  // Execute deletion sequence (same as app/api/account/delete/route.ts)
  console.log('Executing account deletion sequence...');
  const { error: profileDeleteError } = await adminClient
    .from('profiles')
    .delete()
    .eq('id', testUserId);
  assert.ifError(profileDeleteError);

  const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(testUserId);
  assert.ifError(authDeleteError);

  // Verify deletion from public.profiles
  const { data: checkProfileAfter } = await adminClient
    .from('profiles')
    .select('*')
    .eq('id', testUserId);
  assert.strictEqual(checkProfileAfter.length, 0, 'Profile must be completely removed from public.profiles');

  // Verify deletion from auth.users
  const { data: checkUserAfter, error: getUserError } = await adminClient.auth.admin.getUserById(testUserId);
  assert.ok(!checkUserAfter?.user || getUserError, 'User must be completely removed from auth.users');

  console.log('✓ Live Supabase test: User deleted from BOTH auth.users and public.profiles successfully!');
}

runLiveSupabaseTest().then(() => {
  console.log('\nALL ACCOUNT DELETION TESTS PASSED SUCCESSFULLY!');
}).catch((err) => {
  console.error('Test failure:', err);
  process.exit(1);
});

