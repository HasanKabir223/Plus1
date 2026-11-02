"""Tests for the LLM wrapper (backend/llm.py). No network: httpx is faked."""

import httpx
import pytest

from backend import config, llm
from backend.tests.helpers import run
from backend.llm import (
    LLMConfigError,
    LLMRateLimited,
    LLMUnavailable,
    llm_complete,
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
        FakeAsyncClient.seen_requests.append({"url": url, "headers": headers, "json": json})
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
    monkeypatch.setattr(config, "LLM_MODEL_FAST", "fast-model")
    # No real sleeping in retries.
    async def _no_sleep(_):
        return None
    monkeypatch.setattr(llm.asyncio, "sleep", _no_sleep)
    return FakeAsyncClient


def _ok_payload(text='{"action": "none"}'):
    return {
        "model": "fast-model",
        "choices": [{"message": {"content": text}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
    }


def test_success_extracts_content_and_usage():
    FakeAsyncClient.script = [FakeResponse(200, _ok_payload())]
    result = run(llm_complete([{"role": "user", "content": "hi"}]))
    assert result.text == '{"action": "none"}'
    assert (result.tokens_in, result.tokens_out) == (10, 5)
    assert result.model == "fast-model"
    assert result.latency_ms >= 0


def test_request_shape_and_json_mode():
    FakeAsyncClient.script = [FakeResponse(200, _ok_payload())]
    run(llm_complete([{"role": "user", "content": "hi"}], max_tokens=50, temperature=0.1))
    req = FakeAsyncClient.seen_requests[0]
    assert req["url"] == "https://llm.test/v1/chat/completions"
    assert req["json"]["model"] == "fast-model"
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
