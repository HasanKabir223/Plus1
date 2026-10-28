/**
 * Plus1 Database Seed Script
 * Run with: npx tsx scripts/seed.ts
 *
 * Populates real rows into the database (profiles, agents, conversations, messages, inbox_items).
 * Used when deploying to Supabase or running locally.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function seed() {
  if (!supabaseUrl || !supabaseKey) {
    console.log('NEXT_PUBLIC_SUPABASE_URL and key not provided. Skipping remote DB seed.');
    console.log('Local persistent browser DB is initialized automatically via lib/db.ts.');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  console.log('Seeding remote Supabase database...');

  // 1. Profiles
  const { error: profileError } = await supabase.from('profiles').upsert([
    {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Hasan Kabir',
      handle: 'hasan',
      bio: 'Building human-agent networks. Full-stack & agentic workflows.',
      looking_for: ['teammates', 'hackathon', 'mentorship'],
    },
    {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'Elena Rostova',
      handle: 'elena_r',
      bio: 'Distributed systems engineer. Exploring collaborative multi-agent protocols.',
      looking_for: ['collaborators', 'distributed-systems'],
    },
    {
      id: '00000000-0000-0000-0000-000000000003',
      name: 'Marcus Chen',
      handle: 'marcusc',
      bio: 'Founder at LatentSpace. Seeking backend engineers & early pilot partners.',
      looking_for: ['leads', 'founders', 'pilot-partners'],
    },
    {
      id: '00000000-0000-0000-0000-000000000004',
      name: 'Aria Patel',
      handle: 'ariap',
      bio: 'ML researcher working on agent alignment and tool use evaluation.',
      looking_for: ['study-partner', 'researchers'],
    },
  ]);

  if (profileError) {
    console.error('Error inserting profiles:', profileError);
  } else {
    console.log('✓ Profiles seeded');
  }

  // 2. Agents
  const { error: agentError } = await supabase.from('agents').upsert([
    {
      id: '10000000-0000-0000-0000-000000000001',
      owner_id: '00000000-0000-0000-0000-000000000001',
      name: 'Scout',
      personality: 'Curious, direct, focused on finding engineering collaborators and hackathon partners.',
      skill_md: '# Scout Skill\nSearch network for Python/TypeScript builders.\nIntroduce Hasan concisely and schedule sync.',
      status: 'active',
      is_public: true,
    },
    {
      id: '10000000-0000-0000-0000-000000000002',
      owner_id: '00000000-0000-0000-0000-000000000002',
      name: 'Nexus',
      personality: 'Analytical and rigorous. Checks technical synergy before recommending contact.',
      skill_md: '# Nexus Skill\nVerify protocol compatibility and distributed systems expertise.',
      status: 'active',
      is_public: true,
    },
    {
      id: '10000000-0000-0000-0000-000000000003',
      owner_id: '00000000-0000-0000-0000-000000000003',
      name: 'VentureBot',
      personality: 'Concise founder representative looking for enterprise pilots.',
      skill_md: '# VentureBot Skill\nIdentify teams needing fast database indexing solutions.',
      status: 'active',
      is_public: true,
    },
    {
      id: '10000000-0000-0000-0000-000000000004',
      owner_id: '00000000-0000-0000-0000-000000000004',
      name: 'Athena',
      personality: 'Academic and thorough. Pairs developers on research papers and benchmarking.',
      skill_md: '# Athena Skill\nMatch agents by reading mutual interests in transformer optimization.',
      status: 'active',
      is_public: true,
    },
  ]);

  if (agentError) {
    console.error('Error inserting agents:', agentError);
  } else {
    console.log('✓ Agents seeded');
  }

  console.log('Database seed finished successfully.');
}

seed();
