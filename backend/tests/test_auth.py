"""Tests for token verification (backend/auth.py). No network: httpx is faked."""

import httpx
import pytest

from backend import auth, config
from backend.auth import AuthError, verify_access_token
from backend.tests.helpers import run


class FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class FakeAsyncClient:
    next_response = None
    next_error = None
    seen: list = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, url, headers=None):
        FakeAsyncClient.seen.append({"url": url, "headers": headers})
        if FakeAsyncClient.next_error is not None:
            raise FakeAsyncClient.next_error
        return FakeAsyncClient.next_response


@pytest.fixture(autouse=True)
def _fake_http(monkeypatch):
    FakeAsyncClient.next_response = None
    FakeAsyncClient.next_error = None
    FakeAsyncClient.seen = []
    monkeypatch.setattr(auth.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(config, "SUPABASE_URL", "https://proj.supabase.co")
    monkeypatch.setattr(config, "SUPABASE_ANON_KEY", "anon-key")


def test_valid_token_returns_user_id():
    FakeAsyncClient.next_response = FakeResponse(200, {"id": "user-1"})
    assert run(verify_access_token("tok")) == "user-1"
    req = FakeAsyncClient.seen[0]
    assert req["url"] == "https://proj.supabase.co/auth/v1/user"
    assert req["headers"]["Authorization"] == "Bearer tok"
    assert req["headers"]["apikey"] == "anon-key"


def test_missing_token_rejected():
    with pytest.raises(AuthError):
        run(verify_access_token(None))
    with pytest.raises(AuthError):
        run(verify_access_token(""))


def test_401_from_auth_rejected():
    FakeAsyncClient.next_response = FakeResponse(401, {"msg": "bad"})
    with pytest.raises(AuthError):
        run(verify_access_token("bad"))


def test_network_error_rejected():
    FakeAsyncClient.next_error = httpx.ConnectError("down")
    with pytest.raises(AuthError):
        run(verify_access_token("tok"))


def test_response_without_id_rejected():
    FakeAsyncClient.next_response = FakeResponse(200, {"nope": True})
    with pytest.raises(AuthError):
        run(verify_access_token("tok"))
