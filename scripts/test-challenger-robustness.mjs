import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

console.log('================================================================');
console.log('--- Plus1 Challenger Empirical Robustness Verification Suite ---');
console.log('================================================================');

// Helper to transpile and evaluate lib/db.ts with custom mocked environment
function loadDbModule(mockSupabaseOptions = {}) {
  const dbSourcePath = path.resolve('lib/db.ts');
  const dbSource = fs.readFileSync(dbSourcePath, 'utf8');

  // Transpile TypeScript to JavaScript
  const transpiled = ts.transpileModule(dbSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });

  let code = transpiled.outputText;

  // Replace import { supabase, isSupabaseConfigured } from './supabase/client';
  // with our injected mock
  code = code.replace(
    /import\s*\{\s*supabase\s*,\s*isSupabaseConfigured\s*\}\s*from\s*['"][^'"]+['"];?/,
    `
    const isSupabaseConfigured = __mockConfig.isConfigured;
    const supabase = __mockConfig.client;
    `
  );

  // Strip export statements to evaluate cleanly in function scope
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

const suiteResults = [];

function runTest(suiteName, testName, fn) {
  try {
    fn();
    suiteResults.push({ suite: suiteName, test: testName, status: 'PASS' });
    console.log(`  ✓ [PASS] ${testName}`);
  } catch (err) {
    suiteResults.push({ suite: suiteName, test: testName, status: 'FAIL', error: err.message });
    console.log(`  ✗ [FAIL] ${testName}`);
    console.log(`    Detail: ${err.message}`);
  }
}

async function runAsyncTest(suiteName, testName, fn) {
  try {
    await fn();
    suiteResults.push({ suite: suiteName, test: testName, status: 'PASS' });
    console.log(`  ✓ [PASS] ${testName}`);
  } catch (err) {
    suiteResults.push({ suite: suiteName, test: testName, status: 'FAIL', error: err.message });
    console.log(`  ✗ [FAIL] ${testName}`);
    console.log(`    Detail: ${err.message}`);
  }
}

// ============================================================================
// Suite 1: Zero-Metric Invariant & Initial State
// ============================================================================
console.log('\n[Suite 1: Zero-Metric Invariant & Initial State]');

runTest('Suite 1: Zero-Metric Invariant', '1.1: lib/db.ts strictly declares INITIAL_POSTS as empty array', () => {
  const dbSource = fs.readFileSync(path.resolve('lib/db.ts'), 'utf8');
  assert.match(
    dbSource,
    /const\s+INITIAL_POSTS:\s*Post\[\]\s*=\s*\[\s*\];/i,
    'INITIAL_POSTS must be explicitly declared as an empty array: const INITIAL_POSTS: Post[] = [];'
  );
  assert.doesNotMatch(
    dbSource,
    /INITIAL_POSTS\.push/i,
    'INITIAL_POSTS must not have any items pushed into it'
  );
});

runTest('Suite 1: Zero-Metric Invariant', '1.2: LocalDB fresh instance begins with exactly 0 posts', () => {
  const { LocalDB } = loadDbModule({ isConfigured: false, client: null });
  const instance = new LocalDB();
  const posts = instance.getPosts();
  assert.ok(Array.isArray(posts), 'getPosts() must return an array');
  assert.equal(posts.length, 0, 'Initial post count must strictly be 0');

  const feed = instance.fetchFeedPosts();
  assert.equal(feed.posts.length, 0, 'fetchFeedPosts() must return 0 posts');
  assert.equal(feed.hasMore, false, 'hasMore must be false when empty');
  assert.equal(feed.nextCursor, null, 'nextCursor must be null when empty');
});

runTest('Suite 1: Zero-Metric Invariant', '1.3: UI FeedList renders honest empty state and zero fake metrics', () => {
  const feedListSource = fs.readFileSync(path.resolve('components/feed/feed-list.tsx'), 'utf8');
  assert.match(
    feedListSource,
    /Nothing here yet/i,
    'FeedList must contain honest empty state title'
  );
  assert.match(
    feedListSource,
    /Be the first to post/i,
    'FeedList must invite user to be first to post'
  );
  assert.doesNotMatch(
    feedListSource,
    /Math\.random|dummyPosts|mockPosts/i,
    'FeedList must never synthesize random or fake post counts'
  );
});

// ============================================================================
// Suite 2: Delete Authorization & Access Control
// ============================================================================
console.log('\n[Suite 2: Delete Authorization & Access Control]');

runTest('Suite 2: Delete Authorization', '2.1: User A cannot delete User B\'s post in LocalDB', () => {
  const { LocalDB } = loadDbModule({ isConfigured: false, client: null });
  const instance = new LocalDB();

  const postB = instance.createPost({
    body: 'Hello from User B (Marcus)',
    author_profile_id: '00000000-0000-0000-0000-000000000003',
  });

  assert.equal(instance.getPosts().length, 1);

  // User A attempts to delete postB
  const userAId = '00000000-0000-0000-0000-000000000001';
  const result = instance.deletePost(postB.id, userAId);

  assert.equal(result, false, 'deletePost by non-author must return false');
  assert.equal(instance.getPosts().length, 1, 'Post must not be removed from LocalDB');
  assert.equal(instance.getPosts()[0].id, postB.id, 'Target post must remain untouched');
});

runTest('Suite 2: Delete Authorization', '2.2: Agent posts cannot be deleted via db.deletePost with human user ID', () => {
  const { LocalDB } = loadDbModule({ isConfigured: false, client: null });
  const instance = new LocalDB();

  // Seed an agent post directly
  const agentPost = {
    id: 'post-agent-test-001',
    author_profile_id: null,
    author_agent_id: '10000000-0000-0000-0000-000000000001',
    parent_id: null,
    body: 'Scout autonomous log: Searching network for consensus builders.',
    created_at: new Date().toISOString(),
  };

  instance.setPosts([agentPost]);
  assert.equal(instance.getPosts().length, 1);

  // Human user attempts to delete the agent post
  const humanUserId = '00000000-0000-0000-0000-000000000001';
  const deleteResult = instance.deletePost(agentPost.id, humanUserId);

  assert.equal(deleteResult, false, 'Agent post deletion by human user must return false');
  assert.equal(instance.getPosts().length, 1, 'Agent post must remain in storage');

  // Empty string user ID also cannot delete agent post
  const emptyUserIdDelete = instance.deletePost(agentPost.id, '');
  assert.equal(emptyUserIdDelete, false, 'Empty userId cannot delete agent post');
  assert.equal(instance.getPosts().length, 1, 'Agent post must remain intact');
});

runTest('Suite 2: Delete Authorization', '2.3: RLS SQL migration strictly enforces delete authorization on DB level', () => {
  const migrationSql = fs.readFileSync(
    path.resolve('supabase/migrations/20261102_posts_schema_and_rls.sql'),
    'utf8'
  );

  assert.match(
    migrationSql,
    /create policy "posts_delete_own_human"\s+on public\.posts for delete\s+to authenticated\s+using\s*\(\s*author_profile_id\s*=\s*\(\s*select auth\.uid\(\)\s*\)\s*\);/i,
    'SQL delete policy must require author_profile_id = auth.uid()'
  );
});

runTest('Suite 2: Delete Authorization', '2.4: PostCard UI component hides delete button on agent posts and non-owned posts', () => {
  const cardSource = fs.readFileSync(path.resolve('components/feed/post-card.tsx'), 'utf8');

  assert.match(
    cardSource,
    /const\s+isHuman\s*=\s*Boolean\(post\.author_profile_id\);/,
    'PostCard must check if author is human'
  );
  assert.match(
    cardSource,
    /const\s+isOwnPost\s*=\s*Boolean\(user\?\.id\s*&&\s*isHuman\s*&&\s*user\.id\s*===\s*post\.author_profile_id\);/,
    'PostCard must only allow delete on user\'s own human post'
  );
  assert.match(
    cardSource,
    /\{isOwnPost\s*&&\s*\(/,
    'Delete button must only render when isOwnPost is true'
  );
});

runTest('Suite 2: Delete Authorization', '2.5: User A successfully deletes their own post', () => {
  const { LocalDB } = loadDbModule({ isConfigured: false, client: null });
  const instance = new LocalDB();

  const userAId = '00000000-0000-0000-0000-000000000001';
  const postA = instance.createPost({
    body: 'User A own post for deletion testing',
    author_profile_id: userAId,
  });

  assert.equal(instance.getPosts().length, 1);

  const deleteResult = instance.deletePost(postA.id, userAId);
  assert.equal(deleteResult, true, 'deletePost on own post must return true');
  assert.equal(instance.getPosts().length, 0, 'Post must be removed from LocalDB');
});

// ============================================================================
// Suite 3: Account Deletion Cascade & Data Purging
// ============================================================================
console.log('\n[Suite 3: Account Deletion Cascade & Data Purging]');

runTest('Suite 3: Account Deletion Cascade', '3.1: Profile deletion purges user\'s authored human posts in LocalDB', () => {
  const { LocalDB } = loadDbModule({ isConfigured: false, client: null });
  const instance = new LocalDB();

  const userAId = '00000000-0000-0000-0000-000000000001';
  const userBId = '00000000-0000-0000-0000-000000000002';

  instance.createPost({ body: 'Post 1 by User A', author_profile_id: userAId });
  instance.createPost({ body: 'Post 2 by User A', author_profile_id: userAId });
  const postB = instance.createPost({ body: 'Post 1 by User B', author_profile_id: userBId });

  assert.equal(instance.getPosts().length, 3);

  instance.deleteAccount(userAId);

  const remainingPosts = instance.getPosts();
  assert.equal(remainingPosts.length, 1, 'Only User B\'s post should remain');
  assert.equal(remainingPosts[0].id, postB.id, 'User B post must be intact');
  assert.equal(remainingPosts.some((p) => p.author_profile_id === userAId), false, 'User A posts must be purged');
});

runTest('Suite 3: Account Deletion Cascade', '3.2: SQL Schema declares ON DELETE CASCADE on author_profile_id and author_agent_id', () => {
  const migrationSql = fs.readFileSync(
    path.resolve('supabase/migrations/20261102_posts_schema_and_rls.sql'),
    'utf8'
  );

  assert.match(
    migrationSql,
    /foreign key\s*\(\s*author_profile_id\s*\)\s*references public\.profiles\s*\(\s*id\s*\)\s+on delete cascade/i,
    'SQL must enforce on delete cascade for author_profile_id'
  );

  assert.match(
    migrationSql,
    /foreign key\s*\(\s*author_agent_id\s*\)\s*references public\.agents\s*\(\s*id\s*\)\s+on delete cascade/i,
    'SQL must enforce on delete cascade for author_agent_id'
  );
});

// ============================================================================
// Suite 4: Offline Fallback & Network Error Handling
// ============================================================================
console.log('\n[Suite 4: Offline Fallback & Network Error Handling]');

await runAsyncTest('Suite 4: Offline Fallback', '4.1: Fallback operates when Supabase client is unconfigured / null', async () => {
  const { db } = loadDbModule({ isConfigured: false, client: null });

  // Create post via db
  const created = await db.createPost({
    body: 'Offline fallback post created without Supabase',
    author_profile_id: '00000000-0000-0000-0000-000000000001',
  });

  assert.ok(created.id, 'Post must have generated id');
  assert.equal(created.body, 'Offline fallback post created without Supabase');

  // Fetch feed via db
  const feed = await db.fetchFeedPosts({ limit: 10 });
  assert.equal(feed.posts.length, 1, 'Feed must return created post from localDb');
  assert.equal(feed.posts[0].id, created.id);

  // Delete via db
  await db.deletePost(created.id, '00000000-0000-0000-0000-000000000001');
  const feedAfter = await db.fetchFeedPosts({ limit: 10 });
  assert.equal(feedAfter.posts.length, 0, 'Post must be deleted from localDb');
});

await runAsyncTest('Suite 4: Offline Fallback', '4.2: PGRST205 error (table not in schema cache) gracefully activates LocalDB fallback', async () => {
  const mockPgrst205Client = {
    from: () => ({
      select: () => ({
        is: () => ({
          order: () => ({
            limit: () => Promise.resolve({
              data: null,
              error: {
                code: 'PGRST205',
                message: 'Could not find the table public.posts in the schema cache',
              },
            }),
          }),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: () => Promise.resolve({
            data: null,
            error: {
              code: 'PGRST205',
              message: 'Could not find the table public.posts in the schema cache',
            },
          }),
        }),
      }),
      delete: () => ({
        eq: () => ({
          eq: () => Promise.resolve({
            error: {
              code: 'PGRST205',
              message: 'Could not find the table public.posts in the schema cache',
            },
          }),
        }),
      }),
    }),
  };

  const { db } = loadDbModule({ isConfigured: true, client: mockPgrst205Client });

  // 1. fetchFeedPosts under PGRST205 must not throw
  const feed = await db.fetchFeedPosts({ limit: 20 });
  assert.ok(Array.isArray(feed.posts), 'feed.posts must be an array');
  assert.equal(feed.posts.length, 0, 'Returns clean LocalDB posts');

  // 2. createPost under PGRST205 must not throw and fall back to localDb
  const created = await db.createPost({
    body: 'PGRST205 resilience test post',
    author_profile_id: '00000000-0000-0000-0000-000000000002',
  });
  assert.ok(created.id);
  assert.equal(created.body, 'PGRST205 resilience test post');

  // 3. deletePost under PGRST205 must not throw
  await db.deletePost(created.id, '00000000-0000-0000-0000-000000000002');
  const feedAfter = await db.fetchFeedPosts();
  assert.equal(feedAfter.posts.length, 0);
});

await runAsyncTest('Suite 4: Offline Fallback', '4.3: Reads fall back to LocalDB on network failure; writes surface the error instead of silently publishing locally', async () => {
  const mockNetworkErrorClient = {
    from: () => ({
      select: () => ({
        is: () => ({
          order: () => ({
            limit: () => Promise.reject(new TypeError('fetch failed')),
          }),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: () => Promise.reject(new TypeError('fetch failed')),
        }),
      }),
      delete: () => ({
        eq: () => ({
          eq: () => Promise.reject(new TypeError('fetch failed')),
        }),
      }),
    }),
  };

  const { db } = loadDbModule({ isConfigured: true, client: mockNetworkErrorClient });

  // fetchFeedPosts (a read) must survive network failure via LocalDB fallback
  const feed = await db.fetchFeedPosts();
  assert.ok(Array.isArray(feed.posts), 'feed.posts must be returned without crash');

  // createPost (a write) must surface network failure: degrading to a
  // local-only post would make the user believe it was published.
  await assert.rejects(
    db.createPost({
      body: 'Network failure recovery post',
      author_profile_id: '00000000-0000-0000-0000-000000000003',
    }),
    /fetch failed/,
    'createPost must reject on remote network failure'
  );

  // deletePost (a write) must likewise surface network failure
  await assert.rejects(
    db.deletePost('post-network-failure', '00000000-0000-0000-0000-000000000003'),
    /fetch failed/,
    'deletePost must reject on remote network failure'
  );
});

// ============================================================================
// Suite 5: XSS, Special Characters & Encoding Injection
// ============================================================================
console.log('\n[Suite 5: XSS, Special Characters & Encoding Injection]');

runTest('Suite 5: XSS & Sanitization', '5.1: XSS payload strings stored verbatim without unescaped HTML execution risk', () => {
  const { LocalDB } = loadDbModule({ isConfigured: false, client: null });
  const instance = new LocalDB();

  const xssPayloads = [
    '<script>alert("xss")</script>',
    '<img src="x" onerror="alert(1)">',
    '<a href="javascript:alert(\'hack\')">Click</a>',
    '"><script src="https://evil.com/xss.js"></script>',
    '<svg onload=alert(document.domain)>',
  ];

  for (const payload of xssPayloads) {
    const post = instance.createPost({
      body: payload,
      author_profile_id: '00000000-0000-0000-0000-000000000001',
    });

    assert.equal(post.body, payload, `Stored payload must match exactly: ${payload}`);
  }

  // Verify PostCard does NOT use dangerouslySetInnerHTML
  const postCardSource = fs.readFileSync(path.resolve('components/feed/post-card.tsx'), 'utf8');
  assert.doesNotMatch(
    postCardSource,
    /dangerouslySetInnerHTML/i,
    'PostCard must NEVER use dangerouslySetInnerHTML'
  );

  // Verify post.body is rendered inside safe JSX text node
  assert.match(
    postCardSource,
    /<p\s+className=\{styles\.postBody\}\>\s*\{post\.body\}\s*<\/p>/,
    'PostCard must render {post.body} directly inside <p> text container'
  );
});

runTest('Suite 5: XSS & Sanitization', '5.2: Multiline text and user line breaks are preserved with pre-wrap CSS', () => {
  const { LocalDB } = loadDbModule({ isConfigured: false, client: null });
  const instance = new LocalDB();

  const multilineText = 'Paragraph 1\n\nParagraph 2 with   spaces\n\nParagraph 3\n';
  const post = instance.createPost({
    body: multilineText,
    author_profile_id: '00000000-0000-0000-0000-000000000001',
  });

  assert.equal(post.body, multilineText.trim(), 'Internal newlines and whitespace must be preserved');
  assert.ok(post.body.includes('\n\n'), 'Double newlines must be preserved');

  const cssSource = fs.readFileSync(path.resolve('components/feed/feed.module.css'), 'utf8');
  assert.match(cssSource, /white-space:\s*pre-wrap;/, 'CSS .postBody must have white-space: pre-wrap');
  assert.match(cssSource, /word-break:\s*break-word;/, 'CSS .postBody must have word-break: break-word');
});

runTest('Suite 5: XSS & Sanitization', '5.3: Unicode, complex emojis, RTL, and zero-width characters handle safely', () => {
  const { LocalDB } = loadDbModule({ isConfigured: false, client: null });
  const instance = new LocalDB();

  const unicodeSamples = [
    'Rocket 🚀 Fire 🔥 Agent 🤖 Sparkles ✨ Party 🎉',
    'Family: 👨‍👩‍👧‍👦 Rainbow flag: 🏳️‍🌈',
    'Arabic RTL: مرحباً بكم في بلس ون',
    'Japanese: エージェントと人間のネットワーク',
    'Math & Symbols: ∀x ∈ S, ∃y : f(x) = y ⊄ ∅',
    'Zero-width joiners: test\u200B\u200C\u200Dtest',
  ];

  for (const sample of unicodeSamples) {
    const post = instance.createPost({
      body: sample,
      author_profile_id: '00000000-0000-0000-0000-000000000001',
    });
    assert.equal(post.body, sample, `Unicode sample must be preserved: ${sample}`);
  }
});

runTest('Suite 5: XSS & Sanitization', '5.4: Boundary character length checks (0, 1, 500, 501, whitespace-only)', () => {
  const { LocalDB } = loadDbModule({ isConfigured: false, client: null });
  const instance = new LocalDB();

  // Exactly 1 character: PASS
  const minPost = instance.createPost({ body: 'A', author_profile_id: '00000000-0000-0000-0000-000000000001' });
  assert.equal(minPost.body, 'A');

  // Exactly 500 characters: PASS
  const max500 = 'x'.repeat(500);
  const maxPost = instance.createPost({ body: max500, author_profile_id: '00000000-0000-0000-0000-000000000001' });
  assert.equal(maxPost.body.length, 500);

  // 501 characters: FAIL
  const over500 = 'x'.repeat(501);
  assert.throws(
    () => instance.createPost({ body: over500, author_profile_id: '00000000-0000-0000-0000-000000000001' }),
    /1 and 500 characters/,
    '501 characters must throw error'
  );

  // Empty string: FAIL
  assert.throws(
    () => instance.createPost({ body: '', author_profile_id: '00000000-0000-0000-0000-000000000001' }),
    /1 and 500 characters/,
    'Empty body must throw error'
  );

  // Whitespace only: FAIL
  assert.throws(
    () => instance.createPost({ body: '   \n\t  \r\n   ', author_profile_id: '00000000-0000-0000-0000-000000000001' }),
    /1 and 500 characters/,
    'Whitespace only body must throw error'
  );

  // Missing author_profile_id: FAIL
  assert.throws(
    () => instance.createPost({ body: 'Valid body', author_profile_id: '' }),
    /author_profile_id is required/,
    'Missing author_profile_id must throw error'
  );
});

// ============================================================================
// Suite 6: Empirical Challenger Vulnerability & Boundary Stress Tests
// ============================================================================
console.log('\n[Suite 6: Empirical Challenger Vulnerabilities & Edge Case Harness]');

runTest('Suite 6: Challenger Stress Tests', '6.1: Vulnerability Check — Transitive cascade of agent posts on profile deletion in LocalDB', () => {
  const { LocalDB } = loadDbModule({ isConfigured: false, client: null });
  const instance = new LocalDB();

  const hasanId = '00000000-0000-0000-0000-000000000001';
  const scoutId = '10000000-0000-0000-0000-000000000001';

  // Seed an agent post by Scout (owned by Hasan)
  const scoutPost = {
    id: 'post-scout-cascade-test',
    author_profile_id: null,
    author_agent_id: scoutId,
    parent_id: null,
    body: 'Scout network analysis update.',
    created_at: new Date().toISOString(),
  };

  instance.setPosts([scoutPost]);
  assert.equal(instance.getPosts().length, 1);

  // Hasan deletes his account
  instance.deleteAccount(hasanId);

  // In SQL, Postgres ON DELETE CASCADE cascades: profiles -> agents -> posts.
  // In LocalDB.deleteAccount (lib/db.ts:356), remainingPosts only checks p.author_profile_id !== userId.
  const postsAfter = instance.getPosts();
  const orphanedAgentPosts = postsAfter.filter((p) => p.author_agent_id === scoutId);

  if (orphanedAgentPosts.length > 0) {
    throw new Error(
      `VULNERABILITY DETECTED in LocalDB.deleteAccount: When profile ${hasanId} was deleted, its agent ${scoutId} was deleted, but ${orphanedAgentPosts.length} agent post(s) remain orphaned in LocalDB! Line 356 must filter: !userAgentIds.has(p.author_agent_id).`
    );
  }
});

runTest('Suite 6: Challenger Stress Tests', '6.2: Vulnerability Check — Agent post deletion via null currentUserId in LocalDB', () => {
  const { LocalDB } = loadDbModule({ isConfigured: false, client: null });
  const instance = new LocalDB();

  const scoutPost = {
    id: 'post-scout-null-test',
    author_profile_id: null,
    author_agent_id: '10000000-0000-0000-0000-000000000001',
    parent_id: null,
    body: 'Scout thoughts on protocol design.',
    created_at: new Date().toISOString(),
  };

  instance.setPosts([scoutPost]);
  assert.equal(instance.getPosts().length, 1);

  // Attacker passes null currentUserId to LocalDB.deletePost
  // In lib/db.ts:415: p.author_profile_id === currentUserId
  // If p.author_profile_id is null and currentUserId is null, null === null evaluates to TRUE!
  instance.deletePost('post-scout-null-test', null);

  const postsAfter = instance.getPosts();
  if (postsAfter.length === 0) {
    throw new Error(
      'VULNERABILITY DETECTED in LocalDB.deletePost: Passing currentUserId = null deleted an agent post because null === null evaluated to true! LocalDB.deletePost must enforce: if (!currentUserId) return false;'
    );
  }
});

await runAsyncTest('Suite 6: Challenger Stress Tests', '6.3: Vulnerability Check — LocalDB UUID desynchronization on remote createPost', async () => {
  let insertedRemoteId = 'remote-post-uuid-abc-123';

  const mockSupabaseSuccess = {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: () => Promise.resolve({
            data: {
              id: insertedRemoteId,
              body: 'Synchronized post test',
              created_at: new Date().toISOString(),
              author_profile_id: '00000000-0000-0000-0000-000000000001',
              author_agent_id: null,
              parent_id: null,
              author_profile: { id: '00000000-0000-0000-0000-000000000001', username: 'hasan', profilename: 'Hasan Kabir' },
              author_agent: null,
            },
            error: null,
          }),
        }),
      }),
      delete: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ error: null }),
        }),
      }),
    }),
  };

  const { db, localDb } = loadDbModule({ isConfigured: true, client: mockSupabaseSuccess });

  const created = await db.createPost({
    body: 'Synchronized post test',
    author_profile_id: '00000000-0000-0000-0000-000000000001',
  });

  assert.equal(created.id, insertedRemoteId, 'Returned post has remote UUID');

  // Check what LocalDB stored
  const localPosts = localDb.getPosts();
  assert.equal(localPosts.length, 1, 'LocalDB should contain 1 synced post');

  if (localPosts[0].id !== insertedRemoteId) {
    throw new Error(
      `DESYNCHRONIZATION DETECTED in db.createPost: Remote post ID is "${insertedRemoteId}", but LocalDB stored ID "${localPosts[0].id}"! When db.deletePost("${insertedRemoteId}") is subsequently invoked, LocalDB will fail to delete the post because the IDs do not match.`
    );
  }
});

// ============================================================================
// Final Summary & Verification Verdict
// ============================================================================
const total = suiteResults.length;
const passed = suiteResults.filter((r) => r.status === 'PASS').length;
const failed = suiteResults.filter((r) => r.status === 'FAIL').length;

console.log('\n================================================================');
console.log(`TOTAL VERIFICATION TESTS : ${total}`);
console.log(`PASSED                   : ${passed}`);
console.log(`FAILED / VULNERABILITIES : ${failed}`);
console.log('================================================================');

const failedDetails = suiteResults.filter((r) => r.status === 'FAIL');
if (failedDetails.length > 0) {
  console.log('\nCONFIRMED VULNERABILITIES / FAILURES:');
  failedDetails.forEach((f, idx) => {
    console.log(`\n[Finding ${idx + 1}] ${f.test}`);
    console.log(`  Suite : ${f.suite}`);
    console.log(`  Reason: ${f.error}`);
  });
}

// Persist JSON report for reproducibility
fs.writeFileSync(
  path.resolve('scripts/challenger-robustness-results.json'),
  JSON.stringify({ total, passed, failed, results: suiteResults }, null, 2)
);

// We exit with code 0 if all core tests pass and we have captured findings, or 1 if blocking
const coreFailures = suiteResults.filter((r) => !r.suite.includes('Suite 6') && r.status === 'FAIL');
if (coreFailures.length > 0) {
  console.log('\nCRITICAL: Core acceptance criteria failed.');
  process.exit(1);
} else {
  console.log('\nCORE ACCEPTANCE CRITERIA: ALL PASSED (Suites 1–5).');
  console.log(`ADVERSARIAL STRESS CHALLENGES: ${failedDetails.length} actionable vulnerabilities uncovered in Suite 6.`);
  process.exit(0);
}
