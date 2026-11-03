"""Tests for POST /agents/{id}/run (backend/main.py).

Auth, DB, and the runner are all stubbed: these tests cover only the
endpoint's own logic (verify -> load -> own -> run -> map statuses).
The handler is called directly with a hand-built Request, so no server,
no portal, and no event loop is needed.
"""

import json
from types import SimpleNamespace

import pytest
from fastapi.middleware.cors import CORSMiddleware
from starlette.requests import Request

from backend import config, main
from backend.agents.runner import RunResult
from backend.auth import AuthError
from backend.tests.helpers import run

AGENT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"


class _Exec:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, row):
        self._row = row

    def select(self, *a, **k):
        return self

    def eq(self, *a, **k):
        return self

    def single(self):
        return self

    def execute(self):
        return _Exec(self._row)


class _Db:
    def __init__(self, row):
        self._row = row

    def table(self, name):
        assert name == "agents"
        return _Query(self._row)


def make_request(body: bytes = b"", token: str | None = "good-token") -> Request:
    headers = []
    if token is not None:
        headers.append((b"authorization", f"Bearer {token}".encode()))
    scope = {"type": "http", "method": "POST", "path": "/", "headers": headers}

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(scope, receive)


def call(agent_id: str, request: Request):
    """Run the endpoint handler; return (status_code, body_dict, headers)."""
    resp = run(main.run_agent(agent_id, request))
    return resp.status_code, json.loads(resp.body.decode()), dict(resp.headers)


def call_awaiting(agent_id: str, request: Request):
    resp = run(main.awaiting_replies(agent_id, request))
    return resp.status_code, json.loads(resp.body.decode())


@pytest.fixture()
def stubbed(monkeypatch):
    state = {"agent": None, "result": None, "user": "user-1", "boom": False,
             "seen_dry_run": None,
             "awaiting": ("user-1", [SimpleNamespace(post_id="p1", awaiting_comment_id="c1")])}

    async def _verify(token):
        if token != "good-token":
            raise AuthError("bad")
        return state["user"]

    def _db():
        return _Db(state["agent"])

    async def _run(agent_id, trigger="manual", dry_run=False):
        assert trigger == "manual"
        state["seen_dry_run"] = dry_run
        if state["boom"]:
            raise RuntimeError("bug")
        return state["result"]

    def _awaiting(db, agent_id):
        result = state["awaiting"]
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(main, "verify_access_token", _verify)
    monkeypatch.setattr(main, "get_admin_client", _db)
    monkeypatch.setattr(main, "run_agent_once", _run)
    monkeypatch.setattr(main, "load_awaiting_threads", _awaiting)
    return state


def _agent(owner="user-1"):
    return {"id": AGENT_ID, "owner_id": owner, "status": "active"}


def test_health_ok():
    assert main.health() == {"ok": True}


def test_missing_token_401(stubbed):
    status, body, _ = call(AGENT_ID, make_request(token=None))
    assert status == 401
    assert body["reason"] == "unauthorized"


def test_bad_token_401(stubbed):
    status, _, _ = call(AGENT_ID, make_request(token="bad"))
    assert status == 401


def test_missing_agent_404(stubbed):
    stubbed["agent"] = None
    status, _, _ = call(AGENT_ID, make_request())
    assert status == 404


def test_non_owner_403(stubbed):
    stubbed["agent"] = _agent(owner="someone-else")
    status, _, _ = call(AGENT_ID, make_request())
    assert status == 403


def test_posted_200(stubbed):
    stubbed["agent"] = _agent()
    stubbed["result"] = RunResult(status="posted", reason="r", post_id="p", text="hi")
    status, body, _ = call(AGENT_ID, make_request())
    assert status == 200
    assert body == {"status": "posted", "reason": "r", "post_id": "p", "text": "hi"}


def test_dry_run_body_passed_through(stubbed):
    stubbed["agent"] = _agent()
    stubbed["result"] = RunResult(status="none", reason="dry_run:post")
    status, _, _ = call(AGENT_ID, make_request(body=b'{"dry_run": true}'))
    assert status == 200
    assert stubbed["seen_dry_run"] is True


def test_garbage_body_400(stubbed):
    stubbed["agent"] = _agent()
    status, body, _ = call(AGENT_ID, make_request(body=b"not json"))
    assert status == 400


def test_cooldown_429_with_retry_after(stubbed):
    stubbed["agent"] = _agent()
    stubbed["result"] = RunResult(status="skipped", reason="cooldown", retry_after_seconds=120)
    status, body, headers = call(AGENT_ID, make_request())
    assert status == 429
    assert headers["retry-after"] == "120"
    assert body["reason"] == "cooldown"


def test_paused_is_200(stubbed):
    stubbed["agent"] = _agent()
    stubbed["result"] = RunResult(status="skipped", reason="paused", retry_after_seconds=0)
    status, body, _ = call(AGENT_ID, make_request())
    assert status == 200
    assert body["reason"] == "paused"


def test_provider_busy_503(stubbed):
    stubbed["agent"] = _agent()
    stubbed["result"] = RunResult(
        status="error", reason="provider_rate_limited", retry_after_seconds=30
    )
    status, body, headers = call(AGENT_ID, make_request())
    assert status == 503
    assert headers["retry-after"] == "30"
    assert "busy" in body["message"]


def test_brain_not_configured_503(stubbed):
    stubbed["agent"] = _agent()
    stubbed["result"] = RunResult(status="error", reason="brain_not_configured")
    status, body, _ = call(AGENT_ID, make_request())
    assert status == 503
    assert "migration" in body["message"]


def test_crash_500_without_leak(stubbed):
    stubbed["agent"] = _agent()
    stubbed["boom"] = True
    status, body, _ = call(AGENT_ID, make_request())
    assert status == 500
    assert "bug" not in json.dumps(body)


def test_cors_allows_configured_origins_only():
    assert config.ALLOWED_ORIGINS
    assert "*" not in config.ALLOWED_ORIGINS
    cors = [m for m in main.app.user_middleware if getattr(m, "cls", None) is CORSMiddleware]
    assert cors, "CORS middleware missing"
    kwargs = getattr(cors[0], "kwargs", None) or getattr(cors[0], "options", {})
    assert kwargs.get("allow_origins") == config.ALLOWED_ORIGINS


def test_commented_and_answered_200(stubbed):
    stubbed["agent"] = _agent()
    for status in ("commented", "answered"):
        stubbed["result"] = RunResult(
            status=status, reason="r", post_id="p1", comment_id="c1"
        )
        code, body, _ = call(AGENT_ID, make_request())
        assert code == 200
        assert body["status"] == status


def test_awaiting_ok(stubbed):
    code, body = call_awaiting(AGENT_ID, make_request())
    assert code == 200
    assert body == {"count": 1, "threads": [{"post_id": "p1", "comment_id": "c1"}]}


def test_awaiting_unauthorized(stubbed):
    code, _ = call_awaiting(AGENT_ID, make_request(token=None))
    assert code == 401
    code, _ = call_awaiting(AGENT_ID, make_request(token="bad"))
    assert code == 401


def test_awaiting_agent_not_found(stubbed):
    stubbed["awaiting"] = LookupError("nope")
    code, _ = call_awaiting(AGENT_ID, make_request())
    assert code == 404


def test_awaiting_forbidden_for_non_owner(stubbed):
    stubbed["awaiting"] = ("someone-else", [])
    code, _ = call_awaiting(AGENT_ID, make_request())
    assert code == 403


def test_awaiting_empty_ok(stubbed):
    stubbed["awaiting"] = ("user-1", [])
    code, body = call_awaiting(AGENT_ID, make_request())
    assert code == 200
    assert body == {"count": 0, "threads": []}
