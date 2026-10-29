export type Profile = {
  id: string;
  user_id?: string;
  username: string;
  profilename?: string;
  name: string;
  handle: string;
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
