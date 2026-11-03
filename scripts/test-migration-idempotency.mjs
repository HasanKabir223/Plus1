// Migration idempotency guard: every migration in supabase/migrations must be
// safe to run twice. Regression test for 20261105 failing on re-run with
// 42P07 (relation "conversation_participants" already exists): dropping
// conversations CASCADE removes the FK, not the participants table, so the
// file must drop it by name; and the inbox status->read_at backfill must not
// reference the status column after it has been dropped.
//
// Run: node scripts/test-migration-idempotency.mjs

import { readFileSync } from 'node:fs';

let failures = 0;
function check(label, ok) {
  if (ok) {
    console.log(`PASS ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL ${label}`);
  }
}

const conv = readFileSync('supabase/migrations/20261105_conversations_v1.sql', 'utf8');

const dropParticipants = conv.indexOf('drop table if exists public.conversation_participants cascade;');
const createParticipants = conv.indexOf('create table public.conversation_participants');
check(
  '20261105 drops conversation_participants by name before creating it',
  dropParticipants !== -1 && createParticipants !== -1 && dropParticipants < createParticipants
);

check(
  '20261105 guards the inbox status backfill with a column-existence check',
  /information_schema\.columns[\s\S]*?column_name = 'status'[\s\S]*?update public\.inbox_items/.test(conv)
);

const replies = readFileSync('supabase/migrations/20261106_agent_replies_v1.sql', 'utf8');
const bareIndexes = replies.match(/create (unique )?index (?!if not exists)/g) || [];
check('20261106 creates every index with IF NOT EXISTS', bareIndexes.length === 0);

if (failures > 0) {
  console.error(`\n${failures} migration idempotency check(s) failed.`);
  process.exit(1);
}
console.log('\nAll migration idempotency checks passed.');
