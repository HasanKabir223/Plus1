import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import vm from 'node:vm';

console.log('================================================================');
console.log('ADVERSARIAL STRESS TEST HARNESS: FOLLOWERS & FOLLOWING SUBSYSTEM');
console.log('================================================================');

// -----------------------------------------------------------------------------
// Helper: Instantiate fresh lib/db runtime from actual source code
// -----------------------------------------------------------------------------
function createFreshDbRuntime() {
  const srcRaw = fs.readFileSync(path.resolve('lib/db.ts'), 'utf8');
  // Decouple remote Supabase client so runtime tests offline fallback directly
  const src = srcRaw.replace(
    /import\s*\{\s*supabase,\s*isSupabaseConfigured\s*\}\s*from\s*['"].\/supabase\/client['"];?/,
    'const supabase = null; const isSupabaseConfigured = false;'
  );

  const transpiled = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const cjsModule = { exports: {} };
  const context = vm.createContext({
    module: cjsModule,
    exports: cjsModule.exports,
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
      info: () => {},
    },
    require: () => ({}),
    process,
    Date,
    Set,
    Map,
    Array,
    Object,
    Number,
    String,
    Boolean,
    JSON,
    Math,
    Error,
    setTimeout,
    clearTimeout,
  });

  vm.runInContext(transpiled, context);
  const { db, LocalDB, localDb } = cjsModule.exports;
  return { db, LocalDB, localDb };
}

// =============================================================================
// TEST SUITE 1: CONCURRENCY & RAPID SEQUENCES
// =============================================================================
console.log('\n[Suite 1: Concurrency & Rapid Sequences]');

{
  const { db, localDb } = createFreshDbRuntime();
  const uA = 'user-concurrent-a';
  const uB = 'user-concurrent-b';

  localDb.setProfiles([
    { id: uA, username: 'user_a', name: 'User A' },
    { id: uB, username: 'user_b', name: 'User B' },
  ]);

  // Test 1.1: 200 Parallel followUser calls
  const parallelFollows = Array.from({ length: 200 }, () => db.followUser(uA, uB));
  await Promise.all(parallelFollows);

  const statsB = await db.getProfileStats(uB);
  const statsA = await db.getProfileStats(uA);
  const follows = localDb.getFollows();

  assert.strictEqual(statsB.follower_count, 1, 'Concurrent 200 follows must yield exactly 1 follower');
  assert.strictEqual(statsA.following_count, 1, 'Concurrent 200 follows must yield exactly 1 following');
  assert.strictEqual(follows.filter((f) => f.follower_id === uA && f.following_id === uB).length, 1, 'Only 1 follow record stored');
  console.log('  ✓ 1.1: 200 concurrent follow calls correctly resolved to exactly 1 record');

  // Test 1.2: 200 Parallel unfollowUser calls
  const parallelUnfollows = Array.from({ length: 200 }, () => db.unfollowUser(uA, uB));
  await Promise.all(parallelUnfollows);

  const statsBAfter = await db.getProfileStats(uB);
  const statsAAfter = await db.getProfileStats(uA);
  assert.strictEqual(statsBAfter.follower_count, 0, 'Concurrent 200 unfollows must yield exactly 0 followers');
  assert.strictEqual(statsAAfter.following_count, 0, 'Concurrent 200 unfollows must yield exactly 0 following');
  assert.strictEqual(localDb.getFollows().length, 0, 'Zero follow records remaining');
  console.log('  ✓ 1.2: 200 concurrent unfollow calls correctly resolved to exactly 0 records');

  // Test 1.3: High-speed alternating bursts (100 sequential rapid toggles)
  for (let i = 0; i < 100; i++) {
    if (i % 2 === 0) {
      await db.followUser(uA, uB);
    } else {
      await db.unfollowUser(uA, uB);
    }
  }
  // 100 iterations (0..99), i=99 is odd -> unfollowUser was last operation
  const statsFinalBurst = await db.getProfileStats(uB);
  assert.strictEqual(statsFinalBurst.follower_count, 0, 'After 100 alternating toggles ending in unfollow, count is 0');
  assert.strictEqual(await db.isFollowing(uA, uB), false, 'isFollowing returns false after alternating toggles');
  console.log('  ✓ 1.3: 100 rapid alternating follow/unfollow cycles maintained perfect synchronization');

  // Test 1.4: Randomized race: 100 concurrent promises interweaving follow and unfollow
  const racePromises = [];
  for (let i = 0; i < 100; i++) {
    if (Math.random() < 0.5) {
      racePromises.push(db.followUser(uA, uB));
    } else {
      racePromises.push(db.unfollowUser(uA, uB));
    }
  }
  await Promise.all(racePromises);

  const raceFollowing = await db.isFollowing(uA, uB);
  const raceStats = await db.getProfileStats(uB);
  const raceCount = raceStats.follower_count;
  assert.ok(raceCount === 0 || raceCount === 1, 'Follower count must be strictly 0 or 1');
  assert.strictEqual(raceCount === 1, raceFollowing, 'follower_count must exactly match isFollowing boolean');
  assert.strictEqual(localDb.getFollows().length, raceCount, 'Storage length matches follower count');
  console.log('  ✓ 1.4: Randomized concurrent race condition resolved into deterministic consistent state');
}

// =============================================================================
// TEST SUITE 2: DUPLICATE FOLLOWS & IDEMPOTENCY UNDER LOAD
// =============================================================================
console.log('\n[Suite 2: Duplicate Follows & Idempotency Under Load]');

{
  const { db, localDb } = createFreshDbRuntime();
  const u1 = 'user-idem-1';
  const u2 = 'user-idem-2';

  localDb.setProfiles([
    { id: u1, username: 'user1', name: 'User 1' },
    { id: u2, username: 'user2', name: 'User 2' },
  ]);

  // Initial follow
  await db.followUser(u1, u2);
  assert.strictEqual(await db.isFollowing(u1, u2), true);

  // 25 repeated follow requests on already followed pair
  for (let i = 0; i < 25; i++) {
    await db.followUser(u1, u2);
  }
  const s2 = await db.getProfileStats(u2);
  const s1 = await db.getProfileStats(u1);
  assert.strictEqual(s2.follower_count, 1, '25 duplicate follows did not inflate follower count');
  assert.strictEqual(s1.following_count, 1, '25 duplicate follows did not inflate following count');
  assert.strictEqual(localDb.getFollows().length, 1, 'Storage contains exactly 1 row');
  console.log('  ✓ 2.1: 25 sequential duplicate follow calls preserved idempotency (count=1, rows=1)');

  // 25 repeated unfollow requests on unfollowed pair
  await db.unfollowUser(u1, u2);
  for (let i = 0; i < 25; i++) {
    await db.unfollowUser(u1, u2);
  }
  const s2Un = await db.getProfileStats(u2);
  assert.strictEqual(s2Un.follower_count, 0, '25 duplicate unfollows did not error or produce negative count');
  assert.strictEqual(localDb.getFollows().length, 0, 'Storage contains 0 rows');
  console.log('  ✓ 2.2: 25 sequential duplicate unfollow calls safely no-op without error');

  // Supabase unique violation code 23505 handling check in source code
  const dbSrc = fs.readFileSync('lib/db.ts', 'utf8');
  assert.match(
    dbSrc,
    /error\.code\s*!==\s*['"]23505['"]/,
    'lib/db.ts must explicitly catch and tolerate PostgreSQL error 23505 (unique_violation)'
  );
  console.log('  ✓ 2.3: Verified PostgreSQL unique_violation code 23505 resilience in lib/db.ts');
}

// =============================================================================
// TEST SUITE 3: SELF-FOLLOW REJECTION & INPUT DEFENSE
// =============================================================================
console.log('\n[Suite 3: Self-Follow Rejection & Input Defense]');

{
  const { db, localDb } = createFreshDbRuntime();
  const uSelf = 'user-self-uuid';

  localDb.setProfiles([
    { id: uSelf, username: 'myself', name: 'Myself' },
  ]);

  // Test 3.1: followUser self-follow rejection
  await assert.rejects(
    async () => {
      await db.followUser(uSelf, uSelf);
    },
    {
      name: 'Error',
      message: 'Users cannot follow themselves',
    },
    'db.followUser(uSelf, uSelf) must reject with "Users cannot follow themselves"'
  );
  console.log('  ✓ 3.1: db.followUser(uSelf, uSelf) correctly throws Error("Users cannot follow themselves")');

  // Test 3.2: localDb.follow self-follow return value
  const localResult = localDb.follow(uSelf, uSelf);
  assert.strictEqual(localResult, false, 'localDb.follow must return false for self-follow');
  assert.strictEqual(localDb.getFollows().length, 0, 'No record inserted by localDb.follow for self');
  console.log('  ✓ 3.2: localDb.follow(uSelf, uSelf) returns false and does not persist row');

  // Test 3.3: isFollowing self check
  assert.strictEqual(await db.isFollowing(uSelf, uSelf), false, 'isFollowing(uSelf, uSelf) must return false');
  assert.strictEqual(localDb.isFollowing(uSelf, uSelf), false, 'localDb.isFollowing(uSelf, uSelf) must return false');
  console.log('  ✓ 3.3: db.isFollowing and localDb.isFollowing return false for self comparison');

  // Test 3.4: Null, undefined, empty string boundaries
  await assert.rejects(async () => await db.followUser('', uSelf), /Follower ID and Following ID are required/);
  await assert.rejects(async () => await db.followUser(uSelf, ''), /Follower ID and Following ID are required/);
  await assert.rejects(async () => await db.followUser(null, uSelf), /Follower ID and Following ID are required/);
  await assert.rejects(async () => await db.followUser(uSelf, null), /Follower ID and Following ID are required/);
  await assert.rejects(async () => await db.followUser(undefined, undefined), /Follower ID and Following ID are required/);

  assert.strictEqual(await db.isFollowing('', uSelf), false);
  assert.strictEqual(await db.isFollowing(uSelf, ''), false);
  assert.strictEqual(await db.isFollowing(null, uSelf), false);
  assert.strictEqual(await db.isFollowing(uSelf, null), false);

  assert.strictEqual(localDb.follow('', uSelf), false);
  assert.strictEqual(localDb.follow(uSelf, ''), false);
  assert.strictEqual(localDb.follow(null, uSelf), false);
  assert.strictEqual(localDb.follow(uSelf, null), false);

  // Unfollow with invalid input should safely no-op
  await db.unfollowUser('', uSelf);
  await db.unfollowUser(uSelf, '');
  await db.unfollowUser(null, uSelf);
  assert.strictEqual(localDb.getFollows().length, 0);
  console.log('  ✓ 3.4: Edge case inputs (empty, null, undefined) safely rejected');

  // Test 3.5: Database migration constraint inspection
  const mig = fs.readFileSync('supabase/migrations/20261101_follows_and_profile_stats.sql', 'utf8');
  assert.match(mig, /constraint\s+follows_no_self_follow\s+check\s*\(\s*follower_id\s*<>\s*following_id\s*\)/i);
  console.log('  ✓ 3.5: SQL migration includes CHECK (follower_id <> following_id)');
}

// =============================================================================
// TEST SUITE 4: COMPLEX GRAPH TOPOLOGIES
// =============================================================================
console.log('\n[Suite 4: Complex Graph Topologies]');

{
  // ---------------------------------------------------------------------------
  // Topo 4.1: Directed Ring / Cycle of 12 Users
  // U0 -> U1 -> U2 -> ... -> U11 -> U0
  // ---------------------------------------------------------------------------
  const { db, localDb } = createFreshDbRuntime();
  const N_RING = 12;
  const ringUsers = Array.from({ length: N_RING }, (_, i) => `user-ring-${i}`);
  localDb.setProfiles(ringUsers.map((id, i) => ({ id, username: `ring_${i}`, name: `Ring ${i}` })));

  for (let i = 0; i < N_RING; i++) {
    const next = (i + 1) % N_RING;
    await db.followUser(ringUsers[i], ringUsers[next]);
  }

  let totalFollowers = 0;
  let totalFollowing = 0;
  for (let i = 0; i < N_RING; i++) {
    const next = (i + 1) % N_RING;
    const prev = (i - 1 + N_RING) % N_RING;

    const stats = await db.getProfileStats(ringUsers[i]);
    assert.strictEqual(stats.follower_count, 1, `Ring node ${i} must have exactly 1 follower`);
    assert.strictEqual(stats.following_count, 1, `Ring node ${i} must have exactly 1 following`);
    totalFollowers += stats.follower_count;
    totalFollowing += stats.following_count;

    assert.strictEqual(await db.isFollowing(ringUsers[i], ringUsers[next]), true);
    assert.strictEqual(await db.isFollowing(ringUsers[next], ringUsers[i]), false);

    const followers = await db.listFollowers(ringUsers[i]);
    assert.strictEqual(followers.length, 1);
    assert.strictEqual(followers[0].id, ringUsers[prev]);

    const following = await db.listFollowing(ringUsers[i]);
    assert.strictEqual(following.length, 1);
    assert.strictEqual(following[0].id, ringUsers[next]);
  }

  assert.strictEqual(totalFollowers, N_RING);
  assert.strictEqual(totalFollowing, N_RING);
  assert.strictEqual(localDb.getFollows().length, N_RING);
  console.log(`  ✓ 4.1: Directed Ring of ${N_RING} nodes verified (in-degree=1, out-degree=1, cycle intact)`);

  // ---------------------------------------------------------------------------
  // Topo 4.2: Mutual / Symmetric Clique of 8 Users (Complete Directed Graph)
  // 8 * 7 = 56 directed edges
  // ---------------------------------------------------------------------------
  const { db: dbClique, localDb: localClique } = createFreshDbRuntime();
  const K = 8;
  const cliqueUsers = Array.from({ length: K }, (_, i) => `user-clique-${i}`);
  localClique.setProfiles(cliqueUsers.map((id, i) => ({ id, username: `clique_${i}`, name: `Clique ${i}` })));

  for (let i = 0; i < K; i++) {
    for (let j = 0; j < K; j++) {
      if (i !== j) {
        await dbClique.followUser(cliqueUsers[i], cliqueUsers[j]);
      }
    }
  }

  assert.strictEqual(localClique.getFollows().length, K * (K - 1), 'Total edges must be K*(K-1)');

  for (let i = 0; i < K; i++) {
    const stats = await dbClique.getProfileStats(cliqueUsers[i]);
    assert.strictEqual(stats.follower_count, K - 1, `Clique user ${i} follower_count must be ${K - 1}`);
    assert.strictEqual(stats.following_count, K - 1, `Clique user ${i} following_count must be ${K - 1}`);

    const followers = await dbClique.listFollowers(cliqueUsers[i]);
    assert.strictEqual(followers.length, K - 1);
    const following = await dbClique.listFollowing(cliqueUsers[i]);
    assert.strictEqual(following.length, K - 1);

    for (let j = 0; j < K; j++) {
      if (i !== j) {
        assert.strictEqual(await dbClique.isFollowing(cliqueUsers[i], cliqueUsers[j]), true);
      } else {
        assert.strictEqual(await dbClique.isFollowing(cliqueUsers[i], cliqueUsers[j]), false);
      }
    }
  }
  console.log(`  ✓ 4.2: Complete symmetric clique of ${K} nodes (${K * (K - 1)} bidirectional edges) verified`);

  // ---------------------------------------------------------------------------
  // Topo 4.3: Hub & Spoke (Influencer with 100 followers, following 3)
  // ---------------------------------------------------------------------------
  const { db: dbHub, localDb: localHub } = createFreshDbRuntime();
  const hubId = 'user-influencer-hub';
  const NUM_FANS = 100;
  const fanIds = Array.from({ length: NUM_FANS }, (_, i) => `user-fan-${i}`);

  localHub.setProfiles([
    { id: hubId, username: 'influencer', name: 'Influencer' },
    ...fanIds.map((id, i) => ({ id, username: `fan_${i}`, name: `Fan ${i}` })),
  ]);

  // All 100 fans follow the hub
  for (const fanId of fanIds) {
    await dbHub.followUser(fanId, hubId);
  }
  // Hub follows back 3 fans
  await dbHub.followUser(hubId, fanIds[0]);
  await dbHub.followUser(hubId, fanIds[1]);
  await dbHub.followUser(hubId, fanIds[2]);

  const hubStats = await dbHub.getProfileStats(hubId);
  assert.strictEqual(hubStats.follower_count, 100, 'Hub has 100 followers');
  assert.strictEqual(hubStats.following_count, 3, 'Hub follows 3 fans');

  const hubFollowers = await dbHub.listFollowers(hubId);
  assert.strictEqual(hubFollowers.length, 100);
  const hubFollowing = await dbHub.listFollowing(hubId);
  assert.strictEqual(hubFollowing.length, 3);

  // Invariant across all fans
  for (let i = 0; i < NUM_FANS; i++) {
    const fanStats = await dbHub.getProfileStats(fanIds[i]);
    assert.strictEqual(fanStats.following_count, 1, `Fan ${i} follows 1 (the hub)`);
    if (i < 3) {
      assert.strictEqual(fanStats.follower_count, 1, `Fan ${i} has 1 follower (the hub)`);
    } else {
      assert.strictEqual(fanStats.follower_count, 0, `Fan ${i} has 0 followers`);
    }
  }
  console.log(`  ✓ 4.3: Hub & Spoke topology (100 fans, 3 reciprocal) verified`);

  // ---------------------------------------------------------------------------
  // Topo 4.4: Large Random Directed Graph (35 Nodes, 180 Edges)
  // Verifying Euler Handshaking Lemma: sum(in_deg) == sum(out_deg) == |E|
  // ---------------------------------------------------------------------------
  const { db: dbRand, localDb: localRand } = createFreshDbRuntime();
  const NUM_NODES = 35;
  const randUsers = Array.from({ length: NUM_NODES }, (_, i) => `user-rand-${i}`);
  localRand.setProfiles(randUsers.map((id, i) => ({ id, username: `rand_${i}`, name: `Rand ${i}` })));

  const expectedEdges = new Set();
  // Deterministic pseudo-random edge generator
  let seed = 42;
  function pseudoRandom() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  while (expectedEdges.size < 180) {
    const fromIdx = Math.floor(pseudoRandom() * NUM_NODES);
    const toIdx = Math.floor(pseudoRandom() * NUM_NODES);
    if (fromIdx !== toIdx) {
      expectedEdges.add(`${randUsers[fromIdx]}|${randUsers[toIdx]}`);
    }
  }

  for (const edgeKey of expectedEdges) {
    const [from, to] = edgeKey.split('|');
    await dbRand.followUser(from, to);
  }

  assert.strictEqual(localRand.getFollows().length, expectedEdges.size);

  let sumInDegrees = 0;
  let sumOutDegrees = 0;
  for (const u of randUsers) {
    const stats = await dbRand.getProfileStats(u);
    sumInDegrees += stats.follower_count;
    sumOutDegrees += stats.following_count;

    // Verify listFollowers and listFollowing match counts
    const followers = await dbRand.listFollowers(u);
    const following = await dbRand.listFollowing(u);
    assert.strictEqual(followers.length, stats.follower_count);
    assert.strictEqual(following.length, stats.following_count);
  }

  assert.strictEqual(sumInDegrees, expectedEdges.size, 'Sum of all follower_counts must equal total edges');
  assert.strictEqual(sumOutDegrees, expectedEdges.size, 'Sum of all following_counts must equal total edges');
  assert.strictEqual(sumInDegrees, sumOutDegrees, 'Handshaking lemma: sum(in) == sum(out)');
  console.log(`  ✓ 4.4: Random directed graph (35 nodes, 180 edges) satisfied Handshaking Lemma (sum=${sumInDegrees})`);
}

// =============================================================================
// TEST SUITE 5: CASCADING ACCOUNT DELETION
// =============================================================================
console.log('\n[Suite 5: Cascading Account Deletion]');

{
  const { db, localDb } = createFreshDbRuntime();
  // Build a complex network with 10 users: A, B, C, D, E, F, G, H, I, J
  const userIds = Array.from({ length: 10 }, (_, i) => `user-del-${String.fromCharCode(65 + i)}`);
  localDb.setProfiles(userIds.map((id, i) => ({ id, username: `del_${i}`, name: `Del ${i}` })));

  // Target to delete: userIds[0] (User A)
  const targetId = userIds[0];

  // User A follows 4 other users: B, C, D, E
  await db.followUser(targetId, userIds[1]);
  await db.followUser(targetId, userIds[2]);
  await db.followUser(targetId, userIds[3]);
  await db.followUser(targetId, userIds[4]);

  // 5 users follow User A: F, G, H, I, J
  await db.followUser(userIds[5], targetId);
  await db.followUser(userIds[6], targetId);
  await db.followUser(userIds[7], targetId);
  await db.followUser(userIds[8], targetId);
  await db.followUser(userIds[9], targetId);

  // Internal edges not involving User A: B follows C, C follows D, F follows G
  await db.followUser(userIds[1], userIds[2]);
  await db.followUser(userIds[2], userIds[3]);
  await db.followUser(userIds[5], userIds[6]);

  const totalBefore = localDb.getFollows().length;
  assert.strictEqual(totalBefore, 4 + 5 + 3, 'Total edges before deletion should be 12');

  const statsBBefore = await db.getProfileStats(userIds[1]);
  const statsFBefore = await db.getProfileStats(userIds[5]);
  assert.strictEqual(statsBBefore.follower_count, 1, 'User B follower count before: 1 (from A)');
  assert.strictEqual(statsFBefore.following_count, 2, 'User F following count before: 2 (A and G)');

  // Execute account deletion for User A
  localDb.deleteAccount(targetId);

  // Assertions:
  // 1. User A is gone from profiles
  const profilesAfter = localDb.getProfiles();
  assert.strictEqual(profilesAfter.some((p) => p.id === targetId), false, 'Deleted user is removed from profiles');

  // 2. No follow edges exist involving User A
  const remainingFollows = localDb.getFollows();
  assert.strictEqual(
    remainingFollows.some((f) => f.follower_id === targetId || f.following_id === targetId),
    false,
    'All incoming and outgoing follow edges of deleted user are removed'
  );

  // 3. Exactly 3 uninvolved edges remain
  assert.strictEqual(remainingFollows.length, 3, 'Only 3 uninvolved edges remain');

  // 4. Follower counts of former followees dropped by 1
  const statsBAfter = await db.getProfileStats(userIds[1]);
  assert.strictEqual(statsBAfter.follower_count, 0, 'User B lost User A as follower (count: 1 -> 0)');

  // 5. Following counts of former followers dropped by 1
  const statsFAfter = await db.getProfileStats(userIds[5]);
  assert.strictEqual(statsFAfter.following_count, 1, 'User F lost User A as following (count: 2 -> 1)');

  // 6. Uninvolved edges still intact
  assert.strictEqual(await db.isFollowing(userIds[1], userIds[2]), true);
  assert.strictEqual(await db.isFollowing(userIds[2], userIds[3]), true);
  assert.strictEqual(await db.isFollowing(userIds[5], userIds[6]), true);

  console.log('  ✓ 5.1: Account deletion cascade cleanly expunged all incoming/outgoing edges');

  // Test 5.2: Sequential Deletion to Zero (Full Teardown)
  for (let i = 1; i < userIds.length; i++) {
    localDb.deleteAccount(userIds[i]);
  }
  assert.strictEqual(localDb.getProfiles().length, 0, 'All profiles deleted');
  assert.strictEqual(localDb.getFollows().length, 0, 'Follows store is completely empty (0 rows)');
  console.log('  ✓ 5.2: Sequential teardown to zero left clean empty storage with no dangling references');
}

// =============================================================================
// TEST SUITE 6: ZERO-METRIC INVARIANT & ANTI-FAKING VERIFICATION
// =============================================================================
console.log('\n[Suite 6: Zero-Metric Invariant & Anti-Faking Verification]');

{
  const { db, localDb } = createFreshDbRuntime();
  const freshUser = 'user-zero-metric-uuid';
  localDb.setProfiles([
    { id: freshUser, username: 'freshuser', name: 'Fresh User' },
  ]);

  // Test 6.1: Brand new user with zero records returns strictly 0
  const freshStats = await db.getProfileStats(freshUser);
  assert.strictEqual(freshStats.follower_count, 0, 'Follower count must be strictly 0');
  assert.strictEqual(freshStats.following_count, 0, 'Following count must be strictly 0');
  assert.strictEqual(freshStats.agent_count, 0, 'Agent count must be strictly 0');
  assert.strictEqual(typeof freshStats.follower_count, 'number', 'follower_count is a number');
  assert.ok(!Number.isNaN(freshStats.follower_count), 'follower_count is not NaN');
  console.log('  ✓ 6.1: Fresh user has strictly 0 followers, 0 following, 0 agents');

  // Test 6.2: Follow then unfollow returns to strictly 0
  const otherUser = 'user-other-zero';
  localDb.setProfiles([
    ...localDb.getProfiles(),
    { id: otherUser, username: 'other', name: 'Other' },
  ]);
  await db.followUser(otherUser, freshUser);
  assert.strictEqual((await db.getProfileStats(freshUser)).follower_count, 1);
  await db.unfollowUser(otherUser, freshUser);
  const revertedStats = await db.getProfileStats(freshUser);
  assert.strictEqual(revertedStats.follower_count, 0, 'Reverted follower count must be strictly 0');
  console.log('  ✓ 6.2: Follow then unfollow cleanly reverts count to strictly 0');

  // Test 6.3: Non-existent profile query returns strictly 0
  const ghostStats = await db.getProfileStats('00000000-0000-0000-0000-ffffffffffff');
  assert.strictEqual(ghostStats.follower_count, 0, 'Ghost profile has strictly 0 followers');
  assert.strictEqual(ghostStats.following_count, 0, 'Ghost profile has strictly 0 following');
  assert.strictEqual(ghostStats.agent_count, 0, 'Ghost profile has strictly 0 agents');
  console.log('  ✓ 6.3: Non-existent/unregistered profile returns strictly 0 without throwing');

  // Test 6.4: Codebase inspection against fake metrics
  const profileUiCode = fs.readFileSync('app/u/[handle]/page.tsx', 'utf8');
  assert.doesNotMatch(profileUiCode, /Math\.random\s*\(/, 'Profile UI must not generate random numbers');
  assert.doesNotMatch(profileUiCode, /charCodeAt\s*\(/, 'Profile UI must not synthesize metrics using charCodeAt string hashing');
  assert.doesNotMatch(profileUiCode, /followersCount\s*=\s*\d{2,}/, 'Profile UI must not hardcode fake metric baselines');
  console.log('  ✓ 6.4: Profile UI contains zero synthetic metrics, random values, or hash generators');
}

// =============================================================================
// TEST SUITE 7: PROFILE UI ASYNC TOGGLE & ROLLBACK RESILIENCE
// =============================================================================
console.log('\n[Suite 7: Profile UI Async Toggle & Rollback Resilience]');

{
  // Simulate the UI state management from app/u/[handle]/page.tsx
  class SimulatedProfileUi {
    constructor(dbClient, user, profile) {
      this.db = dbClient;
      this.user = user;
      this.profile = profile;
      this.isFollowing = false;
      this.followersCount = 0;
      this.followingCount = 0;
      this.isTogglingFollow = false;
      this.lastAlert = null;
    }

    async init() {
      const stats = await this.db.getProfileStats(this.profile.id);
      this.followersCount = stats.follower_count ?? 0;
      this.followingCount = stats.following_count ?? 0;
      if (this.user && this.user.id !== this.profile.id) {
        this.isFollowing = await this.db.isFollowing(this.user.id, this.profile.id);
      }
    }

    async handleToggleFollow() {
      if (!this.user) return;
      if (!this.profile || this.user.id === this.profile.id || this.isTogglingFollow) return;

      this.isTogglingFollow = true;
      const previousFollowing = this.isFollowing;
      const previousCount = this.followersCount;

      // Optimistic update
      const nextFollowing = !previousFollowing;
      this.isFollowing = nextFollowing;
      this.followersCount = nextFollowing ? previousCount + 1 : Math.max(0, previousCount - 1);

      try {
        if (nextFollowing) {
          await this.db.followUser(this.user.id, this.profile.id);
        } else {
          await this.db.unfollowUser(this.user.id, this.profile.id);
        }

        const freshStats = await this.db.getProfileStats(this.profile.id);
        if (freshStats) {
          this.followersCount = freshStats.follower_count;
          this.followingCount = freshStats.following_count;
        }
      } catch (err) {
        // Rollback optimistic state on error
        this.isFollowing = previousFollowing;
        this.followersCount = previousCount;
        this.lastAlert = err.message;
      } finally {
        this.isTogglingFollow = false;
      }
    }
  }

  const { db, localDb } = createFreshDbRuntime();
  const viewer = { id: 'viewer-uuid-99' };
  const target = { id: 'target-uuid-88' };

  localDb.setProfiles([
    { id: viewer.id, username: 'viewer', name: 'Viewer' },
    { id: target.id, username: 'target', name: 'Target' },
  ]);

  const ui = new SimulatedProfileUi(db, viewer, target);
  await ui.init();

  assert.strictEqual(ui.isFollowing, false);
  assert.strictEqual(ui.followersCount, 0);

  // Test 7.1: Successful follow toggle
  await ui.handleToggleFollow();
  assert.strictEqual(ui.isFollowing, true, 'UI state is following');
  assert.strictEqual(ui.followersCount, 1, 'UI count updated to 1');
  assert.strictEqual(await db.isFollowing(viewer.id, target.id), true, 'Backend state is following');
  console.log('  ✓ 7.1: UI follow toggle successfully applied optimistic update and synced stats');

  // Test 7.2: Successful unfollow toggle
  await ui.handleToggleFollow();
  assert.strictEqual(ui.isFollowing, false, 'UI state is not following');
  assert.strictEqual(ui.followersCount, 0, 'UI count reverted to 0');
  assert.strictEqual(await db.isFollowing(viewer.id, target.id), false, 'Backend state is unfollowed');
  console.log('  ✓ 7.2: UI unfollow toggle successfully updated and synced stats');

  // Test 7.3: Error rollback simulation
  // Inject mock failure into followUser
  const originalFollow = db.followUser;
  db.followUser = async () => {
    throw new Error('Network timeout simulated');
  };

  await ui.handleToggleFollow(); // Should attempt follow, fail, and roll back
  assert.strictEqual(ui.isFollowing, false, 'UI following rolled back to false');
  assert.strictEqual(ui.followersCount, 0, 'UI count rolled back to 0');
  assert.strictEqual(ui.lastAlert, 'Network timeout simulated', 'Alert captured failure message');
  assert.strictEqual(ui.isTogglingFollow, false, 'isTogglingFollow unlocked after error');
  db.followUser = originalFollow;
  console.log('  ✓ 7.3: UI perfectly rolled back optimistic state on simulated network failure');

  // Test 7.4: Self-follow toggle guard in UI
  const selfUi = new SimulatedProfileUi(db, viewer, viewer);
  await selfUi.init();
  await selfUi.handleToggleFollow();
  assert.strictEqual(selfUi.isFollowing, false, 'Self-follow no-op in UI');
  assert.strictEqual(selfUi.followersCount, 0);
  console.log('  ✓ 7.4: UI guard prevents self-follow action when user.id === profile.id');
}

console.log('\n================================================================');
console.log('ALL ADVERSARIAL STRESS TESTS COMPLETED SUCCESSFULLY! (VERDICT: APPROVE)');
console.log('================================================================\n');
process.exit(0);
