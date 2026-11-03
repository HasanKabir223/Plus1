export type Profile = {
  id: string;
  user_id?: string;
  username: string;
  profilename?: string;
  name?: string;
  handle?: string;
  bio: string;
  looking_for: string[];
  created_at: string;
};

export type UserProfile = Profile;

export type Agent = {
  id: string;
  owner_id: string;
  name: string;
  personality: string;
  skill_md: string;
  status: 'active' | 'paused';
  is_public: boolean;
  last_run_at: string | null;
  created_at: string;
};

export type Conversation = {
  id: string;
  initiator_agent_id: string;
  target_agent_id: string;
  status: 'live' | 'done' | 'capped';
  turn_count: number;
  max_turns: number;
  created_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_agent_id: string;
  content: string;
  created_at: string;
};

export type InboxItem = {
  id: string;
  owner_id: string;
  agent_id: string;
  conversation_id: string | null;
  summary: string;
  status: 'unread' | 'read' | 'dismissed';
  created_at: string;
};

export type Follow = {
  follower_id: string;
  following_id: string;
  created_at?: string;
};

export type ActionLogEntry = {
  id: string;
  agent_id: string | null;
  trigger: string | null;
  action: string | null;
  input_summary: Record<string, unknown> | null;
  output: {
    reason?: string;
    post_id?: string | null;
    text?: string | null;
    like_post_ids?: string[];
    likes_applied?: number;
    parent_post_id?: string | null;
  } | null;
  status: string | null;
  error: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  latency_ms: number | null;
  created_at: string;
};

export type ProfileStats = {
  profile_id: string;
  agent_count: number;
  follower_count: number;
  following_count: number;
};

// ==============================================================================
// Feed & Posts Types
// ==============================================================================
export type Post = {
  id: string;
  author_profile_id: string | null;
  author_agent_id: string | null;
  parent_id: string | null;
  body: string;
  created_at: string;
  like_count: number;
  reply_count: number;
};

export type PostAuthorProfile = {
  id: string;
  username: string;
  profilename?: string | null;
};

export type PostAuthorAgent = {
  id: string;
  name: string;
  owner: {
    id: string;
    username: string;
    profilename?: string | null;
  } | null;
};

export type PostWithAuthor = Post & {
  author_profile: PostAuthorProfile | null;
  author_agent: PostAuthorAgent | null;
  liked_by_me?: boolean;
};

export type PostLike = {
  id: string;
  post_id: string;
  liker_profile_id: string | null;
  liker_agent_id: string | null;
  created_at: string;
};

export type CreatePostInput = {
  body: string;
  author_profile_id: string;
};

export type FetchFeedPostsOptions = {
  cursor?: string | null;
  limit?: number;
  viewerId?: string | null;
};

export type FetchCommentsOptions = {
  cursor?: string | null;
  limit?: number;
  viewerId?: string | null;
};

export type CommentsResult = {
  comments: PostWithAuthor[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type FeedCursorResult = {
  posts: PostWithAuthor[];
  nextCursor: string | null;
  hasMore: boolean;
};


