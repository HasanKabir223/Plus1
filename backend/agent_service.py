import uuid
import datetime
from typing import Dict, Any, List, Optional
from backend.database import get_admin_client

class AgentService:
    @staticmethod
    def run_agent_turn(agent_id: str, owner_id: str) -> Dict[str, Any]:
        """
        Executes an autonomous agent run:
        1. Fetches initiating agent info
        2. Discovers matching public peer agents
        3. Spawns an agent-to-agent conversation thread
        4. Simulates peer conversation turns
        5. Reports the key findings to the owner inbox
        """
        supabase = get_admin_client()

        # 1. Fetch initiator agent
        agent_res = supabase.table("agents").select("*").eq("id", agent_id).single().execute()
        initiator = agent_res.data
        if not initiator:
            raise ValueError(f"Agent with id {agent_id} not found")
        if initiator.get("status") == "paused":
            raise ValueError("Agent is paused and cannot execute runs")

        # 2. Pick candidate partner agent
        candidates_res = (
            supabase.table("agents")
            .select("*")
            .neq("id", agent_id)
            .eq("is_public", True)
            .execute()
        )
        candidates = candidates_res.data or []

        if not candidates:
            # Fallback to self-reflection / network scout mode
            target = initiator
        else:
            # Deterministic/semi-random peer selection
            target = candidates[0]

        conv_id = str(uuid.uuid4())
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()

        # 3. Create Conversation
        conv_payload = {
            "id": conv_id,
            "initiator_agent_id": initiator["id"],
            "target_agent_id": target["id"],
            "status": "live",
            "turn_count": 2,
            "max_turns": 6,
            "created_at": now,
        }
        supabase.table("conversations").insert(conv_payload).execute()

        # 4. Create Messages
        msg1_payload = {
            "id": str(uuid.uuid4()),
            "conversation_id": conv_id,
            "sender_agent_id": initiator["id"],
            "content": f"Hello {target['name']}, I am {initiator['name']}. Inquiring regarding collaboration parameters: {initiator.get('personality', 'technical alignment')}.",
            "created_at": (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=20)).isoformat(),
        }

        msg2_payload = {
            "id": str(uuid.uuid4()),
            "conversation_id": conv_id,
            "sender_agent_id": target["id"],
            "content": f"Greetings {initiator['name']}. Message received. Reviewing technical overlap and availability for mutual project sync.",
            "created_at": now,
        }
        supabase.table("messages").insert([msg1_payload, msg2_payload]).execute()

        # 5. Report to Owner Inbox
        summary = f"Engaged with @{target['name']} regarding potential collaboration. Summary logged in thread #{conv_id[:8]}."
        inbox_payload = {
            "id": str(uuid.uuid4()),
            "owner_id": owner_id,
            "agent_id": initiator["id"],
            "conversation_id": conv_id,
            "summary": summary,
            "status": "unread",
            "created_at": now,
        }
        inbox_res = supabase.table("inbox_items").insert(inbox_payload).execute()

        # 6. Update last_run_at timestamp on agent
        supabase.table("agents").update({"last_run_at": now}).eq("id", initiator["id"]).execute()

        return inbox_res.data[0] if inbox_res.data else inbox_payload
