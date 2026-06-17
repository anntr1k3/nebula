"""Вызов внешнего LLM API для редактирования текста сообщений."""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any

from schemas.ai import AI_ACTIONS

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "Ты помощник по редактированию коротких сообщений в мессенджере. "
    "Верни только итоговый текст сообщения: без кавычек, пояснений, markdown и префиксов. "
    "Сохраняй язык исходника (русский остаётся русским, английский — английским)."
)

ACTION_INSTRUCTIONS: dict[str, str] = {
    "improve": "Сделай формулировку яснее и естественнее, сохрани смысл и тон.",
    "shorten": "Сократи текст, оставив главный смысл.",
    "expand": "Немного разверни мысль, добавь вежливость, не раздувай без нужды.",
    "formal": "Сделай тон более формальным и деловым.",
    "friendly": "Сделай тон более дружелюбным и тёплым.",
    "grammar": "Исправь орфографию, пунктуацию и грамматику.",
}


class AiServiceError(Exception):
    def __init__(self, message: str, *, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


class AiNotConfiguredError(AiServiceError):
    def __init__(self):
        super().__init__(
            "AI assistant is not configured on the server",
            status=503,
        )


def _chat_completions_url(api_base: str) -> str:
    base = (api_base or "https://api.openai.com/v1").rstrip("/")
    return f"{base}/chat/completions"


def rewrite_message_text(
    *,
    text: str,
    action: str,
    enabled: bool,
    api_key: str | None,
    api_base: str,
    model: str,
    timeout_sec: float = 45.0,
) -> str:
    if action not in AI_ACTIONS:
        raise AiServiceError("Unknown AI action")

    if not enabled:
        raise AiNotConfiguredError()

    key = (api_key or "").strip()
    if not key:
        raise AiNotConfiguredError()

    instruction = ACTION_INSTRUCTIONS[action]
    payload: dict[str, Any] = {
        "model": model or "gpt-4o-mini",
        "temperature": 0.4,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"{instruction}\n\nИсходный текст:\n{text}",
            },
        ],
    }

    req = urllib.request.Request(
        _chat_completions_url(api_base),
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
            detail = json.loads(body)
            msg = (
                detail.get("error", {}).get("message")
                if isinstance(detail.get("error"), dict)
                else detail.get("message")
            )
            if msg:
                logger.warning("AI API HTTP %s: %s", e.code, msg)
                raise AiServiceError("AI service error", status=502) from e
        except (json.JSONDecodeError, AttributeError):
            pass
        logger.warning("AI API HTTP %s: %s", e.code, body[:200])
        raise AiServiceError("AI service error", status=502) from e
    except urllib.error.URLError as e:
        logger.warning("AI API network error: %s", e)
        raise AiServiceError("AI service unavailable", status=503) from e
    except TimeoutError as e:
        logger.warning("AI API timeout")
        raise AiServiceError("AI service timeout", status=504) from e

    choices = raw.get("choices") or []
    if not choices:
        raise AiServiceError("Empty AI response", status=502)

    content = (choices[0].get("message") or {}).get("content") or ""
    result = content.strip()
    if not result:
        raise AiServiceError("Empty AI response", status=502)

    if len(result) > 10000:
        result = result[:10000]

    return result
