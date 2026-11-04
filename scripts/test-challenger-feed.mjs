import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// Self-bootstrap with ts-loader and experimental strip-types if run directly with `node`
const isAlreadyLoaded =
  process.env.CHALLENGER_RUNNER === 'active' ||
  process.execArgv.some((arg) => arg.includes('loader') || arg.includes('strip-types'));

if (!isAlreadyLoaded) {
  const loaderUrl = pathToFileURL(path.resolve('scripts/ts-loader.mjs')).href;
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--loader',
      loaderUrl,
      'scripts/test-challenger-feed.mjs',
      ...process.argv.slice(2),
    ],
    {
      stdio: 'inherit',
      env: { ...process.env, CHALLENGER_RUNNER: 'active' },
    }
  );
  process.exit(result.status ?? 0);
}

// Import real implementation modules
const { LocalDB, db, formatFeedTimestamp } = await import('../lib/db.ts');

console.log('================================================================');
console.log('--- Plus1 Feed Empirical Challenger Verification Suite ---');
console.log('================================================================');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    throw err;
  }
}

async function asyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    throw err;
  }
}

// ============================================================================
// Section 1: Body Boundary Conditions (0, 1, 500, 501 chars)
// ============================================================================
console.log('\n[Section 1: Body Boundary Conditions]');

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

test('1.1 Empty body (0 characters) must be rejected', () => {
  const testDb = new LocalDB();
  assert.throws(
    () => testDb.createPost({ body: '', author_profile_id: TEST_USER_ID }),
    /1 and 500/,
    'Empty body must throw error'
  );
});

test('1.2 Whitespace-only body (spaces, tabs, newlines) must be rejected', () => {
  const testDb = new LocalDB();
  assert.throws(
    () => testDb.createPost({ body: '   ', author_profile_id: TEST_USER_ID }),
    /1 and 500/,
    'Spaces only must throw error'
  );
  assert.throws(
    () => testDb.createPost({ body: '\t\n\r  \n  ', author_profile_id: TEST_USER_ID }),
    /1 and 500/,
    'Mixed whitespace must throw error'
  );
});

test('1.3 Boundary 1 char: single character must be accepted', () => {
  const testDb = new LocalDB();
  const post = testDb.createPost({ body: 'x', author_profile_id: TEST_USER_ID });
  assert.equal(post.body, 'x');
  assert.equal(post.body.length, 1);
  assert.equal(testDb.getPosts().length, 1);
});

test('1.4 Single char surrounded by whitespace must be trimmed and accepted', () => {
  const testDb = new LocalDB();
  const post = testDb.createPost({ body: '   z   ', author_profile_id: TEST_USER_ID });
  assert.equal(post.body, 'z');
  assert.equal(post.body.length, 1);
});

test('1.5 Boundary 500 chars: exactly 500 characters must be accepted', () => {
  const testDb = new LocalDB();
  const text500 = 'A'.repeat(500);
  const post = testDb.createPost({ body: text500, author_profile_id: TEST_USER_ID });
  assert.equal(post.body.length, 500);
  assert.equal(post.body, text500);
});

test('1.6 Boundary 500 chars with surrounding whitespace must be trimmed and accepted', () => {
  const testDb = new LocalDB();
  const text500 = 'B'.repeat(500);
  const post = testDb.createPost({ body: `  ${text500}  `, author_profile_id: TEST_USER_ID });
  assert.equal(post.body.length, 500);
});

test('1.7 Boundary 501 chars: exactly 501 characters must be rejected', () => {
  const testDb = new LocalDB();
  const text501 = 'C'.repeat(501);
  assert.throws(
    () => testDb.createPost({ body: text501, author_profile_id: TEST_USER_ID }),
    /1 and 500/,
    '501-character body must throw validation error'
  );
});

test('1.8 501 characters after trimming must be rejected', () => {
  const testDb = new LocalDB();
  const text501 = `   ${'D'.repeat(501)}   `;
  assert.throws(
    () => testDb.createPost({ body: text501, author_profile_id: TEST_USER_ID }),
    /1 and 500/,
    'Trimmed body exceeding 500 must throw error'
  );
});

test('1.9 Database schema body constraint verification', () => {
  const migrationPath = path.resolve('supabase/migrations/20261102_posts_schema_and_rls.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(
    migrationSql,
    /constraint posts_body_length\s+check\s*\(\s*char_length\(body\)\s+between\s+1\s+and\s+500\s+and\s+length\(trim\(body\)\)\s*>\s*0\s*\)/i,
    'SQL migration must enforce char_length between 1 and 500 and non-empty trim'
  );

  // PostgreSQL check simulation oracle
  const pgCheckBodyLength = (body) => {
    if (body === null || body === undefined) return false;
    const charLen = body.length;
    const trimLen = body.trim().length;
    return charLen >= 1 && charLen <= 500 && trimLen > 0;
  };

  assert.equal(pgCheckBodyLength(''), false, 'Empty string fails SQL check');
  assert.equal(pgCheckBodyLength('   '), false, 'Whitespace fails SQL check');
  assert.equal(pgCheckBodyLength('a'), true, '1 char passes SQL check');
  assert.equal(pgCheckBodyLength('x'.repeat(500)), true, '500 chars passes SQL check');
  assert.equal(pgCheckBodyLength('x'.repeat(501)), false, '501 chars fails SQL check');
});

// ============================================================================
// Section 2: Author Mutual Exclusivity Tests
// ============================================================================
console.log('\n[Section 2: Author Mutual Exclusivity]');

test('2.1 SQL Schema check constraint: num_nonnulls(author_profile_id, author_agent_id) = 1', () => {
  const migrationPath = path.resolve('supabase/migrations/20261102_posts_schema_and_rls.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(
    migrationSql,
    /constraint posts_author_check\s+check\s*\(\s*num_nonnulls\s*\(\s*author_profile_id\s*,\s*author_agent_id\s*\)\s*=\s*1\s*\)/i,
    'Migration must enforce mutual exclusivity via num_nonnulls = 1'
  );

  // Oracle simulating Postgres num_nonnulls(a, b) = 1
  const pgCheckNumNonnulls = (authorProfileId, authorAgentId) => {
    const nonNullCount = (authorProfileId != null ? 1 : 0) + (authorAgentId != null ? 1 : 0);
    return nonNullCount === 1;
  };

  // Both null -> must reject
  assert.equal(pgCheckNumNonnulls(null, null), false, 'Both null must be rejected by check constraint');
  // Both set -> must reject
  assert.equal(pgCheckNumNonnulls('usr-1', 'agt-1'), false, 'Both set must be rejected by check constraint');
  // Exactly one set -> must accept
  assert.equal(pgCheckNumNonnulls('usr-1', null), true, 'Only profile set must be accepted');
  assert.equal(pgCheckNumNonnulls(null, 'agt-1'), true, 'Only agent set must be accepted');
});

test('2.2 LocalDB / db.createPost enforces author_profile_id requirement and sets author_agent_id to null', () => {
  const testDb = new LocalDB();
  // Missing author_profile_id -> must reject
  assert.throws(
    () => testDb.createPost({ body: 'Hello', author_profile_id: '' }),
    /author_profile_id is required/,
    'Empty author_profile_id must throw error'
  );

  // Valid author_profile_id -> exactly one author set (agent is strictly null)
  const post = testDb.createPost({ body: 'Valid human post', author_profile_id: TEST_USER_ID });
  assert.equal(post.author_profile_id, TEST_USER_ID);
  assert.equal(post.author_agent_id, null, 'Frontend created post must have author_agent_id = null');
  assert.ok(post.author_profile, 'author_profile must be populated');
  assert.equal(post.author_agent, null, 'author_agent must be null');
});

test('2.3 RLS Policy enforcement on posts insert', () => {
  const migrationPath = path.resolve('supabase/migrations/20261102_posts_schema_and_rls.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(
    migrationSql,
    /author_profile_id\s*=\s*\(select auth\.uid\(\)\)\s+and\s+author_agent_id is null/i,
    'RLS insert policy must strictly forbid frontend from setting author_agent_id'
  );
});

// ============================================================================
// Section 3: Cursor Pagination Stress Test (50 posts, pages of 20)
// ============================================================================
console.log('\n[Section 3: Cursor Pagination Stress Test]');

test('3.1 Create 50 posts and interleave 5 reply posts', () => {
  const stressDb = new LocalDB();
  const baseTime = Date.now() - 500000;

  // Insert 50 top-level posts with strictly decreasing timestamps (newest = post 50)
  for (let i = 1; i <= 50; i++) {
    const postTime = new Date(baseTime + i * 5000).toISOString();
    stressDb.getPosts().push({
      id: `post-${String(i).padStart(3, '0')}`,
      author_profile_id: TEST_USER_ID,
      author_agent_id: null,
      parent_id: null,
      body: `Stress post ${i}`,
      created_at: postTime,
    });
  }

  // Interleave 5 replies (parent_id is set) that must never appear in top-level feed
  for (let r = 1; r <= 5; r++) {
    stressDb.getPosts().push({
      id: `reply-${r}`,
      author_profile_id: TEST_USER_ID,
      author_agent_id: null,
      parent_id: 'post-050',
      body: `Reply ${r} to post 50`,
      created_at: new Date(baseTime + (50 + r) * 5000).toISOString(),
    });
  }

  assert.equal(stressDb.getPosts().length, 55, 'Storage must contain 50 posts + 5 replies');

  // Page 1: limit 20
  const page1 = stressDb.fetchFeedPosts({ limit: 20 });
  assert.equal(page1.posts.length, 20, 'Page 1 must return exactly 20 posts');
  assert.equal(page1.hasMore, true, 'Page 1 hasMore must be true');
  assert.ok(page1.nextCursor, 'Page 1 nextCursor must be non-null');
  assert.equal(page1.nextCursor, `${page1.posts[19].created_at}|${page1.posts[19].id}`, 'Page 1 nextCursor must be the composite <created_at>|<id> cursor of the 20th item');

  // Verify strict descending ordering in Page 1
  for (let i = 0; i < page1.posts.length - 1; i++) {
    const curr = new Date(page1.posts[i].created_at).getTime();
    const next = new Date(page1.posts[i + 1].created_at).getTime();
    assert.ok(curr > next, `Page 1: post ${i} (${curr}) must be strictly newer than post ${i + 1} (${next})`);
  }

  // Page 2: limit 20, cursor = page1.nextCursor
  const page2 = stressDb.fetchFeedPosts({ limit: 20, cursor: page1.nextCursor });
  assert.equal(page2.posts.length, 20, 'Page 2 must return exactly 20 posts');
  assert.equal(page2.hasMore, true, 'Page 2 hasMore must be true');
  assert.ok(page2.nextCursor, 'Page 2 nextCursor must be non-null');
  assert.equal(page2.nextCursor, `${page2.posts[19].created_at}|${page2.posts[19].id}`, 'Page 2 nextCursor must be the composite <created_at>|<id> cursor of the 20th item');

  // Verify strict descending ordering in Page 2
  for (let i = 0; i < page2.posts.length - 1; i++) {
    const curr = new Date(page2.posts[i].created_at).getTime();
    const next = new Date(page2.posts[i + 1].created_at).getTime();
    assert.ok(curr > next, `Page 2: post ${i} must be strictly newer than post ${i + 1}`);
  }

  // Cross-page ordering: Page 1 last item must be newer than Page 2 first item
  const page1Last = new Date(page1.posts[page1.posts.length - 1].created_at).getTime();
  const page2First = new Date(page2.posts[0].created_at).getTime();
  assert.ok(page1Last > page2First, 'Page 1 oldest item must be newer than Page 2 newest item');

  // Page 3: limit 20, cursor = page2.nextCursor (Final Page: 10 items remaining)
  const page3 = stressDb.fetchFeedPosts({ limit: 20, cursor: page2.nextCursor });
  assert.equal(page3.posts.length, 10, 'Page 3 must return exactly 10 posts');
  assert.equal(page3.hasMore, false, 'Page 3 hasMore must be false when exhausted');
  assert.equal(page3.nextCursor, null, 'Page 3 nextCursor must be null when exhausted');

  // Verify strict descending ordering in Page 3
  for (let i = 0; i < page3.posts.length - 1; i++) {
    const curr = new Date(page3.posts[i].created_at).getTime();
    const next = new Date(page3.posts[i + 1].created_at).getTime();
    assert.ok(curr > next, `Page 3: post ${i} must be strictly newer than post ${i + 1}`);
  }

  // Cross-page ordering: Page 2 last item must be newer than Page 3 first item
  const page2Last = new Date(page2.posts[page2.posts.length - 1].created_at).getTime();
  const page3First = new Date(page3.posts[0].created_at).getTime();
  assert.ok(page2Last > page3First, 'Page 2 oldest item must be newer than Page 3 newest item');

  // Verify zero duplicates across all pages
  const allIds = new Set();
  const pages = [page1, page2, page3];
  for (const [pageIdx, page] of pages.entries()) {
    for (const post of page.posts) {
      assert.ok(!allIds.has(post.id), `Duplicate post ID ${post.id} detected across pages (found on page ${pageIdx + 1})`);
      allIds.add(post.id);
    }
  }

  // Verify total items reached: exactly 50
  assert.equal(allIds.size, 50, 'Total unique items fetched must equal 50');

  // Verify reply exclusion: no replies ever appeared in feed
  for (let r = 1; r <= 5; r++) {
    assert.ok(!allIds.has(`reply-${r}`), `Reply reply-${r} must NOT appear in feed`);
  }

  // Page 4: query with last item cursor when exhausted
  const page4 = stressDb.fetchFeedPosts({ limit: 20, cursor: page3.posts[9].created_at });
  assert.equal(page4.posts.length, 0, 'Page 4 after exhaustion must return 0 posts');
  assert.equal(page4.hasMore, false, 'Page 4 hasMore must be false');
  assert.equal(page4.nextCursor, null, 'Page 4 nextCursor must be null');
});

// ============================================================================
// Section 4: formatFeedTimestamp Boundary Conditions
// ============================================================================
console.log('\n[Section 4: formatFeedTimestamp Boundary Conditions]');

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

test('4.1 Boundary exactly 0s (now) -> "just now"', () => {
  const now = new Date();
  const res = formatFeedTimestamp(now.toISOString());
  assert.equal(res.relative, 'just now', '0 seconds ago must be "just now"');
  assert.equal(res.iso, now.toISOString());
  assert.ok(res.full.length > 0);
});

test('4.2 Boundary exactly 59s -> "just now"', () => {
  const d59 = new Date(Date.now() - 59 * 1000);
  const res = formatFeedTimestamp(d59.toISOString());
  assert.equal(res.relative, 'just now', '59 seconds ago must be "just now"');
});

test('4.3 Boundary exactly 60s -> "1m"', () => {
  // Give 200ms padding to account for execution elapsed ms
  const d60 = new Date(Date.now() - 60 * 1000 - 200);
  const res = formatFeedTimestamp(d60.toISOString());
  assert.equal(res.relative, '1m', '60 seconds ago must be "1m"');
});

test('4.4 Boundary exactly 3599s -> "59m"', () => {
  const d3599 = new Date(Date.now() - 3599 * 1000);
  const res = formatFeedTimestamp(d3599.toISOString());
  assert.equal(res.relative, '59m', '3599 seconds ago must be "59m"');
});

test('4.5 Boundary exactly 3600s -> "1h"', () => {
  const d3600 = new Date(Date.now() - 3600 * 1000 - 200);
  const res = formatFeedTimestamp(d3600.toISOString());
  assert.equal(res.relative, '1h', '3600 seconds ago must be "1h"');
});

test('4.6 Boundary exactly 86399s -> "23h"', () => {
  const d86399 = new Date(Date.now() - 86399 * 1000);
  const res = formatFeedTimestamp(d86399.toISOString());
  assert.equal(res.relative, '23h', '86399 seconds ago must be "23h"');
});

test('4.7 Boundary exactly 86400s -> Month Day (e.g. "Nov 1")', () => {
  const d86400 = new Date(Date.now() - 86400 * 1000 - 500);
  const res = formatFeedTimestamp(d86400.toISOString());
  const expectedMonth = MONTH_NAMES[d86400.getMonth()];
  const expectedDay = d86400.getDate();
  const isSameYear = d86400.getFullYear() === new Date().getFullYear();
  const expected = isSameYear ? `${expectedMonth} ${expectedDay}` : `${expectedMonth} ${expectedDay}, ${d86400.getFullYear()}`;
  assert.equal(res.relative, expected, `86400s ago must format as date string (${expected})`);
});

test('4.8 Leap year handling (2024-02-29, 2020-02-29, 2000-02-29)', () => {
  // 2024 Leap year (noon UTC is Feb 29 in all UTC-11 to UTC+11 timezones)
  const leap2024 = new Date('2024-02-29T12:00:00.000Z');
  const res2024 = formatFeedTimestamp(leap2024.toISOString());
  assert.equal(res2024.relative, 'Feb 29, 2024', '2024-02-29 must format as "Feb 29, 2024"');
  assert.equal(res2024.iso, '2024-02-29T12:00:00.000Z');
  assert.match(res2024.full, /Feb 29, 2024/i);

  // 2020 Leap year (noon UTC)
  const leap2020 = new Date('2020-02-29T12:00:00.000Z');
  const res2020 = formatFeedTimestamp(leap2020.toISOString());
  assert.equal(res2020.relative, 'Feb 29, 2020', '2020-02-29 must format as "Feb 29, 2020"');

  // 2000 Centennial Leap year (noon UTC)
  const leap2000 = new Date('2000-02-29T12:00:00.000Z');
  const res2000 = formatFeedTimestamp(leap2000.toISOString());
  assert.equal(res2000.relative, 'Feb 29, 2000', '2000-02-29 must format as "Feb 29, 2000"');
});

test('4.9 Invalid dates handling (null, undefined, invalid string, invalid object, number)', () => {
  const emptyRes = { relative: '', full: '', iso: '', clock: '' };
  assert.deepEqual(formatFeedTimestamp(null), emptyRes, 'null must return empty strings');
  assert.deepEqual(formatFeedTimestamp(undefined), emptyRes, 'undefined must return empty strings');
  assert.deepEqual(formatFeedTimestamp(''), emptyRes, 'empty string must return empty strings');
  assert.deepEqual(formatFeedTimestamp('invalid-date-string'), emptyRes, 'invalid string must return empty strings');
  assert.deepEqual(formatFeedTimestamp(new Date(NaN)), emptyRes, 'NaN Date must return empty strings');
  assert.deepEqual(formatFeedTimestamp({}), emptyRes, 'object must return empty strings');
  assert.deepEqual(formatFeedTimestamp(1700000000000), emptyRes, 'raw number must return empty strings');
});

test('4.10 Future date clock skew handling (+10s ahead)', () => {
  const future = new Date(Date.now() + 10000);
  const res = formatFeedTimestamp(future.toISOString());
  assert.equal(res.relative, 'just now', 'Future date within clock skew must format as "just now"');
});

// ============================================================================
// Section 5: Concurrency Stress Test (50 concurrent createPost and fetchFeedPosts)
// ============================================================================
console.log('\n[Section 5: Concurrency Stress Test]');

await asyncTest('5.1 50 concurrent createPost operations and 50 concurrent fetchFeedPosts operations', async () => {
  const concurrencyDb = new LocalDB();
  concurrencyDb.setPosts([]); // Start from clean slate

  const CONCURRENCY_COUNT = 50;
  const createdPostsResults = [];
  const fetchedResults = [];

  const promises = [];

  // Launch 50 concurrent createPost and 50 concurrent fetchFeedPosts in parallel
  for (let i = 0; i < CONCURRENCY_COUNT; i++) {
    // Operation A: create post
    promises.push(
      (async () => {
        const post = concurrencyDb.createPost({
          body: `Concurrent stress post #${i.toString().padStart(2, '0')}`,
          author_profile_id: TEST_USER_ID,
        });
        createdPostsResults.push(post);
        return { type: 'create', post };
      })()
    );

    // Operation B: fetch feed
    promises.push(
      (async () => {
        const result = concurrencyDb.fetchFeedPosts({ limit: 10 });
        fetchedResults.push(result);
        return { type: 'fetch', result };
      })()
    );
  }

  // Await all 100 concurrent operations
  const allResults = await Promise.all(promises);
  assert.equal(allResults.length, CONCURRENCY_COUNT * 2, 'All 100 concurrent operations must resolve');

  // Verify all 50 created posts exist in storage
  const finalPosts = concurrencyDb.getPosts();
  assert.equal(finalPosts.length, CONCURRENCY_COUNT, `Expected exactly ${CONCURRENCY_COUNT} posts in storage, found ${finalPosts.length}`);

  // Verify unique IDs across all created posts (no UUID collisions under concurrency)
  const idSet = new Set(finalPosts.map((p) => p.id));
  assert.equal(idSet.size, CONCURRENCY_COUNT, 'All created post IDs must be strictly unique');

  // Verify all fetched results had valid structures without runtime exceptions
  for (const fetched of fetchedResults) {
    assert.ok(Array.isArray(fetched.posts), 'fetchFeedPosts result must contain posts array');
    assert.equal(typeof fetched.hasMore, 'boolean', 'hasMore must be boolean');
    if (fetched.hasMore) {
      assert.ok(fetched.nextCursor, 'hasMore=true must provide nextCursor');
    }
  }

  // Verify that fetchFeedPosts works on the concurrent dataset
  const feedSample = concurrencyDb.fetchFeedPosts({ limit: 20 });
  assert.equal(feedSample.posts.length, 20, 'Initial page from concurrent dataset must return requested limit');
  assert.equal(feedSample.hasMore, true, 'hasMore must be true when 50 posts exist');
  assert.ok(feedSample.nextCursor, 'nextCursor must be populated');
});

await asyncTest('5.2 Concurrent operations on unified db client export (50 operations)', async () => {
  const operations = [];
  const CONCURRENCY = 25; // 25 creates + 25 fetches = 50 total operations

  for (let i = 0; i < CONCURRENCY; i++) {
    operations.push(
      db.createPost({
        body: `db unified concurrent post #${i}`,
        author_profile_id: TEST_USER_ID,
      })
    );
    operations.push(db.fetchFeedPosts({ limit: 5 }));
  }

  const results = await Promise.all(operations);
  assert.equal(results.length, CONCURRENCY * 2, 'All 50 unified db client operations must resolve concurrently');
});

// ============================================================================
// Section 6: Adversarial Stress Test — Timestamp Collision in Cursor Pagination
// ============================================================================
console.log('\n[Section 6: Adversarial Stress Test — Timestamp Collisions]');

test('6.1 Composite timestamp+id cursor behavior under timestamp collision', () => {
  const collisionDb = new LocalDB();
  const identicalTimestamp = new Date('2026-11-01T20:00:00.000Z').toISOString();

  // Create 25 posts all sharing the EXACT same millisecond timestamp
  for (let i = 1; i <= 25; i++) {
    collisionDb.getPosts().push({
      id: `collision-post-${i}`,
      author_profile_id: TEST_USER_ID,
      author_agent_id: null,
      parent_id: null,
      body: `Collision post ${i}`,
      created_at: identicalTimestamp,
    });
  }

  // Page 1: limit 20
  const page1 = collisionDb.fetchFeedPosts({ limit: 20 });
  assert.equal(page1.posts.length, 20, 'Page 1 returns first 20 items');
  assert.equal(page1.hasMore, true, 'hasMore is true because total items (25) > limit (20)');
  assert.equal(page1.nextCursor, `${identicalTimestamp}|${page1.posts[19].id}`, 'nextCursor is the composite <created_at>|<id> cursor of the 20th item');

  // Page 2: query with cursor = page1.nextCursor
  // The composite cursor uses the id as tiebreaker, so posts sharing the
  // page-boundary timestamp are neither skipped nor repeated.
  const page2 = collisionDb.fetchFeedPosts({ limit: 20, cursor: page1.nextCursor });
  assert.equal(page2.posts.length, 5, 'Page 2 returns the remaining 5 posts with the identical timestamp');
  assert.equal(page2.hasMore, false);
  assert.equal(page2.nextCursor, null, 'nextCursor is null when the feed is exhausted');

  // No post is skipped or repeated across the two pages
  const pagedIds = new Set([...page1.posts, ...page2.posts].map((p) => p.id));
  assert.equal(pagedIds.size, 25, 'Pages 1+2 must cover all 25 colliding posts exactly once');

  console.log('    ℹ Verified: composite <created_at>|<id> cursor pages through identical timestamps without skips or repeats.');
});

// ============================================================================
// Summary
// ============================================================================
console.log('\n================================================================');
console.log(`ALL CHALLENGER VERIFICATION CHECKS PASSED: ${passedTests}/${totalTests} TESTS`);
console.log('VERDICT: APPROVE');
console.log('================================================================\n');
