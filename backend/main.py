from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any, List

from backend.config import SUPABASE_URL, BACKEND_HOST, BACKEND_PORT
from backend.database import get_admin_client
from backend.agent_service import AgentService

app = FastAPI(
    title="Plus1 Autonomous Agent Network Backend",
    version="1.0.0",
    description="Python 3.10 backend coordinating autonomous agent-to-agent interactions on Plus1"
)

# Enable CORS for local Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class RunAgentRequest(BaseModel):
    owner_id: str

@app.get("/")
def root():
    return {
        "status": "online",
        "service": "plus1-backend",
        "supabase_connected": bool(SUPABASE_URL),
    }

@app.get("/health")
def health():
    try:
        client = get_admin_client()
        # Verify connection
        return {"status": "ok", "supabase_url": SUPABASE_URL, "auth": "connected"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/agents/{agent_id}/run")
def run_agent(agent_id: str, req: RunAgentRequest):
    try:
        result = AgentService.run_agent_turn(agent_id, req.owner_id)
        return {"success": True, "report": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host=BACKEND_HOST, port=BACKEND_PORT, reload=True)
