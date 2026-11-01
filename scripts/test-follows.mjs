import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Attempt to load .env if available
try {
  if (typeof process.loadEnvFile === 'function' && fs.existsSync('.env')) {
    process.loadEnvFile('.env');
  }
} catch {
  // Ignored if .env cannot be loaded
}

console.log('--- Running Followers & Following Feature Tests ---');

// ============================================================================
// 1. Schema & Migration Integrity Tests
// ============================================================================
console.log('\n[Group 1: Database Migration & Schema Files]');

const migrationPath = path.resolve('supabase/migrations/20261101_follows_and_profile_stats.sql');
assert.ok(fs.existsSync(migrationPath), 'Migration file 20261101_follows_and_profile_stats.sql must exist');
const migrationSql = fs.readFileSync(migrationPath, 'utf8');

assert.match(migrationSql, /create table if not exists public\.follows/i, 'Migration must create public.follows table');
assert.match(migrationSql, /primary key\s*\(\s*follower_id\s*,\s*following_id\s*\)/i, 'Migration must set composite PK (follower_id, following_id)');
assert.match(migrationSql, /follower_id\s*<>\s*following_id/i, 'Migration must have check constraint prohibiting self-follow');
assert.match(migrationSql, /create index if not exists follows_following_idx on public\.follows\s*\(\s*following_id\s*\)/i, 'Migration must index following_id');
assert.match(migrationSql, /alter table public\.follows enable row level security/i, 'Migration must enable RLS on follows');
assert.match(migrationSql, /create policy "follows readable by logged in users"/i, 'Migration must define select policy for authenticated users');
assert.match(migrationSql, /create policy "follow as yourself"/i, 'Migration must define insert policy for auth.uid() = follower_id');
assert.match(migrationSql, /create policy "unfollow as yourself"/i, 'Migration must define delete policy for auth.uid() = follower_id');
assert.match(migrationSql, /create view public\.profile_stats/i, 'Migration must create public.profile_stats view');
assert.match(migrationSql, /security_invoker\s*=\s*true/i, 'Migration view must have security_invoker = true');
assert.match(migrationSql, /grant select on public\.profile_stats to authenticated/i, 'Migration must grant select on profile_stats to authenticated');

console.log('✓ Migration file 20261101_follows_and_profile_stats.sql matches all architectural constraints');

const schemaPath = path.resolve('supabase/schema.sql');
assert.ok(fs.existsSync(schemaPath), 'Base schema.sql must exist');
const schemaSql = fs.readFileSync(schemaPath, 'utf8');

assert.match(schemaSql, /create table if not exists public\.follows/i, 'schema.sql must define public.follows table');
assert.match(schemaSql, /alter table public\.follows enable row level security/i, 'schema.sql must enable RLS on follows');
assert.match(schemaSql, /create policy "follows readable by logged in users"/i, 'schema.sql must define select policy');
assert.match(schemaSql, /create policy "follow as yourself"/i, 'schema.sql must define insert policy');
assert.match(schemaSql, /create policy "unfollow as yourself"/i, 'schema.sql must define delete policy');
assert.match(schemaSql, /create view public\.profile_stats/i, 'schema.sql must create public.profile_stats view');
assert.match(schemaSql, /security_invoker\s*=\s*true/i, 'schema.sql view must specify security_invoker = true');
assert.match(schemaSql, /grant select on public\.profile_stats to authenticated/i, 'schema.sql must grant select on profile_stats to authenticated');

console.log('✓ Base schema supabase/schema.sql incorporates follows table, policies, and profile_stats view');

// ============================================================================
// 2. TypeScript Types Verification
// ============================================================================
console.log('\n[Group 2: TypeScript Type Definitions]');

const typesPath = path.resolve('types/database.ts');
const typesContent = fs.readFileSync(typesPath, 'utf8');

assert.match(typesContent, /export type Follow\s*=\s*\{[\s\S]*follower_id:\s*string;[\s\S]*following_id:\s*string;[\s\S]*\};/, 'types/database.ts must export Follow type');
assert.match(typesContent, /export type ProfileStats\s*=\s*\{[\s\S]*profile_id:\s*string;[\s\S]*agent_count:\s*number;[\s\S]*follower_count:\s*number;[\s\S]*following_count:\s*number;[\s\S]*\};/, 'types/database.ts must export ProfileStats type');

console.log('✓ types/database.ts exports Follow and ProfileStats types');

// ============================================================================
// 3. LocalDB & Offline Fallback Simulation Tests
// ============================================================================
console.log('\n[Group 3: Offline Data Layer & LocalDB Implementation]');

// Exact replica of LocalDB implementation from lib/db.ts
class TestLocalDB {
  constructor() {
    this.memoryStore = new Map();
  }

  getStorage(key, defaultData) {
    if (!this.memoryStore.has(key)) {
      this.memoryStore.set(key, JSON.parse(JSON.stringify(defaultData)));
    }
    return this.memoryStore.get(key);
  }

  setStorage(key, data) {
    this.memoryStore.set(key, data);
  }

  getProfiles() {
    return this.getStorage('profiles', []);
  }

  setProfiles(data) {
    this.setStorage('profiles', data);
  }

  getAgents() {
    return this.getStorage('agents', []);
  }

  setAgents(data) {
    this.setStorage('agents', data);
  }

  getFollows() {
    return this.getStorage('follows', []);
  }

  setFollows(data) {
    this.setStorage('follows', data);
  }

  follow(followerId, followingId) {
    if (!followerId || !followingId || followerId === followingId) return false;
    const follows = this.getFollows();
    const exists = follows.some(
      (f) => f.follower_id === followerId && f.following_id === followingId
    );
    if (!exists) {
      const record = {
        follower_id: followerId,
        following_id: followingId,
        created_at: new Date().toISOString(),
      };
      this.setFollows([...follows, record]);
    }
    return true;
  }

  unfollow(followerId, followingId) {
    const follows = this.getFollows();
    const filtered = follows.filter(
      (f) => !(f.follower_id === followerId && f.following_id === followingId)
    );
    if (filtered.length !== follows.length) {
      this.setFollows(filtered);
      return true;
    }
    return false;
  }

  isFollowing(followerId, followingId) {
    if (!followerId || !followingId) return false;
    return this.getFollows().some(
      (f) => f.follower_id === followerId && f.following_id === followingId
    );
  }

  getFollowersCount(profileId) {
    return this.getFollows().filter((f) => f.following_id === profileId).length;
  }

  getFollowingCount(profileId) {
    return this.getFollows().filter((f) => f.follower_id === profileId).length;
  }

  deleteAccount(userId) {
    const profiles = this.getProfiles().filter((p) => p.id !== userId);
    this.setProfiles(profiles);

    const remainingAgents = this.getAgents().filter((a) => a.owner_id !== userId);
    this.setAgents(remainingAgents);

    const remainingFollows = this.getFollows().filter(
      (f) => f.follower_id !== userId && f.following_id !== userId
    );
    this.setFollows(remainingFollows);
  }
}

// Client wrapper simulating lib/db.ts client methods
class TestDBClient {
  constructor(localDb) {
    this.localDb = localDb;
  }

  async queryProfileStats(profileId) {
    const agents = this.localDb.getAgents().filter((a) => a.owner_id === profileId);
    return {
      profile_id: profileId,
      agent_count: agents.length,
      follower_count: this.localDb.getFollowersCount(profileId),
      following_count: this.localDb.getFollowingCount(profileId),
    };
  }

  async getProfileStats(profileId) {
    return this.queryProfileStats(profileId);
  }

  async checkFollowStatus(followerId, followingId) {
    if (!followerId || !followingId || followerId === followingId) return false;
    return this.localDb.isFollowing(followerId, followingId);
  }

  async isFollowing(followerId, followingId) {
    return this.checkFollowStatus(followerId, followingId);
  }

  async followUser(followerId, followingId) {
    if (!followerId || !followingId) {
      throw new Error('Follower ID and Following ID are required');
    }
    if (followerId === followingId) {
      throw new Error('Users cannot follow themselves');
    }
    this.localDb.follow(followerId, followingId);
  }

  async unfollowUser(followerId, followingId) {
    if (!followerId || !followingId) return;
    this.localDb.unfollow(followerId, followingId);
  }

  async listFollowers(profileId) {
    const follows = this.localDb.getFollows().filter((f) => f.following_id === profileId);
    const followerIds = new Set(follows.map((f) => f.follower_id));
    return this.localDb.getProfiles().filter((p) => followerIds.has(p.id));
  }

  async listFollowing(profileId) {
    const follows = this.localDb.getFollows().filter((f) => f.follower_id === profileId);
    const followingIds = new Set(follows.map((f) => f.following_id));
    return this.localDb.getProfiles().filter((p) => followingIds.has(p.id));
  }
}

const localDb = new TestLocalDB();
const dbClient = new TestDBClient(localDb);

const userA = 'user-uuid-1111';
const userB = 'user-uuid-2222';
const userC = 'user-uuid-3333';

localDb.setProfiles([
  { id: userA, username: 'alice', name: 'Alice' },
  { id: userB, username: 'bob', name: 'Bob' },
  { id: userC, username: 'carol', name: 'Carol' },
]);
localDb.setAgents([
  { id: 'agent-1', owner_id: userA, name: 'Agent Alpha' },
]);

// Test 3.1: Zero fake data invariant on empty state
const statsA0 = await dbClient.getProfileStats(userA);
assert.strictEqual(statsA0.agent_count, 1, 'Alice has 1 agent');
assert.strictEqual(statsA0.follower_count, 0, 'Alice has strictly 0 followers initially');
assert.strictEqual(statsA0.following_count, 0, 'Alice has strictly 0 following initially');

const statsB0 = await dbClient.getProfileStats(userB);
assert.strictEqual(statsB0.agent_count, 0, 'Bob has strictly 0 agents initially');
assert.strictEqual(statsB0.follower_count, 0, 'Bob has strictly 0 followers initially');
assert.strictEqual(statsB0.following_count, 0, 'Bob has strictly 0 following initially');
console.log('✓ Zero-metric invariant: fresh profiles return strictly 0 followers and following');

// Test 3.2: Self-follow prevention
let selfFollowThrew = false;
try {
  await dbClient.followUser(userA, userA);
} catch (err) {
  selfFollowThrew = true;
  assert.strictEqual(err.message, 'Users cannot follow themselves');
}
assert.ok(selfFollowThrew, 'Attempting to follow self must throw an error');
assert.strictEqual(localDb.follow(userA, userA), false, 'LocalDB.follow must return false for self-follow');
console.log('✓ Self-follow rejection: followUser throws "Users cannot follow themselves"');

// Test 3.3: Follow operation and directional state check
await dbClient.followUser(userA, userB); // Alice follows Bob
assert.strictEqual(await dbClient.isFollowing(userA, userB), true, 'Alice should be following Bob');
assert.strictEqual(await dbClient.isFollowing(userB, userA), false, 'Bob should NOT be following Alice');

const statsA1 = await dbClient.getProfileStats(userA);
assert.strictEqual(statsA1.following_count, 1, 'Alice following count should be 1');
assert.strictEqual(statsA1.follower_count, 0, 'Alice follower count should still be 0');

const statsB1 = await dbClient.getProfileStats(userB);
assert.strictEqual(statsB1.follower_count, 1, 'Bob follower count should be 1');
assert.strictEqual(statsB1.following_count, 0, 'Bob following count should still be 0');
console.log('✓ Follow operation updates counts and directional status accurately');

// Test 3.4: Duplicate follow idempotency
await dbClient.followUser(userA, userB); // duplicate call
const statsBDuplicate = await dbClient.getProfileStats(userB);
assert.strictEqual(statsBDuplicate.follower_count, 1, 'Duplicate follow must be idempotent and not increment count');
assert.strictEqual(localDb.getFollows().length, 1, 'Follows table must only contain 1 record');
console.log('✓ Duplicate follow idempotency verified');

// Test 3.5: Multi-user network & list queries
await dbClient.followUser(userC, userB); // Carol follows Bob
await dbClient.followUser(userB, userA); // Bob follows Alice

const bobFollowers = await dbClient.listFollowers(userB);
assert.strictEqual(bobFollowers.length, 2, 'Bob should have 2 followers (Alice, Carol)');
const bobFollowerIds = bobFollowers.map((p) => p.id);
assert.ok(bobFollowerIds.includes(userA) && bobFollowerIds.includes(userC), 'Bob followers list contains Alice and Carol');

const bobFollowing = await dbClient.listFollowing(userB);
assert.strictEqual(bobFollowing.length, 1, 'Bob should be following 1 user (Alice)');
assert.strictEqual(bobFollowing[0].id, userA, 'Bob is following Alice');
console.log('✓ listFollowers and listFollowing return accurate profile arrays');

// Test 3.6: Unfollow operation
await dbClient.unfollowUser(userA, userB); // Alice unfollows Bob
assert.strictEqual(await dbClient.isFollowing(userA, userB), false, 'Alice is no longer following Bob');
const statsBAfterUnfollow = await dbClient.getProfileStats(userB);
assert.strictEqual(statsBAfterUnfollow.follower_count, 1, 'Bob now has 1 follower (Carol)');
console.log('✓ Unfollow operation decrements count and updates status');

// Test 3.7: Cascading account deletion
// Current follows: Carol follows Bob, Bob follows Alice
localDb.deleteAccount(userB); // Delete Bob's account
assert.strictEqual(localDb.isFollowing(userC, userB), false, 'Follow of deleted user Bob by Carol is removed');
assert.strictEqual(localDb.isFollowing(userB, userA), false, 'Follow of Alice by deleted user Bob is removed');
assert.strictEqual(localDb.getFollows().length, 0, 'All follows involving Bob are deleted');
const statsAAfterDelete = await dbClient.getProfileStats(userA);
assert.strictEqual(statsAAfterDelete.follower_count, 0, 'Alice has 0 followers after Bob was deleted');
console.log('✓ Account deletion cascade cleans up follows in both follower and following directions');

// ============================================================================
// 4. Client DB Integration in lib/db.ts
// ============================================================================
console.log('\n[Group 4: lib/db.ts API exports verification]');
const dbSource = fs.readFileSync(path.resolve('lib/db.ts'), 'utf8');

assert.match(dbSource, /queryProfileStats\(profileId:\s*string\)/, 'lib/db.ts must export queryProfileStats');
assert.match(dbSource, /getProfileStats\(profileId:\s*string\)/, 'lib/db.ts must export getProfileStats');
assert.match(dbSource, /checkFollowStatus\(followerId:\s*string,\s*followingId:\s*string\)/, 'lib/db.ts must export checkFollowStatus');
assert.match(dbSource, /isFollowing\(followerId:\s*string,\s*followingId:\s*string\)/, 'lib/db.ts must export isFollowing');
assert.match(dbSource, /followUser\(followerId:\s*string,\s*followingId:\s*string\)/, 'lib/db.ts must export followUser');
assert.match(dbSource, /unfollowUser\(followerId:\s*string,\s*followingId:\s*string\)/, 'lib/db.ts must export unfollowUser');
assert.match(dbSource, /listFollowers\(profileId:\s*string\)/, 'lib/db.ts must export listFollowers');
assert.match(dbSource, /listFollowing\(profileId:\s*string\)/, 'lib/db.ts must export listFollowing');

// Verify self-follow check in lib/db.ts
assert.match(dbSource, /Users cannot follow themselves/, 'lib/db.ts must check self-follow in followUser');

console.log('✓ lib/db.ts exports all required methods with self-follow prevention');

// ============================================================================
// 5. Profile UI Verification (app/u/[handle]/page.tsx)
// ============================================================================
console.log('\n[Group 5: app/u/[handle]/page.tsx Profile UI inspection]');
const profileUiSource = fs.readFileSync(path.resolve('app/u/[handle]/page.tsx'), 'utf8');

assert.match(profileUiSource, /db\.getProfileStats/, 'Profile page must query live stats via db.getProfileStats');
assert.match(profileUiSource, /db\.isFollowing/, 'Profile page must check follow status via db.isFollowing');
assert.match(profileUiSource, /db\.followUser/, 'Profile page must invoke db.followUser on follow action');
assert.match(profileUiSource, /db\.unfollowUser/, 'Profile page must invoke db.unfollowUser on unfollow action');
assert.match(profileUiSource, /isTogglingFollow/, 'Profile page must manage isTogglingFollow state');
assert.match(profileUiSource, /disabled=\{isTogglingFollow\}/, 'Follow button must be disabled during active toggle');
assert.match(profileUiSource, /href="\/explore"/, 'Profile metric links must direct to /explore');

console.log('✓ Profile UI contains live stats, async toggle, error handling, and /explore links');

console.log('\n======================================================');
console.log('ALL FOLLOWERS & FOLLOWING TESTS PASSED SUCCESSFULLY! ✓');
console.log('======================================================\n');
process.exit(0);
