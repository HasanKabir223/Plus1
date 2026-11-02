"""Swappable LLM wrapper over an OpenAI-compatible /chat/completions API.

Pointed at Groq's free tier by default (see backend/config.py), but every
setting -- base URL, key, model names -- comes from env vars, so the provider
can change without touching code. Uses plain async httpx, no SDK needed.

Never logs the API key or full prompts; only model, latency, token counts,
and outcome.
"""

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from backend import config

logger = logging.getLogger(__name__)


class LLMError(Exception):
    """Base class for all LLM wrapper failures."""


class LLMRateLimited(LLMError):
    """Provider said slow down (HTTP 429). Carries an optional retry hint."""

    def __init__(self, retry_after: int | None = None):
        self.retry_after = retry_after
        super().__init__("llm rate limited")


class LLMUnavailable(LLMError):
    """Provider timed out or returned 5xx after one retry."""


class LLMConfigError(LLMError):
    """Missing key / bad credentials / bad request. Message never holds the key."""


@dataclass
class LLMResult:
    text: str
    model: str
    tokens_in: int
    tokens_out: int
    latency_ms: int


def _model_for_tier(model_tier: str) -> str:
    # Tier names are ours; the actual model ids live in env vars.
    if model_tier == "smart":
        return config.LLM_MODEL_SMART
    return config.LLM_MODEL_FAST


def _extract_content(payload: dict[str, Any]) -> str:
    """Pull the final message content out of a chat-completions response.

    Reasoning-style models may add extra fields (reasoning_content, etc.);
    we read only choices[0].message.content and tolerate it being a list
    of content parts.
    """
    try:
        message = payload["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        return ""
    content = message.get("content", "")
    if isinstance(content, list):
        # Content parts: join the text parts, ignore the rest.
        chunks = [
            part.get("text", "")
            for part in content
            if isinstance(part, dict) and part.get("type") == "text"
        ]
        return "".join(chunks)
    return content if isinstance(content, str) else ""


def _usage(payload: dict[str, Any]) -> tuple[int, int]:
    usage = payload.get("usage") or {}
    try:
        return int(usage.get("prompt_tokens", 0)), int(usage.get("completion_tokens", 0))
    except (TypeError, ValueError):
        return 0, 0


def _retry_after_seconds(resp: httpx.Response) -> int | None:
    raw = resp.headers.get("retry-after") or resp.headers.get("retry-after-ms")
    if raw is None:
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    if "retry-after-ms" in {k.lower() for k in resp.headers.keys()}:
        value = value / 1000.0
    return max(1, int(value))


async def llm_complete(
    messages: list[dict[str, str]],
    *,
    model_tier: Literal["fast", "smart"] = "fast",
    max_tokens: int = 400,
    temperature: float = 0.8,
    json_mode: bool = True,
) -> LLMResult:
    """Call the chat-completions API once and return the result.

    Raises LLMRateLimited on 429, LLMUnavailable after one retry on
    timeouts/5xx, LLMConfigError on missing key / 401 / 400.
    """
    if not config.LLM_API_KEY:
        raise LLMConfigError("LLM_API_KEY is not configured")
    if not messages:
        raise LLMConfigError("llm_complete called with no messages")

    model = _model_for_tier(model_tier)
    url = f"{config.LLM_BASE_URL}/chat/completions"
    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if json_mode:
        # A hint, not a guarantee: callers must still parse defensively.
        body["response_format"] = {"type": "json_object"}

    headers = {
        "Authorization": f"Bearer {config.LLM_API_KEY}",
        "Content-Type": "application/json",
    }

    last_error: Exception | None = None
    for attempt in (1, 2):
        started = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=config.LLM_TIMEOUT_SECONDS) as client:
                resp = await client.post(url, headers=headers, json=body)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_error = exc
            logger.warning("llm attempt %d failed: %s", attempt, type(exc).__name__)
            if attempt == 1:
                await asyncio.sleep(1.0)
                continue
            raise LLMUnavailable(f"llm request failed: {type(exc).__name__}") from exc

        latency_ms = int((time.monotonic() - started) * 1000)

        if resp.status_code == 429:
            retry_after = _retry_after_seconds(resp)
            logger.warning(
                "llm rate limited model=%s latency_ms=%d retry_after=%s",
                model, latency_ms, retry_after,
            )
            raise LLMRateLimited(retry_after)

        if resp.status_code in (401, 403):
            # Auth problem, never retry, never echo the key.
            logger.error("llm auth failed model=%s status=%d", model, resp.status_code)
            raise LLMConfigError("LLM provider rejected the API key")

        if resp.status_code == 400:
            logger.error("llm bad request model=%s status=400", model)
            raise LLMConfigError("LLM provider rejected the request")

        if resp.status_code >= 500:
            last_error = LLMUnavailable(f"llm provider error {resp.status_code}")
            logger.warning(
                "llm attempt %d server error model=%s status=%d",
                attempt, model, resp.status_code,
            )
            if attempt == 1:
                await asyncio.sleep(1.0)
                continue
            raise last_error

        if resp.status_code != 200:
            logger.error("llm unexpected status model=%s status=%d", model, resp.status_code)
            raise LLMUnavailable(f"llm provider error {resp.status_code}")

        try:
            payload = resp.json()
        except ValueError as exc:
            raise LLMUnavailable("llm returned invalid JSON") from exc

        text = _extract_content(payload)
        tokens_in, tokens_out = _usage(payload)
        logger.info(
            "llm ok model=%s latency_ms=%d tokens_in=%d tokens_out=%d",
            model, latency_ms, tokens_in, tokens_out,
        )
        return LLMResult(
            text=text,
            model=payload.get("model", model),
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=latency_ms,
        )

    # Unreachable in practice; keeps the type checker honest.
    raise LLMUnavailable(f"llm request failed: {last_error}")
