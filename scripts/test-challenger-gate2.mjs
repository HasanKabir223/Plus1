import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

console.log('================================================================');
console.log('--- Challenger Gate 2 Empirical Deep Stress & Edge-Case Suite ---');
console.log('================================================================');

// Helper to transpile and load lib/db.ts
function loadDb() {
  const dbSource = fs.readFileSync(path.resolve('lib/db.ts'), 'utf8');
  const transpiled = ts.transpileModule(dbSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });

  let code = transpiled.outputText;
  code = code.replace(
    /import\s*\{\s*supabase\s*,\s*isSupabaseConfigured\s*\}\s*from\s*['"][^'"]+['"];?/,
    `const isSupabaseConfigured = false; const supabase = null;`
  );
  code = code.replace(/export\s+\{\s*localDb\s*,\s*LocalDB\s*\};?/g, '');
  code = code.replace(/export\s+const\s+db\s*=/g, 'const db =');
  code = code.replace(/export\s+function\s+formatRelativeTime/g, 'function formatRelativeTime');
  code = code.replace(/export\s+function\s+formatFeedTimestamp/g, 'function formatFeedTimestamp');

  const factory = new Function(`
    ${code}
    return { LocalDB, localDb, db, formatFeedTimestamp, INITIAL_POSTS };
  `);

  return factory();
}

const { LocalDB, formatFeedTimestamp, INITIAL_POSTS } = loadDb();

let passed = 0;
let total = 0;

function runTest(name, fn) {
  total++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.stack || err.message}`);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  total++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.stack || err.message}`);
    throw err;
  }
}

const USER_A = '00000000-0000-0000-0000-000000000001';
const USER_B = '00000000-0000-0000-0000-000000000002';

// ----------------------------------------------------------------------------
// Test Group 1: Cursor Pagination Boundaries & Malformed Input
// ----------------------------------------------------------------------------
console.log('\n[Group 1: Cursor Pagination Boundaries & Malformed Input]');

runTest('1.1 Empty dataset: fetchFeedPosts returns empty array with hasMore=false and nextCursor=null', () => {
  const db = new LocalDB();
  db.setPosts([]);
  const result = db.fetchFeedPosts();
  assert.equal(result.posts.length, 0);
  assert.equal(result.hasMore, false);
  assert.equal(result.nextCursor, null);
});

runTest('1.2 Single item dataset with limit=1: hasMore=false, nextCursor=null', () => {
  const db = new LocalDB();
  db.setPosts([]);
  db.createPost({ body: 'Lone post', author_profile_id: USER_A });
  const result = db.fetchFeedPosts({ limit: 1 });
  assert.equal(result.posts.length, 1);
  assert.equal(result.hasMore, false, 'hasMore must be false when items equal limit');
  assert.equal(result.nextCursor, null);
});

runTest('1.3 Exactly 20 items with default limit 20: hasMore=false, nextCursor=null', () => {
  const db = new LocalDB();
  db.setPosts([]);
  const baseTime = Date.now() - 200000;
  for (let i = 0; i < 20; i++) {
    db.getPosts().push({
      id: `p-${i}`,
      author_profile_id: USER_A,
      author_agent_id: null,
      parent_id: null,
      body: `Post ${i}`,
      created_at: new Date(baseTime + i * 1000).toISOString(),
    });
  }
  const result = db.fetchFeedPosts({ limit: 20 });
  assert.equal(result.posts.length, 20);
  assert.equal(result.hasMore, false, 'Exactly 20 items must not show hasMore');
  assert.equal(result.nextCursor, null);
});

runTest('1.4 Exactly 21 items with limit 20: page 1 hasMore=true, page 2 hasMore=false with 1 item', () => {
  const db = new LocalDB();
  db.setPosts([]);
  const baseTime = Date.now() - 210000;
  for (let i = 0; i < 21; i++) {
    db.getPosts().push({
      id: `p-${i}`,
      author_profile_id: USER_A,
      author_agent_id: null,
      parent_id: null,
      body: `Post ${i}`,
      created_at: new Date(baseTime + i * 1000).toISOString(),
    });
  }
  const page1 = db.fetchFeedPosts({ limit: 20 });
  assert.equal(page1.posts.length, 20);
  assert.equal(page1.hasMore, true);
  assert.ok(page1.nextCursor);

  const page2 = db.fetchFeedPosts({ limit: 20, cursor: page1.nextCursor });
  assert.equal(page2.posts.length, 1);
  assert.equal(page2.hasMore, false);
  assert.equal(page2.nextCursor, null);
  assert.equal(page2.posts[0].id, 'p-0', 'Oldest item must be on page 2');
});

runTest('1.5 Malformed or non-existent cursor: handles gracefully without throwing', () => {
  const db = new LocalDB();
  db.setPosts([]);
  db.createPost({ body: 'Post', author_profile_id: USER_A });

  // Non-date string cursor -> new Date('bogus').getTime() is NaN
  // In JS, `x < NaN` is false, so all posts filtered out
  const bogusResult = db.fetchFeedPosts({ cursor: 'invalid-cursor-string' });
  assert.equal(bogusResult.posts.length, 0);
  assert.equal(bogusResult.hasMore, false);

  // Future cursor -> returns all items
  const futureCursor = new Date(Date.now() + 100000).toISOString();
  const futureResult = db.fetchFeedPosts({ cursor: futureCursor });
  assert.equal(futureResult.posts.length, 1);

  // Prehistoric cursor -> returns 0 items
  const pastCursor = new Date(0).toISOString();
  const pastResult = db.fetchFeedPosts({ cursor: pastCursor });
  assert.equal(pastResult.posts.length, 0);
});

// ----------------------------------------------------------------------------
// Test Group 2: Body Unicode, Special Characters & Injection Resilience
// ----------------------------------------------------------------------------
console.log('\n[Group 2: Body Unicode, Special Characters & Injection Resilience]');

runTest('2.1 Multi-byte 4-byte unicode emojis and surrogate pairs', () => {
  const db = new LocalDB();
  db.setPosts([]);
  const emojiBody = '🔥🚀✨🤖🎉👍'.repeat(10);
  const post = db.createPost({ body: emojiBody, author_profile_id: USER_A });
  assert.equal(post.body, emojiBody);
  assert.equal(db.getPosts()[0].body, emojiBody);
});

runTest('2.2 Preserves internal newlines and multiline structures without altering indentation', () => {
  const db = new LocalDB();
  db.setPosts([]);
  const multiline = 'Line 1\n\n  Line 2 (indented)\n\nLine 3';
  const post = db.createPost({ body: multiline, author_profile_id: USER_A });
  assert.equal(post.body, multiline);
});

runTest('2.3 SQL injection and script strings handled safely as raw plain text', () => {
  const db = new LocalDB();
  db.setPosts([]);
  const sqli = "'; DROP TABLE posts; -- <script>alert('xss')</script>";
  const post = db.createPost({ body: sqli, author_profile_id: USER_A });
  assert.equal(post.body, sqli);
});

// ----------------------------------------------------------------------------
// Test Group 3: High-Churn Concurrent Operations Simulation
// ----------------------------------------------------------------------------
console.log('\n[Group 3: High-Churn Concurrent Operations Simulation]');

await runAsyncTest('3.1 100 concurrent interleaved operations (create, fetch, delete)', async () => {
  const db = new LocalDB();
  db.setPosts([]);

  const ops = [];
  const createdIds = [];

  for (let i = 0; i < 50; i++) {
    // 50 creates
    ops.push(
      (async () => {
        const post = db.createPost({ body: `Concurrent item ${i}`, author_profile_id: USER_A });
        createdIds.push(post.id);
        return { type: 'create', id: post.id };
      })()
    );

    // 50 reads
    ops.push(
      (async () => {
        const res = db.fetchFeedPosts({ limit: 10 });
        return { type: 'fetch', count: res.posts.length };
      })()
    );
  }

  const results = await Promise.all(ops);
  assert.equal(results.length, 100);
  assert.equal(db.getPosts().length, 50);

  // Now delete 25 of them concurrently
  const deleteOps = [];
  for (let i = 0; i < 25; i++) {
    const idToDelete = createdIds[i];
    deleteOps.push(
      (async () => {
        const ok = db.deletePost(idToDelete, USER_A);
        return { type: 'delete', ok };
      })()
    );
  }

  const deleteResults = await Promise.all(deleteOps);
  assert.equal(deleteResults.length, 25);
  assert.equal(db.getPosts().length, 25, 'Storage must have exactly 25 remaining posts');

  // Attempting to delete again returns false
  for (let i = 0; i < 25; i++) {
    const idToDelete = createdIds[i];
    assert.equal(db.deletePost(idToDelete, USER_A), false, 'Second deletion must return false');
  }
});

// ----------------------------------------------------------------------------
// Test Group 4: Mutual Exclusivity and Agent Attribution
// ----------------------------------------------------------------------------
console.log('\n[Group 4: Mutual Exclusivity and Agent Attribution]');

runTest('4.1 Agent posts correctly embed owner attribution when present in LocalDB', () => {
  const db = new LocalDB();
  db.setPosts([]);

  const agentPost = {
    id: 'post-agent-test',
    author_profile_id: null,
    author_agent_id: '10000000-0000-0000-0000-000000000001', // Scout
    parent_id: null,
    body: 'Automated synthesis report',
    created_at: new Date().toISOString(),
  };
  db.setPosts([agentPost]);

  const feed = db.fetchFeedPosts();
  assert.equal(feed.posts.length, 1);
  const p = feed.posts[0];
  assert.equal(p.author_profile, null);
  assert.ok(p.author_agent);
  assert.equal(p.author_agent.name, 'Scout');
  assert.ok(p.author_agent.owner);
  assert.equal(p.author_agent.owner.username, 'hasan');
});

runTest('4.2 Agent post cannot be deleted by human user', () => {
  const db = new LocalDB();
  db.setPosts([]);

  const agentPost = {
    id: 'post-agent-delete-test',
    author_profile_id: null,
    author_agent_id: '10000000-0000-0000-0000-000000000001',
    parent_id: null,
    body: 'Permanent agent dispatch',
    created_at: new Date().toISOString(),
  };
  db.setPosts([agentPost]);

  // Attempt delete with human user ID
  const deleted = db.deletePost('post-agent-delete-test', USER_A);
  assert.equal(deleted, false, 'Human cannot delete agent post');
  assert.equal(db.getPosts().length, 1);
});

// ----------------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`ALL DEEP STRESS & EDGE-CASE TESTS PASSED: ${passed}/${total}`);
console.log('================================================================\n');
