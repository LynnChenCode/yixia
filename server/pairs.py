"""Chinese ↔ English OPUS-MT pairs only."""

from __future__ import annotations

PAIRS: dict[tuple[str, str], str] = {
    ("zh", "en"): "gaudi/opus-mt-zh-en-ctranslate2",
    ("en", "zh"): "gaudi/opus-mt-en-zh-ctranslate2",
}

# Traditional / Cantonese share the Simplified Chinese OPUS weights.
CANONICAL: dict[str, str] = {
    "zh": "zh",
    "zh-hans": "zh",
    "zh-hant": "zh",
    "zh-cn": "zh",
    "zh-tw": "zh",
    "yue": "zh",
    "en": "en",
}

UNSUPPORTED_HINT = "译匣目前只做中英互译。"


def canonical_lang(code: str) -> str:
    raw = code.strip().replace("_", "-")
    return CANONICAL.get(raw.lower(), raw.lower())


def repo_for(src: str, tgt: str) -> str:
    if (src, tgt) in PAIRS:
        return PAIRS[(src, tgt)]
    raise KeyError(UNSUPPORTED_HINT)


def hops(src: str, tgt: str) -> list[tuple[str, str]]:
    if src == tgt:
        return []
    if (src, tgt) in PAIRS:
        return [(src, tgt)]
    raise KeyError(UNSUPPORTED_HINT)
