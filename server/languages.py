from __future__ import annotations

NAME_TO_CODE: dict[str, str] = {
    "chinese": "zh",
    "simplified chinese": "zh",
    "traditional chinese": "zh",
    "chinese (simplified)": "zh",
    "chinese (traditional)": "zh",
    "zh-cn": "zh",
    "zh-tw": "zh",
    "zh": "zh",
    "中文": "zh",
    "汉语": "zh",
    "简体中文": "zh",
    "繁体中文": "zh",
    "简体": "zh",
    "繁体": "zh",
    "粤语": "zh",
    "english": "en",
    "en": "en",
    "英语": "en",
    "英文": "en",
    "japanese": "ja",
    "日语": "ja",
    "日文": "ja",
    "korean": "ko",
    "韩语": "ko",
    "french": "fr",
    "法语": "fr",
    "german": "de",
    "德语": "de",
    "spanish": "es",
    "西班牙语": "es",
}


def detect_language(text: str) -> str:
    sample = text.strip()[:800]
    if not sample:
        return "en"
    han = sum(1 for ch in sample if "\u4e00" <= ch <= "\u9fff")
    if han >= max(3, len(sample) * 0.08):
        return "zh"
    return "en"


def name_to_code(name: str) -> str | None:
    raw = name.strip().lower().replace("_", "-")
    raw = re_sub_lang_noise(raw)
    if raw in NAME_TO_CODE:
        return NAME_TO_CODE[raw]
    cleaned = raw.replace("语", "")
    return NAME_TO_CODE.get(cleaned)


def re_sub_lang_noise(value: str) -> str:
    value = value.strip().strip("「」\"'[]【】")
    # Immersive sometimes appends tone hints: "简体中文（正式）"
    for sep in ("（", "(", " -", " —", "|"):
        if sep in value:
            value = value.split(sep, 1)[0].strip()
    return value
