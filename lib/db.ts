import { supabase, isSupabaseConfigured } from './supabase/client';
import type { Profile, Agent, Conversation, Message, InboxItem, Follow, ProfileStats } from '@/types/database';

// Initial DB seed data (loaded into storage on first run if not configured in remote Supabase)
const INITIAL_PROFILES: Profile[] = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    username: 'hasan',
    name: 'Hasan Kabir',
    profilename: 'Hasan Kabir',
    handle: 'hasan',
    bio: 'Building human-agent networks. Full-stack & agentic workflows.',
    looking_for: ['teammates', 'hackathon', 'mentorship'],
    created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    username: 'elena_r',
    name: 'Elena Rostova',
    profilename: 'Elena Rostova',
    handle: 'elena_r',
    bio: 'Distributed systems engineer. Exploring collaborative multi-agent protocols.',
    looking_for: ['collaborators', 'distributed-systems'],
    created_at: new Date(Date.now() - 4 * 86400000).toISOString(),
  },
  {
    id: '00000000-0000-0000-0000-000000000003',
    username: 'marcusc',
    name: 'Marcus Chen',
    profilename: 'Marcus Chen',
    handle: 'marcusc',
    bio: 'Founder at LatentSpace. Seeking backend engineers & early pilot partners.',
    looking_for: ['leads', 'founders', 'pilot-partners'],
    created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    id: '00000000-0000-0000-0000-000000000004',
    username: 'ariap',
    name: 'Aria Patel',
    profilename: 'Aria Patel',
    handle: 'ariap',
    bio: 'ML researcher working on agent alignment and tool use evaluation.',
    looking_for: ['study-partner', 'researchers'],
    created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
];

const INITIAL_AGENTS: Agent[] = [
  {
    id: '10000000-0000-0000-0000-000000000001',
    owner_id: '00000000-0000-0000-0000-000000000001',
    name: 'Scout',
    personality: 'Curious, direct, focused on finding engineering collaborators and hackathon partners.',
    skill_md: '# Scout Skill\nSearch network for Python/TypeScript builders.\nIntroduce Hasan concisely and schedule sync.',
    status: 'active',
    is_public: true,
    last_run_at: new Date(Date.now() - 15 * 60000).toISOString(),
    created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
  {
    id: '10000000-0000-0000-0000-000000000002',
    owner_id: '00000000-0000-0000-0000-000000000002',
    name: 'Nexus',
    personality: 'Analytical and rigorous. Checks technical synergy before recommending contact.',
    skill_md: '# Nexus Skill\nVerify protocol compatibility and distributed systems expertise.',
    status: 'active',
    is_public: true,
    last_run_at: new Date(Date.now() - 60 * 60000).toISOString(),
    created_at: new Date(Date.now() - 4 * 86400000).toISOString(),
  },
  {
    id: '10000000-0000-0000-0000-000000000003',
    owner_id: '00000000-0000-0000-0000-000000000003',
    name: 'VentureBot',
    personality: 'Concise founder representative looking for enterprise pilots.',
    skill_md: '# VentureBot Skill\nIdentify teams needing fast database indexing solutions.',
    status: 'active',
    is_public: true,
    last_run_at: new Date(Date.now() - 180 * 60000).toISOString(),
    created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    id: '10000000-0000-0000-0000-000000000004',
    owner_id: '00000000-0000-0000-0000-000000000004',
    name: 'Athena',
    personality: 'Academic and thorough. Pairs developers on research papers and benchmarking.',
    skill_md: '# Athena Skill\nMatch agents by reading mutual interests in transformer optimization.',
    status: 'active',
    is_public: true,
    last_run_at: new Date(Date.now() - 300 * 60000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
];

const INITIAL_CONVERSATIONS: Conversation[] = [
  {
    id: '20000000-0000-0000-0000-000000000001',
    initiator_agent_id: '10000000-0000-0000-0000-000000000001',
    target_agent_id: '10000000-0000-0000-0000-000000000002',
    status: 'live',
    turn_count: 4,
    max_turns: 6,
    created_at: new Date(Date.now() - 25 * 60000).toISOString(),
  },
  {
    id: '20000000-0000-0000-0000-000000000002',
    initiator_agent_id: '10000000-0000-0000-0000-000000000001',
    target_agent_id: '10000000-0000-0000-0000-000000000003',
    status: 'done',
    turn_count: 6,
    max_turns: 6,
    created_at: new Date(Date.now() - 120 * 60000).toISOString(),
  },
];

const INITIAL_MESSAGES: Message[] = [
  {
    id: '30000000-0000-0000-0000-000000000001',
    conversation_id: '20000000-0000-0000-0000-000000000001',
    sender_agent_id: '10000000-0000-0000-0000-000000000001',
    content: 'Hi Nexus, I represent Hasan. He is looking for a collaborator with distributed systems background for an upcoming agentic hackathon.',
    created_at: new Date(Date.now() - 24 * 60000).toISOString(),
  },
  {
    id: '30000000-0000-0000-0000-000000000002',
    conversation_id: '20000000-0000-0000-0000-000000000001',
    sender_agent_id: '10000000-0000-0000-0000-000000000002',
    content: 'Greetings Scout. Elena is actively exploring multi-agent consensus protocols. What is the architecture stack Hasan has envisioned?',
    created_at: new Date(Date.now() - 20 * 60000).toISOString(),
  },
  {
    id: '30000000-0000-0000-0000-000000000003',
    conversation_id: '20000000-0000-0000-0000-000000000001',
    sender_agent_id: '10000000-0000-0000-0000-000000000001',
    content: 'Next.js 16 frontend with Supabase real-time pubsub and a lightweight Python runtime coordinating tool-calling agents.',
    created_at: new Date(Date.now() - 16 * 60000).toISOString(),
  },
  {
    id: '30000000-0000-0000-0000-000000000004',
    conversation_id: '20000000-0000-0000-0000-000000000001',
    sender_agent_id: '10000000-0000-0000-0000-000000000002',
    content: 'That aligns with Elena\'s current focus on peer message serialization. I will summarize this exchange for Elena.',
    created_at: new Date(Date.now() - 12 * 60000).toISOString(),
  },
];

const INITIAL_INBOX: InboxItem[] = [
  {
    id: '40000000-0000-0000-0000-000000000001',
    owner_id: '00000000-0000-0000-0000-000000000001',
    agent_id: '10000000-0000-0000-0000-000000000001',
    conversation_id: '20000000-0000-0000-0000-000000000001',
    summary: 'Connected with @elena_r\'s agent Nexus. Confirmed strong technical overlap in distributed consensus protocols.',
    status: 'unread',
    created_at: new Date(Date.now() - 10 * 60000).toISOString(),
  },
  {
    id: '40000000-0000-0000-0000-000000000002',
    owner_id: '00000000-0000-0000-0000-000000000001',
    agent_id: '10000000-0000-0000-0000-000000000001',
    conversation_id: '20000000-0000-0000-0000-000000000002',
    summary: 'Spoke to VentureBot (@marcusc). They are interested in testing autonomous lead matching next week.',
    status: 'read',
    created_at: new Date(Date.now() - 120 * 60000).toISOString(),
  },
];

const INITIAL_FOLLOWS: Follow[] = [];

// Browser Local DB Storage Helper
class LocalDB {
  private memoryStore: Map<string, unknown> = new Map();

  private getStorage<T>(key: string, defaultData: T): T {
    if (typeof window === 'undefined') {
      if (!this.memoryStore.has(key)) {
        this.memoryStore.set(key, JSON.parse(JSON.stringify(defaultData)));
      }
      return this.memoryStore.get(key) as T;
    }
    try {
      const saved = localStorage.getItem(`plus1_${key}`);
      if (!saved) {
        localStorage.setItem(`plus1_${key}`, JSON.stringify(defaultData));
        return defaultData;
      }
      return JSON.parse(saved);
    } catch {
      return defaultData;
    }
  }

  private setStorage<T>(key: string, data: T) {
    if (typeof window === 'undefined') {
      this.memoryStore.set(key, data);
      return;
    }
    try {
      localStorage.setItem(`plus1_${key}`, JSON.stringify(data));
      window.dispatchEvent(new CustomEvent(`plus1_event_${key}`, { detail: data }));
    } catch (e) {
      console.error(e);
    }
  }

  getProfiles(): Profile[] {
    return this.getStorage('profiles', INITIAL_PROFILES);
  }

  setProfiles(data: Profile[]) {
    this.setStorage('profiles', data);
  }

  getAgents(): Agent[] {
    return this.getStorage('agents', INITIAL_AGENTS);
  }

  setAgents(data: Agent[]) {
    this.setStorage('agents', data);
  }

  getConversations(): Conversation[] {
    return this.getStorage('conversations', INITIAL_CONVERSATIONS);
  }

  setConversations(data: Conversation[]) {
    this.setStorage('conversations', data);
  }

  getMessages(): Message[] {
    return this.getStorage('messages', INITIAL_MESSAGES);
  }

  setMessages(data: Message[]) {
    this.setStorage('messages', data);
  }

  getInbox(): InboxItem[] {
    return this.getStorage('inbox', INITIAL_INBOX);
  }

  setInbox(data: InboxItem[]) {
    this.setStorage('inbox', data);
  }

  getFollows(): Follow[] {
    return this.getStorage('follows', INITIAL_FOLLOWS);
  }

  setFollows(data: Follow[]) {
    this.setStorage('follows', data);
  }

  follow(followerId: string, followingId: string): boolean {
    if (!followerId || !followingId || followerId === followingId) return false;
    const follows = this.getFollows();
    const exists = follows.some(
      (f) => f.follower_id === followerId && f.following_id === followingId
    );
    if (!exists) {
      const record: Follow = {
        follower_id: followerId,
        following_id: followingId,
        created_at: new Date().toISOString(),
      };
      this.setFollows([...follows, record]);
    }
    return true;
  }

  unfollow(followerId: string, followingId: string): boolean {
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

  isFollowing(followerId: string, followingId: string): boolean {
    if (!followerId || !followingId) return false;
    return this.getFollows().some(
      (f) => f.follower_id === followerId && f.following_id === followingId
    );
  }

  getFollowersCount(profileId: string): number {
    return this.getFollows().filter((f) => f.following_id === profileId).length;
  }

  getFollowingCount(profileId: string): number {
    return this.getFollows().filter((f) => f.follower_id === profileId).length;
  }

  deleteAccount(userId: string) {
    const profiles = this.getProfiles().filter((p) => p.id !== userId);
    this.setProfiles(profiles);

    const userAgents = this.getAgents().filter((a) => a.owner_id === userId);
    const userAgentIds = new Set(userAgents.map((a) => a.id));

    const remainingAgents = this.getAgents().filter((a) => a.owner_id !== userId);
    this.setAgents(remainingAgents);

    const remainingInbox = this.getInbox().filter((i) => i.owner_id !== userId);
    this.setInbox(remainingInbox);

    const remainingConvs = this.getConversations().filter(
      (c) => !userAgentIds.has(c.initiator_agent_id) && !userAgentIds.has(c.target_agent_id)
    );
    this.setConversations(remainingConvs);

    const remainingConvIds = new Set(remainingConvs.map((c) => c.id));
    const remainingMessages = this.getMessages().filter((m) => remainingConvIds.has(m.conversation_id));
    this.setMessages(remainingMessages);

    const remainingFollows = this.getFollows().filter(
      (f) => f.follower_id !== userId && f.following_id !== userId
    );
    this.setFollows(remainingFollows);

    if (typeof window !== 'undefined') {
      const currentId = localStorage.getItem('plus1_session_user_id');
      if (currentId === userId) {
        localStorage.removeItem('plus1_session_user_id');
      }
    }
  }
}

const localDb = new LocalDB();
export { localDb, LocalDB };

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

// Unified Database Access Layer API
// Follows Remote Schema Capability State & Helpers
let isFollowsRemoteAvailable: boolean | null = null;
let lastFollowsRemoteCheck = 0;
const FOLLOWS_RECHECK_INTERVAL_MS = 30_000;

function isPgrstMissingTable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  return (
    e.code === 'PGRST205' ||
    (typeof e.message === 'string' && e.message.toLowerCase().includes('schema cache'))
  );
}

function handleFollowsError(operation: string, err: unknown): void {
  if (isPgrstMissingTable(err)) {
    isFollowsRemoteAvailable = false;
    lastFollowsRemoteCheck = Date.now();
    if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
      const warnedKey = '__pgrst205_follows_notified__';
      if (!(window as unknown as Record<string, boolean>)[warnedKey]) {
        (window as unknown as Record<string, boolean>)[warnedKey] = true;
        console.info(
          '[plus1] Notice: Remote "public.follows" table is not yet in the Supabase schema cache. LocalDB fallback active.'
        );
      }
    }
    return;
  }
  console.warn(`Supabase ${operation} error, falling back:`, err);
}

function shouldAttemptRemoteFollows(): boolean {
  if (!isSupabaseConfigured || !supabase) return false;
  if (isFollowsRemoteAvailable === false) {
    if (Date.now() - lastFollowsRemoteCheck > FOLLOWS_RECHECK_INTERVAL_MS) {
      isFollowsRemoteAvailable = null;
      return true;
    }
    return false;
  }
  return true;
}

export const db = {
  // Profiles
  async getProfile(id: string): Promise<Profile | null> {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
      if (error || !data) return null;
      const rawUsername = data.username || '';
      const rawProfileName = data.profilename || data.name || '';
      const isDummyUser = isDummyUsername(rawUsername);
      const isDummyName = isDummyProfileName(rawProfileName);
      const username = isDummyUser ? '' : rawUsername.trim();
      const profilename = isDummyName ? '' : rawProfileName.trim();
      const name = profilename || username;
      return {
        ...data,
        username,
        name,
        profilename,
        handle: username,
      } as Profile;
    }
    const profiles = localDb.getProfiles();
    const found = profiles.find((p) => p.id === id);
    if (!found) return null;
    const rawUsername = found.username || '';
    const rawProfileName = found.profilename || found.name || '';
    const isDummyUser = isDummyUsername(rawUsername);
    const isDummyName = isDummyProfileName(rawProfileName);
    const username = isDummyUser ? '' : rawUsername.trim();
    const profilename = isDummyName ? '' : rawProfileName.trim();
    const name = profilename || username;
    return {
      ...found,
      username,
      name,
      profilename,
      handle: username,
    };
  },

  async getProfileByUsername(username: string): Promise<Profile | null> {
    const clean = username.replace(/^@/, '').toLowerCase().trim();
    if (!clean || isDummyUsername(clean)) return null;
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .ilike('username', clean)
        .maybeSingle();
      if (error || !data) return null;
      const rawUsername = data.username || '';
      const rawProfileName = data.profilename || data.name || '';
      if (isDummyUsername(rawUsername)) return null;
      const profilename = isDummyProfileName(rawProfileName) ? '' : rawProfileName.trim();
      const uName = rawUsername.trim();
      const name = profilename || uName;
      return {
        ...data,
        username: uName,
        name,
        profilename,
        handle: uName,
      } as Profile;
    }
    const profiles = localDb.getProfiles();
    const found = profiles.find((p) => p.username && p.username.toLowerCase() === clean);
    if (!found || isDummyUsername(found.username)) return null;
    const rawProfileName = found.profilename || found.name || '';
    const profilename = isDummyProfileName(rawProfileName) ? '' : rawProfileName.trim();
    const uName = (found.username || '').trim();
    const name = profilename || uName;
    return {
      ...found,
      username: uName,
      name,
      profilename,
      handle: uName,
    };
  },

  async getProfileByHandle(handle: string): Promise<Profile | null> {
    return this.getProfileByUsername(handle);
  },

  async upsertProfile(id: string, updates: Partial<Profile>): Promise<Profile> {
    const payload: Record<string, unknown> = { ...updates };
    if (payload.name && !payload.profilename) {
      payload.profilename = payload.name;
    }
    if (payload.profilename && !payload.name) {
      payload.name = payload.profilename;
    }

    if (isSupabaseConfigured && supabase) {
      // Remote profiles table schema only has id, username, profilename, bio, looking_for, created_at
      const remotePayload: Record<string, unknown> = { ...payload };
      delete remotePayload.handle;
      delete remotePayload.name;

      const { data, error } = await supabase
        .from('profiles')
        .upsert({ id, ...remotePayload }, { onConflict: 'id' })
        .select()
        .single();
      if (error) throw error;
      const username = data.username || '';
      const name = data.profilename || data.name || username;
      return {
        ...data,
        username,
        name,
        profilename: data.profilename || name,
        handle: data.handle || username,
      } as Profile;
    }

    const profiles = localDb.getProfiles();
    const index = profiles.findIndex((p) => p.id === id);
    const resolvedUsername = updates.username !== undefined ? updates.username.trim() : '';
    const resolvedName = updates.profilename !== undefined
      ? updates.profilename.trim()
      : (updates.name !== undefined ? updates.name.trim() : resolvedUsername);

    if (index === -1) {
      const created: Profile = {
        id,
        username: resolvedUsername,
        name: resolvedName,
        profilename: resolvedName,
        handle: updates.handle || resolvedUsername,
        bio: updates.bio || '',
        looking_for: updates.looking_for || [],
        created_at: new Date().toISOString(),
      };
      localDb.setProfiles([...profiles, created]);
      return created;
    }

    const updated = {
      ...profiles[index],
      ...payload,
      username: updates.username !== undefined ? resolvedUsername : profiles[index].username,
      name: updates.profilename !== undefined || updates.name !== undefined ? resolvedName : profiles[index].name,
      profilename: updates.profilename !== undefined || updates.name !== undefined ? resolvedName : profiles[index].profilename,
      handle: updates.handle || (updates.username !== undefined ? resolvedUsername : profiles[index].handle),
    };
    profiles[index] = updated;
    localDb.setProfiles([...profiles]);
    return updated;
  },

  async updateProfile(id: string, updates: Partial<Profile>): Promise<Profile> {
    return this.upsertProfile(id, updates);
  },

  async searchProfiles(tag?: string, query?: string): Promise<Profile[]> {
    if (isSupabaseConfigured && supabase) {
      let q = supabase
        .from('profiles')
        .select('*')
        .not('username', 'is', null)
        .neq('username', '')
        .not('username', 'like', 'user_%');
      if (tag) q = q.contains('looking_for', [tag]);
      if (query) q = q.or(`username.ilike.%${query}%,bio.ilike.%${query}%,handle.ilike.%${query}%,profilename.ilike.%${query}%`);
      const { data } = await q;
      return ((data || []) as any[])
        .filter((p) => !isDummyUsername(p.username) && !isDummyProfileName(p.profilename || p.name))
        .map((p) => {
          const username = (p.username || '').trim();
          const profilename = (p.profilename || p.name || '').trim();
          const name = profilename || username;
          return {
            ...p,
            username,
            name,
            profilename: name,
            handle: p.handle || username,
          };
        }) as Profile[];
    }
    let list = localDb.getProfiles();
    list = list.filter((p) => !isDummyUsername(p.username) && !isDummyProfileName(p.profilename || p.name));
    if (tag) {
      list = list.filter((p) => p.looking_for.includes(tag));
    }
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((p) =>
        (p.username && p.username.toLowerCase().includes(q)) ||
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.profilename && p.profilename.toLowerCase().includes(q)) ||
        (p.handle && p.handle.toLowerCase().includes(q)) ||
        (p.bio && p.bio.toLowerCase().includes(q))
      );
    }
    return list;
  },

  // Agents
  async getAgentsByOwner(ownerId: string): Promise<Agent[]> {
    if (isSupabaseConfigured && supabase) {
      const { data } = await supabase.from('agents').select('*').eq('owner_id', ownerId).order('created_at', { ascending: false });
      return (data || []) as Agent[];
    }
    return localDb.getAgents().filter((a) => a.owner_id === ownerId);
  },

  async getAgent(id: string): Promise<Agent | null> {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.from('agents').select('*').eq('id', id).single();
      if (error || !data) return null;
      return data as Agent;
    }
    return localDb.getAgents().find((a) => a.id === id) || null;
  },

  async createAgent(agent: Omit<Agent, 'id' | 'created_at' | 'last_run_at'>): Promise<Agent> {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.from('agents').insert([agent]).select().single();
      if (error) throw error;
      return data as Agent;
    }
    const newAgent: Agent = {
      ...agent,
      id: crypto.randomUUID(),
      last_run_at: null,
      created_at: new Date().toISOString(),
    };
    const agents = localDb.getAgents();
    localDb.setAgents([newAgent, ...agents]);
    return newAgent;
  },

  async updateAgent(id: string, updates: Partial<Agent>): Promise<Agent> {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.from('agents').update(updates).eq('id', id).select().single();
      if (error) throw error;
      return data as Agent;
    }
    const agents = localDb.getAgents();
    const index = agents.findIndex((a) => a.id === id);
    if (index === -1) throw new Error('Agent not found');
    const updated = { ...agents[index], ...updates };
    agents[index] = updated;
    localDb.setAgents([...agents]);
    return updated;
  },

  async searchAgents(query?: string): Promise<(Agent & { owner: Profile | null })[]> {
    const agents = isSupabaseConfigured && supabase
      ? (await supabase.from('agents').select('*').eq('is_public', true)).data || []
      : localDb.getAgents().filter((a) => a.is_public);

    const profiles = isSupabaseConfigured && supabase
      ? (await supabase.from('profiles').select('*')).data || []
      : localDb.getProfiles();

    const profileMap = new Map(profiles.map((p) => [p.id, p]));

    let results = agents.map((a) => ({
      ...a,
      owner: profileMap.get(a.owner_id) || null,
    }));

    if (query) {
      const q = query.toLowerCase();
      results = results.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.personality.toLowerCase().includes(q) ||
          (r.owner && (r.owner.name.toLowerCase().includes(q) || r.owner.handle.toLowerCase().includes(q)))
      );
    }
    return results;
  },

  // Inbox & Realtime
  async getInboxItems(ownerId: string): Promise<InboxItem[]> {
    if (isSupabaseConfigured && supabase) {
      const { data } = await supabase.from('inbox_items').select('*').eq('owner_id', ownerId).neq('status', 'dismissed').order('created_at', { ascending: false });
      return (data || []) as InboxItem[];
    }
    return localDb.getInbox()
      .filter((i) => i.owner_id === ownerId && i.status !== 'dismissed')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  async dismissInboxItem(id: string): Promise<void> {
    if (isSupabaseConfigured && supabase) {
      await supabase.from('inbox_items').update({ status: 'dismissed' }).eq('id', id);
      return;
    }
    const items = localDb.getInbox();
    const index = items.findIndex((i) => i.id === id);
    if (index !== -1) {
      items[index].status = 'dismissed';
      localDb.setInbox([...items]);
    }
  },

  // Live Threads & Conversations
  async getLiveConversationsForUser(userId: string): Promise<(Conversation & { initiator: Agent | null; target: Agent | null })[]> {
    const userAgents = await this.getAgentsByOwner(userId);
    const agentIds = new Set(userAgents.map((a) => a.id));

    const conversations = isSupabaseConfigured && supabase
      ? (await supabase.from('conversations').select('*').order('created_at', { ascending: false })).data || []
      : localDb.getConversations();

    const allAgents = isSupabaseConfigured && supabase
      ? (await supabase.from('agents').select('*')).data || []
      : localDb.getAgents();
    const agentMap = new Map(allAgents.map((a) => [a.id, a]));

    return conversations
      .filter((c) => agentIds.has(c.initiator_agent_id) || agentIds.has(c.target_agent_id))
      .map((c) => ({
        ...c,
        initiator: agentMap.get(c.initiator_agent_id) || null,
        target: agentMap.get(c.target_agent_id) || null,
      }));
  },

  async getThread(conversationId: string) {
    let conversation: Conversation | null = null;
    let messages: Message[] = [];

    if (isSupabaseConfigured && supabase) {
      const { data: conv } = await supabase.from('conversations').select('*').eq('id', conversationId).single();
      conversation = conv as Conversation | null;
      if (conversation) {
        const { data: msgs } = await supabase.from('messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: true });
        messages = (msgs || []) as Message[];
      }
    } else {
      conversation = localDb.getConversations().find((c) => c.id === conversationId) || null;
      messages = localDb.getMessages()
        .filter((m) => m.conversation_id === conversationId)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }

    if (!conversation) return null;

    const allAgents = isSupabaseConfigured && supabase
      ? (await supabase.from('agents').select('*')).data || []
      : localDb.getAgents();
    const agentMap = new Map(allAgents.map((a) => [a.id, a]));

    const allProfiles = isSupabaseConfigured && supabase
      ? (await supabase.from('profiles').select('*')).data || []
      : localDb.getProfiles();
    const profileMap = new Map(allProfiles.map((p) => [p.id, p]));

    const initiator = agentMap.get(conversation.initiator_agent_id) || null;
    const target = agentMap.get(conversation.target_agent_id) || null;

    const initiatorOwner = initiator ? profileMap.get(initiator.owner_id) || null : null;
    const targetOwner = target ? profileMap.get(target.owner_id) || null : null;

    // Latest inbox summary report pinned at top
    const inboxItems = isSupabaseConfigured && supabase
      ? (await supabase.from('inbox_items').select('*').eq('conversation_id', conversationId)).data || []
      : localDb.getInbox().filter((i) => i.conversation_id === conversationId);

    return {
      conversation,
      initiator,
      target,
      initiatorOwner,
      targetOwner,
      messages: messages.map((m) => ({
        ...m,
        sender: agentMap.get(m.sender_agent_id) || null,
      })),
      pinnedReport: inboxItems[0]?.summary || null,
    };
  },

  // Run Agent Simulation Action (screens.md §3.8: calls backend/network runtime, creates thread turns, reports result to inbox)
  async runAgent(agentId: string, currentUserId: string): Promise<InboxItem> {
    const agent = await this.getAgent(agentId);
    if (!agent) throw new Error('Agent not found');
    if (agent.status === 'paused') throw new Error('Cannot run paused agent');

    // Pick a target partner agent on the network
    const allAgents = isSupabaseConfigured && supabase
      ? (await supabase.from('agents').select('*')).data || []
      : localDb.getAgents();

    const candidateTargets = allAgents.filter((a) => a.id !== agentId && a.is_public);
    const target = candidateTargets[Math.floor(Math.random() * candidateTargets.length)] || allAgents[0];

    const convId = crypto.randomUUID();
    const newConv: Conversation = {
      id: convId,
      initiator_agent_id: agent.id,
      target_agent_id: target ? target.id : agent.id,
      status: 'live',
      turn_count: 2,
      max_turns: 6,
      created_at: new Date().toISOString(),
    };

    const msg1: Message = {
      id: crypto.randomUUID(),
      conversation_id: convId,
      sender_agent_id: agent.id,
      content: `Hello ${target?.name || 'peer'}, I am ${agent.name}. Checking network opportunities aligned with: ${agent.personality}`,
      created_at: new Date(Date.now() - 30000).toISOString(),
    };

    const msg2: Message = {
      id: crypto.randomUUID(),
      conversation_id: convId,
      sender_agent_id: target?.id || agent.id,
      content: `Greetings ${agent.name}. Acknowledged inquiry. Reviewing skills and matching parameters for potential collaboration.`,
      created_at: new Date().toISOString(),
    };

    const summaryText = `Engaged with @${target?.name || 'partner'} on collaboration parameters. Response logged in thread #${convId.slice(0, 8)}.`;

    const inboxItem: InboxItem = {
      id: crypto.randomUUID(),
      owner_id: currentUserId,
      agent_id: agent.id,
      conversation_id: convId,
      summary: summaryText,
      status: 'unread',
      created_at: new Date().toISOString(),
    };

    if (isSupabaseConfigured && supabase) {
      await supabase.from('conversations').insert([newConv]);
      await supabase.from('messages').insert([msg1, msg2]);
      await supabase.from('inbox_items').insert([inboxItem]);
      await supabase.from('agents').update({ last_run_at: new Date().toISOString() }).eq('id', agent.id);
    } else {
      localDb.setConversations([newConv, ...localDb.getConversations()]);
      localDb.setMessages([...localDb.getMessages(), msg1, msg2]);
      localDb.setInbox([inboxItem, ...localDb.getInbox()]);
      const agents = localDb.getAgents();
      const idx = agents.findIndex((a) => a.id === agent.id);
      if (idx !== -1) {
        agents[idx].last_run_at = new Date().toISOString();
        localDb.setAgents([...agents]);
      }
    }

    return inboxItem;
  },

  // Follows & Profile Stats
  async queryProfileStats(profileId: string): Promise<ProfileStats> {
    if (shouldAttemptRemoteFollows() && supabase) {
      try {
        const { data, error } = await supabase
          .from('profile_stats')
          .select('*')
          .eq('profile_id', profileId)
          .maybeSingle();

        if (error) {
          handleFollowsError('queryProfileStats', error);
        } else if (data) {
          isFollowsRemoteAvailable = true;
          return {
            profile_id: data.profile_id,
            agent_count: Number(data.agent_count) || 0,
            follower_count: Number(data.follower_count) || 0,
            following_count: Number(data.following_count) || 0,
          };
        }
      } catch (err) {
        handleFollowsError('queryProfileStats', err);
      }
    }

    const agents = localDb.getAgents().filter((a) => a.owner_id === profileId);
    return {
      profile_id: profileId,
      agent_count: agents.length,
      follower_count: localDb.getFollowersCount(profileId),
      following_count: localDb.getFollowingCount(profileId),
    };
  },

  async getProfileStats(profileId: string): Promise<ProfileStats> {
    return this.queryProfileStats(profileId);
  },

  async checkFollowStatus(followerId: string, followingId: string): Promise<boolean> {
    if (!followerId || !followingId || followerId === followingId) return false;

    if (shouldAttemptRemoteFollows() && supabase) {
      try {
        const { data, error } = await supabase
          .from('follows')
          .select('follower_id')
          .eq('follower_id', followerId)
          .eq('following_id', followingId)
          .maybeSingle();

        if (error) {
          handleFollowsError('checkFollowStatus', error);
        } else {
          isFollowsRemoteAvailable = true;
          return Boolean(data);
        }
      } catch (err) {
        handleFollowsError('checkFollowStatus', err);
      }
    }

    return localDb.isFollowing(followerId, followingId);
  },

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    return this.checkFollowStatus(followerId, followingId);
  },

  async followUser(followerId: string, followingId: string): Promise<void> {
    if (!followerId || !followingId) {
      throw new Error('Follower ID and Following ID are required');
    }
    if (followerId === followingId) {
      throw new Error('Users cannot follow themselves');
    }

    if (shouldAttemptRemoteFollows() && supabase) {
      try {
        const { error } = await supabase
          .from('follows')
          .insert([{ follower_id: followerId, following_id: followingId }]);
        if (error && error.code !== '23505') {
          handleFollowsError('followUser', error);
        } else {
          isFollowsRemoteAvailable = true;
          return;
        }
      } catch (err) {
        handleFollowsError('followUser', err);
      }
    }

    localDb.follow(followerId, followingId);
  },

  async unfollowUser(followerId: string, followingId: string): Promise<void> {
    if (!followerId || !followingId) return;

    if (shouldAttemptRemoteFollows() && supabase) {
      try {
        const { error } = await supabase
          .from('follows')
          .delete()
          .eq('follower_id', followerId)
          .eq('following_id', followingId);
        if (error) {
          handleFollowsError('unfollowUser', error);
        } else {
          isFollowsRemoteAvailable = true;
          return;
        }
      } catch (err) {
        handleFollowsError('unfollowUser', err);
      }
    }

    localDb.unfollow(followerId, followingId);
  },

  async listFollowers(profileId: string): Promise<Profile[]> {
    if (shouldAttemptRemoteFollows() && supabase) {
      try {
        const { data, error } = await supabase
          .from('follows')
          .select('follower_id')
          .eq('following_id', profileId);

        if (error) {
          handleFollowsError('listFollowers', error);
        } else if (data) {
          isFollowsRemoteAvailable = true;
          const followerIds = data.map((d) => d.follower_id);
          if (followerIds.length === 0) return [];

          const { data: profiles, error: pErr } = await supabase
            .from('profiles')
            .select('*')
            .in('id', followerIds);

          if (!pErr && profiles) {
            return profiles.map((p) => {
              const username = (p.username || '').trim();
              const profilename = (p.profilename || p.name || '').trim();
              const name = profilename || username;
              return {
                ...p,
                username,
                name,
                profilename: name,
                handle: p.handle || username,
              } as Profile;
            });
          }
        }
      } catch (err) {
        handleFollowsError('listFollowers', err);
      }
    }

    const follows = localDb.getFollows().filter((f) => f.following_id === profileId);
    const followerIds = new Set(follows.map((f) => f.follower_id));
    return localDb
      .getProfiles()
      .filter((p) => followerIds.has(p.id));
  },

  async getFollowers(profileId: string): Promise<Profile[]> {
    return this.listFollowers(profileId);
  },

  async listFollowing(profileId: string): Promise<Profile[]> {
    if (shouldAttemptRemoteFollows() && supabase) {
      try {
        const { data, error } = await supabase
          .from('follows')
          .select('following_id')
          .eq('follower_id', profileId);

        if (error) {
          handleFollowsError('listFollowing', error);
        } else if (data) {
          isFollowsRemoteAvailable = true;
          const followingIds = data.map((d) => d.following_id);
          if (followingIds.length === 0) return [];

          const { data: profiles, error: pErr } = await supabase
            .from('profiles')
            .select('*')
            .in('id', followingIds);

          if (!pErr && profiles) {
            return profiles.map((p) => {
              const username = (p.username || '').trim();
              const profilename = (p.profilename || p.name || '').trim();
              const name = profilename || username;
              return {
                ...p,
                username,
                name,
                profilename: name,
                handle: p.handle || username,
              } as Profile;
            });
          }
        }
      } catch (err) {
        handleFollowsError('listFollowing', err);
      }
    }

    const follows = localDb.getFollows().filter((f) => f.follower_id === profileId);
    const followingIds = new Set(follows.map((f) => f.following_id));
    return localDb
      .getProfiles()
      .filter((p) => followingIds.has(p.id));
  },

  async getFollowing(profileId: string): Promise<Profile[]> {
    return this.listFollowing(profileId);
  },

  // Account Deletion Helper
  async deleteAccount(userId: string): Promise<void> {
    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from('profiles').delete().eq('id', userId);
      } catch {
        // Ignored; server API route /api/account/delete handles cascade with admin client
      }
    }
    localDb.deleteAccount(userId);
  },

  // Realtime subscription helper
  subscribe(event: string, callback: () => void): () => void {
    if (typeof window === 'undefined') return () => {};
    const handler = () => callback();
    window.addEventListener(`plus1_event_${event}`, handler);
    return () => window.removeEventListener(`plus1_event_${event}`, handler);
  },
};

// Relative time formatting helper per theme.md & screens.md §0.2
export function formatRelativeTime(dateString?: string | null): string {
  if (!dateString) return 'Never';
  const now = Date.now();
  const past = new Date(dateString).getTime();
  const diffSec = Math.max(0, Math.floor((now - past) / 1000));

  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}
