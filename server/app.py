from __future__ import annotations

import json
import os
import re
import time
import uuid
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from engine import loaded_pair, ready, rss_mb, translate_text
from languages import detect_language, name_to_code
from pairs import canonical_lang

APP_PORT = int(os.environ.get("YIXIA_PORT", "18790"))
MODEL_NAME = "yixia"

app = FastAPI(title="译匣", version="0.4.1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class GlossaryEntry(BaseModel):
    source: str = ""
    target: str = ""


class TranslateBody(BaseModel):
    text: str
    sourceLang: str = "auto"
    targetLang: str = "zh"
    glossary: list[GlossaryEntry] = Field(default_factory=list)
    style: str = ""


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    role: str = "user"
    content: Any = ""


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    model: str | None = None
    messages: list[ChatMessage] = Field(default_factory=list)
    stream: bool = False
    temperature: float | None = None
    target_lang: str | None = None
    source_lang: str | None = None


PROMPT_PATTERNS = [
    re.compile(
        r"(?:将以下(?:文本|内容)?(?:翻译为|译为|译成)|翻译为|译为|译成|"
        r"Translate(?: the following(?: text|content)?)? into|"
        r"Please translate(?: the following(?: text)?)? into|"
        r"Translate into)\s*[「\"'【\[]?([^\n:：\]】]+)[」\"'】\]]?\s*[:：]?\s*(.*)",
        re.S | re.I,
    ),
]


def message_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                if isinstance(item.get("text"), str):
                    parts.append(item["text"])
                elif isinstance(item.get("content"), str):
                    parts.append(item["content"])
        return "\n".join(parts)
    return str(content)


def parse_plugin_prompt(content: str) -> tuple[str, str | None]:
    text = content.strip()
    if not text:
        return "", None
    for pattern in PROMPT_PATTERNS:
        match = pattern.search(text)
        if match:
            lang_hint = match.group(1).strip().rstrip("。.,， ")
            rest = match.group(2).strip()
            code = name_to_code(lang_hint) or name_to_code(lang_hint.replace("语", ""))
            if rest:
                return rest, code
            # Prompt like "Translate into Chinese" with body after blank line
            after = text[match.end() :].strip()
            if after:
                return after, code
            return text, code
    return text, None


def coerce_zh_en(target: str | None, source_text: str) -> str:
    """Only zh/en are supported; remap other plugin targets sensibly."""
    detected = detect_language(source_text)
    if not target:
        return "en" if detected == "zh" else "zh"
    code = canonical_lang(target)
    if code in ("zh", "en"):
        # Same-language request: flip so the plugin still gets a translation.
        if code == detected:
            return "en" if detected == "zh" else "zh"
        return code
    # e.g. plugin asked for Japanese — fall back to the other of zh/en
    return "en" if detected == "zh" else "zh"


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    print(f"[yixia] 422 {request.url.path}: {exc.errors()}")
    return JSONResponse(status_code=400, content={"detail": "请求格式不被支持。", "errors": exc.errors()})


@app.get("/health")
def health() -> dict[str, Any]:
    memory = rss_mb()
    if not ready():
        return {
            "status": "loading",
            "ok": False,
            "model": MODEL_NAME,
            "rss_mb": memory,
        }
    return {
        "status": "ok",
        "ok": True,
        "model": "OPUS-MT 中英",
        "engine": "opus-mt",
        "loaded": loaded_pair(),
        "rss_mb": memory,
        "api": f"http://127.0.0.1:{APP_PORT}/v1",
    }


@app.get("/v1/models")
def list_models() -> dict[str, Any]:
    return {
        "object": "list",
        "data": [
            {"id": MODEL_NAME, "object": "model", "owned_by": "local"},
            {"id": "gpt-4o-mini", "object": "model", "owned_by": "local"},
            {"id": "gpt-3.5-turbo", "object": "model", "owned_by": "local"},
        ],
    }


@app.post("/translate")
def translate(body: TranslateBody) -> dict[str, Any]:
    try:
        text, detected, target = translate_text(
            body.text,
            body.sourceLang,
            body.targetLang,
            [entry.model_dump() for entry in body.glossary],
        )
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=exc.args[0] if exc.args else str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"text": text, "sourceLang": detected, "targetLang": target, "model": MODEL_NAME}


@app.post("/v1/chat/completions")
def chat_completions(body: ChatRequest) -> Any:
    user_text = ""
    hinted_target: str | None = body.target_lang
    for message in body.messages:
        raw = message_text(message.content)
        parsed_text, hinted = parse_plugin_prompt(raw)
        if hinted:
            hinted_target = hinted
        if message.role == "user" and raw.strip():
            user_text = parsed_text if hinted else raw
        elif not user_text and raw.strip() and message.role in ("user", "system", "assistant"):
            # Some plugins put the whole prompt in system.
            user_text = parsed_text if hinted else raw

    user_text = user_text.strip()
    if not user_text:
        # Immersive Translate may probe with empty / keepalive bodies.
        print("[yixia] 400 empty messages")
        raise HTTPException(status_code=400, detail="messages 里没有用户文本。")

    target = coerce_zh_en(hinted_target, user_text)
    source = body.source_lang or "auto"
    try:
        text, detected, target = translate_text(user_text, source, target)
    except KeyError as exc:
        # Last resort: force zh↔en by detection.
        detected = detect_language(user_text)
        fallback = "en" if detected == "zh" else "zh"
        print(f"[yixia] remap unsupported target -> {fallback}: {exc}")
        try:
            text, detected, target = translate_text(user_text, "auto", fallback)
        except Exception as inner:
            print(f"[yixia] 400 translate failed: {inner}")
            raise HTTPException(status_code=400, detail=str(inner)) from inner
    except Exception as exc:
        print(f"[yixia] 400 translate failed: {exc}")
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    payload = {
        "id": f"chatcmpl-{uuid.uuid4().hex}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": body.model or MODEL_NAME,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }
    if body.stream:

        def events():
            chunk = {
                "id": payload["id"],
                "object": "chat.completion.chunk",
                "created": payload["created"],
                "model": payload["model"],
                "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": None}],
            }
            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            done = {
                "id": payload["id"],
                "object": "chat.completion.chunk",
                "created": payload["created"],
                "model": payload["model"],
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            }
            yield f"data: {json.dumps(done)}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(events(), media_type="text/event-stream")
    return payload
