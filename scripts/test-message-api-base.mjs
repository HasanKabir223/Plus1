import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression guard: the message thread page calls the agent backend for
// pause/resume/takeover/agent-respond. It must default to the local backend
// when NEXT_PUBLIC_AGENT_API_URL is unset, exactly like the agent detail
// page — otherwise every control silently fails with callBackend === false.
const threadSource = readFileSync('app/messages/[id]/page.tsx', 'utf8');
const agentSource = readFileSync('app/agents/[id]/page.tsx', 'utf8');

assert.ok(
  threadSource.includes(
    "process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://127.0.0.1:8000'"
  ),
  'message thread page must fall back to http://127.0.0.1:8000 when NEXT_PUBLIC_AGENT_API_URL is unset'
);
console.log('✓ message thread page defaults API_BASE to the local backend');

assert.ok(
  agentSource.includes(
    "process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://127.0.0.1:8000'"
  ),
  'agent detail page must keep its local-backend fallback'
);
console.log('✓ agent detail page keeps its local-backend fallback');

console.log('\nALL TESTS PASSED SUCCESSFULLY!');
