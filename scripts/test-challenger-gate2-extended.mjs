import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

console.log('========================================================================');
console.log('--- Plus1 Challenger Gate 2 Extended Verification & Hardening Suite ---');
console.log('========================================================================');

function loadDbModule(mockSupabaseOptions = {}) {
  const dbSourcePath = path.resolve('lib/db.ts');
  const dbSource = fs.readFileSync(dbSourcePath, 'utf8');

  const transpiled = ts.transpileModule(dbSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });

  let code = transpiled.outputText;

  code = code.replace(
    /import\s*\{\s*supabase\s*,\s*isSupabaseConfigured\s*\}\s*from\s*['"][^'"]+['"];?/,
    `
    const isSupabaseConfigured = __mockConfig.isConfigured;
    const supabase = __mockConfig.client;
    `
  );

  code = code.replace(/export\s+\{\s*localDb\s*,\s*LocalDB\s*\};?/g, '');
  code = code.replace(/export\s+const\s+db\s*=/g, 'const db =');
  code = code.replace(/export\s+function\s+formatRelativeTime/g, 'function formatRelativeTime');
  code = code.replace(/export\s+function\s+formatFeedTimestamp/g, 'function formatFeedTimestamp');

  const factory = new Function('__mockConfig', `
    ${code}
    return { LocalDB, localDb, db, formatFeedTimestamp, INITIAL_POSTS };
  `);

  return factory(mockSupabaseOptions);
}

let passCount = 0;
let failCount = 0;
const failures = [];

function check(title, fn) {
  try {
    fn();
    passCount++;
    console.log(`  ✓ [PASS] ${title}`);
  } catch (err) {
    failCount++;
    failures.push({ title, error: err.message });
    console.log(`  ✗ [FAIL] ${title}`);
    console.log(`    Detail: ${err.message}`);
  }
}

async function checkAsync(title, fn) {
  try {
    await fn();
    passCount++;
    console.log(`  ✓ [PASS] ${title}`);
  } catch (err) {
    failCount++;
    failures.push({ title, error: err.message });
    console.log(`  ✗ [FAIL] ${title}`);
    console.log(`    Detail: ${err.message}`);
  }
}

// ============================================================================
// Gate 2 - Dimension 1: Transitive Agent Post Cascade on Account Deletion
// ============================================================================
console.log('\n[Dimension 1: Transitive Agent Post Cascade Verification]');

check('1.1 Multi-Agent & Multi-Post Cascade Stress Test in LocalDB', () => {
  const { LocalDB } = loadDbModule({ isConfigured: false, client: null });
  const instance = new LocalDB();

  const userA = '00000000-0000-0000-0000-000000000001';
  const userB = '00000000-0000-0000-0000-000000000002';

  // User A owns 3 agents
  const agentA1 = '10000000-0000-0000-0000-000000000001';
  const agentA2 = '10000000-0000-0000-0000-000000000002';
  const agentA3 = '10000000-0000-0000-0000-000000000003';

  // User B owns 2 agents
  const agentB1 = '20000000-0000-0000-0000-000000000001';
  const agentB2 = '20000000-0000-0000-0000-000000000002';

  instance.setAgents([
    { id: agentA1, name: 'Agent A1', owner_id: userA, created_at: new Date().toISOString() },
    { id: agentA2, name: 'Agent A2', owner_id: userA, created_at: new Date().toISOString() },
    { id: agentA3, name: 'Agent A3', owner_id: userA, created_at: new Date().toISOString() },
    { id: agentB1, name: 'Agent B1', owner_id: userB, created_at: new Date().toISOString() },
    { id: agentB2, name: 'Agent B2', owner_id: userB, created_at: new Date().toISOString() },
  ]);

  const posts = [];

  // User A human posts (5 posts)
  for (let i = 0; i < 5; i++) {
    posts.push({
      id: `post-userA-${i}`,
      author_profile_id: userA,
      author_agent_id: null,
      parent_id: null,
      body: `Post ${i} by User A`,
      created_at: new Date().toISOString(),
    });
  }

  // Agent A1 posts (4 posts)
  for (let i = 0; i < 4; i++) {
    posts.push({
      id: `post-agentA1-${i}`,
      author_profile_id: null,
      author_agent_id: agentA1,
      parent_id: null,
      body: `Post ${i} by Agent A1`,
      created_at: new Date().toISOString(),
    });
  }

  // Agent A2 posts (3 posts)
  for (let i = 0; i < 3; i++) {
    posts.push({
      id: `post-agentA2-${i}`,
      author_profile_id: null,
      author_agent_id: agentA2,
      parent_id: null,
      body: `Post ${i} by Agent A2`,
      created_at: new Date().toISOString(),
    });
  }

  // Agent A3 posts (2 posts)
  for (let i = 0; i < 2; i++) {
    posts.push({
      id: `post-agentA3-${i}`,
      author_profile_id: null,
      author_agent_id: agentA3,
      parent_id: null,
      body: `Post ${i} by Agent A3`,
      created_at: new Date().toISOString(),
    });
  }

  // User B human posts (3 posts)
  for (let i = 0; i < 3; i++) {
    posts.push({
      id: `post-userB-${i}`,
      author_profile_id: userB,
      author_agent_id: null,
      parent_id: null,
      body: `Post ${i} by User B`,
      created_at: new Date().toISOString(),
    });
  }

  // Agent B1 posts (5 posts)
  for (let i = 0; i < 5; i++) {
    posts.push({
      id: `post-agentB1-${i}`,
      author_profile_id: null,
      author_agent_id: agentB1,
      parent_id: null,
      body: `Post ${i} by Agent B1`,
      created_at: new Date().toISOString(),
    });
  }

  // Agent B2 posts (4 posts)
  for (let i = 0; i < 4; i++) {
    posts.push({
      id: `post-agentB2-${i}`,
      author_profile_id: null,
      author_agent_id: agentB2,
      parent_id: null,
      body: `Post ${i} by Agent B2`,
      created_at: new Date().toISOString(),
    });
  }

  instance.setPosts(posts);
  assert.equal(instance.getPosts().length, 26);

  // User A deletes account
  instance.deleteAccount(userA);

  const postsAfter = instance.getPosts();
  // Expected remaining: User B posts (3) + Agent B1 posts (5) + Agent B2 posts (4) = 12 posts
  assert.equal(postsAfter.length, 12, 'Exactly 12 posts should remain after User A account deletion');

  // Confirm NO posts belonging to User A or any of User A's agents exist
  const remainingUserAPosts = postsAfter.filter((p) => p.author_profile_id === userA);
  assert.equal(remainingUserAPosts.length, 0, 'No human posts by User A may remain');

  const remainingUserAAgentPosts = postsAfter.filter(
    (p) => [agentA1, agentA2, agentA3].includes(p.author_agent_id)
  );
  assert.equal(remainingUserAAgentPosts.length, 0, 'No agent posts by User A agents may remain');

  // Confirm User B's posts and agents are 100% intact
  const remainingUserBPosts = postsAfter.filter((p) => p.author_profile_id === userB);
  assert.equal(remainingUserBPosts.length, 3, 'User B human posts must be untouched');

  const remainingUserBAgentPosts = postsAfter.filter(
    (p) => [agentB1, agentB2].includes(p.author_agent_id)
  );
  assert.equal(remainingUserBAgentPosts.length, 9, 'User B agent posts must be untouched');
});

check('1.2 Zero-Agent User Account Deletion Handling', () => {
  const { LocalDB } = loadDbModule({ isConfigured: false, client: null });
  const instance = new LocalDB();

  const userNoAgents = 'user-zero-agents-999';
  instance.createPost({ body: 'Post from user with 0 agents', author_profile_id: userNoAgents });
  assert.equal(instance.getPosts().length, 1);

  // Deleting user who owns 0 agents must not crash or leave posts
  instance.deleteAccount(userNoAgents);
  assert.equal(instance.getPosts().length, 0, 'Posts purged cleanly even when user has 0 agents');
});

check('1.3 Database Schema Foreign Key Cascade Completeness', () => {
  const schemaSql = fs.readFileSync(path.resolve('supabase/schema.sql'), 'utf8');
  const migrationSql = fs.readFileSync(
    path.resolve('supabase/migrations/20261102_posts_schema_and_rls.sql'),
    'utf8'
  );

  // Both schema.sql and migrationSql must declare posts foreign key cascades
  for (const sql of [schemaSql, migrationSql]) {
    assert.match(
      sql,
      /author_profile_id.+references\s+public\.profiles\s*\(\s*id\s*\)\s+on delete cascade/i,
      'Schema must declare ON DELETE CASCADE on author_profile_id'
    );
    assert.match(
      sql,
      /author_agent_id.+references\s+public\.agents\s*\(\s*id\s*\)\s+on delete cascade/i,
      'Schema must declare ON DELETE CASCADE on author_agent_id'
    );
  }

  // schema.sql must declare agents table cascade to owner_id
  assert.match(
    schemaSql,
    /owner_id.+references\s+public\.profiles\s*\(\s*id\s*\)\s+on delete cascade/i,
    'Agents table in schema.sql must declare ON DELETE CASCADE on owner_id'
  );
});

// ============================================================================
// Gate 2 - Dimension 2: Delete Authorization & Falsy/Null User Guarding
// ============================================================================
console.log('\n[Dimension 2: Delete Authorization & Falsy/Null User Guards]');

check('2.1 Comprehensive Falsy/Null Inputs to LocalDB.deletePost Against Agent Posts', () => {
  const { LocalDB } = loadDbModule({ isConfigured: false, client: null });
  const instance = new LocalDB();

  const agentPost = {
    id: 'agent-post-target-001',
    author_profile_id: null,
    author_agent_id: 'agent-uuid-111',
    parent_id: null,
    body: 'Agent post must never be deletable by any human or falsy caller',
    created_at: new Date().toISOString(),
  };

  instance.setPosts([agentPost]);
  assert.equal(instance.getPosts().length, 1);

  const hostileUserIds = [
    null,
    undefined,
    '',
    false,
    0,
    NaN,
    'null',
    'undefined',
    '0',
    ' ',
    '   ',
    'random-user-id',
  ];

  for (const hostileId of hostileUserIds) {
    const deleted = instance.deletePost(agentPost.id, hostileId);
    assert.equal(deleted, false, `deletePost with userId ${String(hostileId)} must return false`);
    assert.equal(instance.getPosts().length, 1, `Post must remain after attempt with userId ${String(hostileId)}`);
  }
});

check('2.2 Comprehensive Falsy/Null Inputs to LocalDB.deletePost Against Human Posts', () => {
  const { LocalDB } = loadDbModule({ isConfigured: false, client: null });
  const instance = new LocalDB();

  const legitimateOwner = 'owner-uuid-777';
  const humanPost = {
    id: 'human-post-target-001',
    author_profile_id: legitimateOwner,
    author_agent_id: null,
    parent_id: null,
    body: 'Human post only deletable by legitimate owner',
    created_at: new Date().toISOString(),
  };

  instance.setPosts([humanPost]);

  const hostileUserIds = [null, undefined, '', 'attacker-uuid-999', ' '];
  for (const hostileId of hostileUserIds) {
    const deleted = instance.deletePost(humanPost.id, hostileId);
    assert.equal(deleted, false, `deletePost with hostileId ${String(hostileId)} must return false`);
    assert.equal(instance.getPosts().length, 1, 'Human post must NOT be deleted');
  }

  const deletedByOwner = instance.deletePost(humanPost.id, legitimateOwner);
  assert.equal(deletedByOwner, true, 'Legitimate owner deletion must succeed');
  assert.equal(instance.getPosts().length, 0, 'Human post must be deleted');
});

await checkAsync('2.3 db.deletePost Unified Client Guarding', async () => {
  let remoteDeleteInvoked = false;

  const mockSupabase = {
    from: () => ({
      delete: () => ({
        eq: () => ({
          eq: () => {
            remoteDeleteInvoked = true;
            return Promise.resolve({ error: null });
          },
        }),
      }),
    }),
  };

  const { db } = loadDbModule({ isConfigured: true, client: mockSupabase });

  await db.deletePost('some-post-id', null);
  assert.equal(remoteDeleteInvoked, false, 'Remote delete should not be called with null userId');

  await db.deletePost('some-post-id', '');
  assert.equal(remoteDeleteInvoked, false, 'Remote delete should not be called with empty userId');

  await db.deletePost('', 'valid-user-id');
  assert.equal(remoteDeleteInvoked, false, 'Remote delete should not be called with empty postId');
});

// ============================================================================
// Gate 2 - Dimension 3: Remote & LocalDB UUID / Timestamp Synchronization
// ============================================================================
console.log('\n[Dimension 3: Remote & LocalDB ID and Timestamp Parity]');

await checkAsync('3.1 Sequential Remote Insert Parity and Cascading Deletion Verification', async () => {
  const remoteStore = new Map();

  const mockSupabase = {
    from: (table) => {
      assert.equal(table, 'posts');
      return {
        insert: (payload) => ({
          select: () => ({
            single: () => {
              const remoteId = `supabase-remote-uuid-${Math.random().toString(36).slice(2, 10)}`;
              const remoteTimestamp = new Date(Date.now() - 5000).toISOString();
              const row = {
                id: remoteId,
                body: payload.body,
                author_profile_id: payload.author_profile_id,
                author_agent_id: null,
                parent_id: null,
                created_at: remoteTimestamp,
                author_profile: { id: payload.author_profile_id, username: 'testuser', profilename: 'Test User' },
                author_agent: null,
              };
              remoteStore.set(remoteId, row);
              return Promise.resolve({ data: row, error: null });
            },
          }),
        }),
        delete: () => ({
          eq: (col1, val1) => ({
            eq: (col2, val2) => {
              if (col1 === 'id' && col2 === 'author_profile_id') {
                const existing = remoteStore.get(val1);
                if (existing && existing.author_profile_id === val2) {
                  remoteStore.delete(val1);
                  return Promise.resolve({ error: null });
                }
              }
              return Promise.resolve({ error: null });
            },
          }),
        }),
      };
    },
  };

  const { db, localDb } = loadDbModule({ isConfigured: true, client: mockSupabase });

  const userId = '00000000-0000-0000-0000-000000000001';
  const createdPosts = [];

  for (let i = 1; i <= 5; i++) {
    const post = await db.createPost({
      body: `Test post number ${i} with sync validation`,
      author_profile_id: userId,
    });
    createdPosts.push(post);
  }

  assert.equal(remoteStore.size, 5, 'Remote store must contain 5 posts');

  const localPosts = localDb.getPosts();
  assert.equal(localPosts.length, 5, 'LocalDB must contain 5 posts');

  for (const created of createdPosts) {
    const matchingLocal = localPosts.find((p) => p.id === created.id);
    assert.ok(matchingLocal, `LocalDB must contain matching ID: ${created.id}`);
    assert.equal(matchingLocal.body, created.body, 'Body must match');
    assert.equal(matchingLocal.created_at, created.created_at, 'Timestamp must match remote created_at');
  }

  const targetPostToDelete = createdPosts[1];
  await db.deletePost(targetPostToDelete.id, userId);

  assert.equal(remoteStore.size, 4, 'Remote store must have 4 posts after deletion');
  assert.equal(remoteStore.has(targetPostToDelete.id), false, 'Deleted post removed from remote');

  const localPostsAfter = localDb.getPosts();
  assert.equal(localPostsAfter.length, 4, 'LocalDB must have 4 posts after deletion');
  assert.equal(localPostsAfter.some((p) => p.id === targetPostToDelete.id), false, 'Deleted post removed from LocalDB');
});

check('3.2 LocalDB.createPost Idempotency on Existing ID', () => {
  const { LocalDB } = loadDbModule({ isConfigured: false, client: null });
  const instance = new LocalDB();

  const fixedId = 'custom-fixed-uuid-12345';
  const user = 'user-fixed-1';

  instance.createPost({ id: fixedId, body: 'Original text', author_profile_id: user });
  assert.equal(instance.getPosts().length, 1);
  assert.equal(instance.getPosts()[0].body, 'Original text');

  instance.createPost({ id: fixedId, body: 'Updated text', author_profile_id: user });
  const posts = instance.getPosts();
  assert.equal(posts.length, 1, 'LocalDB must not duplicate posts on duplicate ID insert');
  assert.equal(posts[0].id, fixedId);
  assert.equal(posts[0].body, 'Updated text');
});

console.log('\n========================================================================');
console.log(`TOTAL GATE 2 EXTENDED TESTS : ${passCount + failCount}`);
console.log(`PASSED                      : ${passCount}`);
console.log(`FAILED                      : ${failCount}`);
console.log('========================================================================');

if (failCount > 0) {
  console.log('\nGATE 2 EXTENDED VERIFICATION FAILED:');
  failures.forEach((f, idx) => {
    console.log(`[Failure ${idx + 1}] ${f.title}`);
    console.log(`  Detail: ${f.error}`);
  });
  process.exit(1);
} else {
  console.log('\nGATE 2 EMPIRICAL HARDENING: ALL DIMENSIONS 100% VERIFIED.');
  process.exit(0);
}
