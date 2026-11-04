"""Tests for the LLM wrapper (backend/llm.py). No network: httpx is faked."""

import httpx
import pytest

from backend import config, llm
from backend.tests.helpers import run
from backend.llm import (
    LLMConfigError,
    LLMGenerationError,
    LLMRateLimited,
    LLMUnavailable,
    llm_complete,
    warn_if_model_unlisted,
)


class FakeResponse:
    def __init__(self, status_code, payload=None, headers=None):
        self.status_code = status_code
        self._payload = payload or {}
        self.headers = headers or {}

    def json(self):
        return self._payload


class FakeAsyncClient:
    """Drop-in for httpx.AsyncClient playing a script of responses/errors."""

    script: list = []
    seen_requests: list = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url, headers=None, json=None):
        # Snapshot the body: the caller may mutate it between attempts, but
        # a real client serializes each request at send time.
        body = dict(json) if isinstance(json, dict) else json
        FakeAsyncClient.seen_requests.append({"url": url, "headers": headers, "json": body})
        item = FakeAsyncClient.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    async def get(self, url, headers=None):
        FakeAsyncClient.seen_requests.append({"url": url, "headers": headers, "json": None})
        item = FakeAsyncClient.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


@pytest.fixture(autouse=True)
def _fake_http(monkeypatch):
    FakeAsyncClient.script = []
    FakeAsyncClient.seen_requests = []
    monkeypatch.setattr(llm.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(config, "LLM_API_KEY", "test-key")
    monkeypatch.setattr(config, "LLM_BASE_URL", "https://llm.test/v1")
    monkeypatch.setattr(config, "LLM_MODEL", "test-model")
    monkeypatch.setattr(config, "LLM_REASONING_EFFORT", "")
    # Failover is opt-in per test; the real .env may configure it.
    monkeypatch.setattr(config, "LLM_FALLBACK_BASE_URL", "")
    monkeypatch.setattr(config, "LLM_FALLBACK_API_KEY", "")
    monkeypatch.setattr(config, "LLM_FALLBACK_MODEL", "")
    monkeypatch.setattr(config, "LLM_FALLBACK_REASONING_EFFORT", "")
    # No real sleeping in retries.
    async def _no_sleep(_):
        return None
    monkeypatch.setattr(llm.asyncio, "sleep", _no_sleep)
    return FakeAsyncClient


def _ok_payload(text='{"action": "none"}'):
    return {
        "model": "test-model",
        "choices": [{"message": {"content": text}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
    }


def test_success_extracts_content_and_usage():
    FakeAsyncClient.script = [FakeResponse(200, _ok_payload())]
    result = run(llm_complete([{"role": "user", "content": "hi"}]))
    assert result.text == '{"action": "none"}'
    assert (result.tokens_in, result.tokens_out) == (10, 5)
    assert result.model == "test-model"
    assert result.latency_ms >= 0


def test_request_shape_and_json_mode():
    FakeAsyncClient.script = [FakeResponse(200, _ok_payload())]
    run(llm_complete([{"role": "user", "content": "hi"}], max_tokens=50, temperature=0.1))
    req = FakeAsyncClient.seen_requests[0]
    assert req["url"] == "https://llm.test/v1/chat/completions"
    assert req["json"]["model"] == "test-model"
    assert req["json"]["response_format"] == {"type": "json_object"}
    assert req["headers"]["Authorization"] == "Bearer test-key"


def test_list_content_parts_joined():
    payload = _ok_payload()
    payload["choices"] = [{"message": {"content": [
        {"type": "text", "text": "a"},
        {"type": "reasoning", "text": "ignored"},
        {"type": "text", "text": "b"},
    ]}}]
    FakeAsyncClient.script = [FakeResponse(200, payload)]
    assert run(llm_complete([{"role": "user", "content": "hi"}])).text == "ab"


def test_429_raises_rate_limited_with_retry_after():
    FakeAsyncClient.script = [FakeResponse(429, {}, {"retry-after": "7"})]
    with pytest.raises(LLMRateLimited) as exc:
        run(llm_complete([{"role": "user", "content": "hi"}]))
    assert exc.value.retry_after == 7


def test_429_without_header_has_no_hint():
    FakeAsyncClient.script = [FakeResponse(429)]
    with pytest.raises(LLMRateLimited) as exc:
        run(llm_complete([{"role": "user", "content": "hi"}]))
    assert exc.value.retry_after is None


def test_500_retries_once_then_succeeds():
    FakeAsyncClient.script = [FakeResponse(500), FakeResponse(200, _ok_payload())]
    result = run(llm_complete([{"role": "user", "content": "hi"}]))
    assert result.text == '{"action": "none"}'
    assert len(FakeAsyncClient.seen_requests) == 2


def test_500_twice_raises_unavailable():
    FakeAsyncClient.script = [FakeResponse(500), FakeResponse(503)]
    with pytest.raises(LLMUnavailable):
        run(llm_complete([{"role": "user", "content": "hi"}]))


def test_timeout_retries_then_unavailable():
    FakeAsyncClient.script = [
        httpx.TimeoutException("slow"),
        httpx.TimeoutException("slow"),
    ]
    with pytest.raises(LLMUnavailable):
        run(llm_complete([{"role": "user", "content": "hi"}]))


def test_401_raises_config_error_without_key():
    FakeAsyncClient.script = [FakeResponse(401)]
    with pytest.raises(LLMConfigError) as exc:
        run(llm_complete([{"role": "user", "content": "hi"}]))
    assert "test-key" not in str(exc.value)


def test_missing_key_raises_config_error(monkeypatch):
    monkeypatch.setattr(config, "LLM_API_KEY", "")
    with pytest.raises(LLMConfigError):
        run(llm_complete([{"role": "user", "content": "hi"}]))
    assert FakeAsyncClient.seen_requests == []


def test_single_model_used_with_no_tier():
    FakeAsyncClient.script = [FakeResponse(200, _ok_payload())]
    run(llm_complete([{"role": "user", "content": "hi"}]))
    req = FakeAsyncClient.seen_requests[0]
    assert req["json"]["model"] == "test-model"


def test_startup_warns_when_model_not_listed(monkeypatch, caplog):
    monkeypatch.setattr(config, "LLM_MODEL", "missing-model")
    FakeAsyncClient.script = [FakeResponse(200, {"data": [{"id": "other-model"}]})]
    with caplog.at_level("WARNING", logger="backend.llm"):
        run(warn_if_model_unlisted())
    assert FakeAsyncClient.seen_requests[0]["url"] == "https://llm.test/v1/models"
    assert any("missing-model" in r.message for r in caplog.records)


def test_startup_silent_when_model_listed(caplog):
    FakeAsyncClient.script = [FakeResponse(200, {"data": [{"id": "test-model"}]})]
    with caplog.at_level("WARNING", logger="backend.llm"):
        run(warn_if_model_unlisted())
    assert not [r for r in caplog.records if "not in provider" in r.message]


def test_startup_silent_when_model_listed_with_prefix(caplog):
    # Gemini's OpenAI-compatible /models returns "models/<id>" entries.
    FakeAsyncClient.script = [FakeResponse(200, {"data": [{"id": "models/test-model"}]})]
    with caplog.at_level("WARNING", logger="backend.llm"):
        run(warn_if_model_unlisted())
    assert not [r for r in caplog.records if "not in provider" in r.message]


def test_startup_check_never_raises():
    FakeAsyncClient.script = [httpx.TimeoutException("slow")]
    assert run(warn_if_model_unlisted()) is None


def test_effort_omitted_when_empty():
    FakeAsyncClient.script = [FakeResponse(200, _ok_payload())]
    run(llm_complete([{"role": "user", "content": "hi"}]))
    assert "reasoning_effort" not in FakeAsyncClient.seen_requests[0]["json"]


def test_effort_sent_when_set(monkeypatch):
    monkeypatch.setattr(config, "LLM_REASONING_EFFORT", "low")
    FakeAsyncClient.script = [FakeResponse(200, _ok_payload())]
    run(llm_complete([{"role": "user", "content": "hi"}]))
    assert FakeAsyncClient.seen_requests[0]["json"]["reasoning_effort"] == "low"


def test_400_with_effort_retries_once_without_it(monkeypatch, caplog):
    monkeypatch.setattr(config, "LLM_REASONING_EFFORT", "low")
    FakeAsyncClient.script = [FakeResponse(400), FakeResponse(200, _ok_payload())]
    with caplog.at_level("WARNING", logger="backend.llm"):
        result = run(llm_complete([{"role": "user", "content": "hi"}]))
    assert result.text == '{"action": "none"}'
    assert len(FakeAsyncClient.seen_requests) == 2
    assert FakeAsyncClient.seen_requests[0]["json"]["reasoning_effort"] == "low"
    assert "reasoning_effort" not in FakeAsyncClient.seen_requests[1]["json"]
    assert any("reasoning_effort" in r.message for r in caplog.records)


def test_400_without_effort_raises_immediately():
    FakeAsyncClient.script = [FakeResponse(400)]
    with pytest.raises(LLMConfigError):
        run(llm_complete([{"role": "user", "content": "hi"}]))
    assert len(FakeAsyncClient.seen_requests) == 1


# Groq intermittently answers a json_object request with HTTP 400
# code=json_validate_failed when the sampled output is not valid JSON.
# That is a generation failure, not a configuration problem: one fresh
# sample usually succeeds, and it must never surface as LLMConfigError.
_GENERATION_400 = {
    "error": {
        "message": "Failed to validate JSON. Please adjust your prompt.",
        "type": "invalid_request_error",
        "code": "json_validate_failed",
        "failed_generation": "",
    }
}


def test_generation_400_retries_once_then_succeeds():
    FakeAsyncClient.script = [
        FakeResponse(400, _GENERATION_400),
        FakeResponse(200, _ok_payload()),
    ]
    result = run(llm_complete([{"role": "user", "content": "hi"}]))
    assert result.text == '{"action": "none"}'
    assert len(FakeAsyncClient.seen_requests) == 2


def test_generation_400_twice_raises_generation_error_not_config():
    FakeAsyncClient.script = [
        FakeResponse(400, _GENERATION_400),
        FakeResponse(400, _GENERATION_400),
    ]
    with pytest.raises(LLMGenerationError):
        run(llm_complete([{"role": "user", "content": "hi"}]))
    # Bounded: one retry, then terminal.
    assert len(FakeAsyncClient.seen_requests) == 2


def test_double_400_with_effort_raises(monkeypatch):
    monkeypatch.setattr(config, "LLM_REASONING_EFFORT", "low")
    FakeAsyncClient.script = [FakeResponse(400), FakeResponse(400)]
    with pytest.raises(LLMConfigError):
        run(llm_complete([{"role": "user", "content": "hi"}]))
    # Bounded: the field is dropped once, the second 400 is terminal.
    assert len(FakeAsyncClient.seen_requests) == 2
    assert "reasoning_effort" not in FakeAsyncClient.seen_requests[1]["json"]


def _enable_fallback(monkeypatch):
    monkeypatch.setattr(config, "LLM_FALLBACK_BASE_URL", "https://fallback.test/v1")
    monkeypatch.setattr(config, "LLM_FALLBACK_API_KEY", "fallback-key")
    monkeypatch.setattr(config, "LLM_FALLBACK_MODEL", "fallback-model")
    monkeypatch.setattr(config, "LLM_FALLBACK_REASONING_EFFORT", "")


def test_fallback_recovers_primary_429(monkeypatch):
    _enable_fallback(monkeypatch)
    FakeAsyncClient.script = [FakeResponse(429), FakeResponse(200, _ok_payload())]
    result = run(llm_complete([{"role": "user", "content": "hi"}]))
    assert result.text == '{"action": "none"}'
    assert result.via_fallback is True
    assert FakeAsyncClient.seen_requests[0]["url"] == "https://llm.test/v1/chat/completions"
    assert FakeAsyncClient.seen_requests[1]["url"] == "https://fallback.test/v1/chat/completions"
    assert FakeAsyncClient.seen_requests[1]["json"]["model"] == "fallback-model"
    fallback_auth = FakeAsyncClient.seen_requests[1]["headers"]["Authorization"]
    # (Compared in parts: the fallback request must carry the fallback key
    # under the Bearer scheme.)
    scheme, _, token = fallback_auth.partition(" ")
    assert scheme == "Bearer"
    assert token == "fallback-key"


def test_fallback_recovers_primary_timeout(monkeypatch):
    _enable_fallback(monkeypatch)
    FakeAsyncClient.script = [
        httpx.TimeoutException("slow"),
        httpx.TimeoutException("slow"),
        FakeResponse(200, _ok_payload()),
    ]
    result = run(llm_complete([{"role": "user", "content": "hi"}]))
    assert result.via_fallback is True
    assert len(FakeAsyncClient.seen_requests) == 3


def test_fallback_recovers_double_generation_rejection(monkeypatch):
    _enable_fallback(monkeypatch)
    FakeAsyncClient.script = [
        FakeResponse(400, _GENERATION_400),
        FakeResponse(400, _GENERATION_400),
        FakeResponse(200, _ok_payload()),
    ]
    result = run(llm_complete([{"role": "user", "content": "hi"}]))
    assert result.via_fallback is True
    assert len(FakeAsyncClient.seen_requests) == 3


def test_fallback_also_failing_raises(monkeypatch):
    _enable_fallback(monkeypatch)
    FakeAsyncClient.script = [FakeResponse(429), FakeResponse(429)]
    with pytest.raises(LLMRateLimited):
        run(llm_complete([{"role": "user", "content": "hi"}]))
    assert len(FakeAsyncClient.seen_requests) == 2


def test_config_error_never_fails_over(monkeypatch):
    _enable_fallback(monkeypatch)
    FakeAsyncClient.script = [FakeResponse(400)]
    with pytest.raises(LLMConfigError):
        run(llm_complete([{"role": "user", "content": "hi"}]))
    assert len(FakeAsyncClient.seen_requests) == 1


def test_no_fallback_when_unconfigured():
    # The fixture leaves the fallback triple empty: one attempt, then raise.
    FakeAsyncClient.script = [FakeResponse(429)]
    with pytest.raises(LLMRateLimited):
        run(llm_complete([{"role": "user", "content": "hi"}]))
    assert len(FakeAsyncClient.seen_requests) == 1
