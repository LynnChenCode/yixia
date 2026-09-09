from __future__ import annotations

import ctypes
import gc
import os
import re
import threading
from pathlib import Path

import ctranslate2
import sentencepiece as spm
from huggingface_hub import snapshot_download

from languages import detect_language
from pairs import canonical_lang, hops, repo_for

MODEL_ROOT = Path(os.environ.get("YIXIA_MODEL_DIR", "/tmp/models/opus"))
INTER_THREADS = int(os.environ.get("YIXIA_THREADS", "1"))
COMPUTE_TYPE = os.environ.get("YIXIA_COMPUTE_TYPE", "int8")
MAX_CHARS = 6000

_lock = threading.Lock()
_loaded_key: str | None = None
_translator: ctranslate2.Translator | None = None
_src_sp: spm.SentencePieceProcessor | None = None
_tgt_sp: spm.SentencePieceProcessor | None = None


def rss_mb() -> int | None:
    try:
        with open("/proc/self/status", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) // 1024
    except OSError:
        pass
    try:
        import ctypes
        from ctypes import wintypes

        class PROCESS_MEMORY_COUNTERS_EX(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
                ("PrivateUsage", ctypes.c_size_t),
            ]

        GetCurrentProcess = ctypes.windll.kernel32.GetCurrentProcess
        GetProcessMemoryInfo = ctypes.windll.psapi.GetProcessMemoryInfo
        counters = PROCESS_MEMORY_COUNTERS_EX()
        counters.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS_EX)
        if GetProcessMemoryInfo(GetCurrentProcess(), ctypes.byref(counters), counters.cb):
            return int(counters.WorkingSetSize // (1024 * 1024))
    except Exception:
        return None
    return None


def _pair_dir(src: str, tgt: str) -> Path:
    repo = repo_for(src, tgt)
    return MODEL_ROOT / repo.split("/")[-1]


def _pair_complete(dest: Path) -> bool:
    required = ("model.bin", "config.json", "source.spm", "target.spm", "shared_vocabulary.json")
    return all((dest / name).exists() for name in required)


def ensure_pair(src: str, tgt: str) -> Path:
    dest = _pair_dir(src, tgt)
    if _pair_complete(dest):
        return dest
    dest.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=repo_for(src, tgt),
        local_dir=str(dest),
        allow_patterns=[
            "model.bin",
            "config.json",
            "source.spm",
            "target.spm",
            "shared_vocabulary.json",
        ],
    )
    if not _pair_complete(dest):
        missing = [
            name
            for name in (
                "model.bin",
                "config.json",
                "source.spm",
                "target.spm",
                "shared_vocabulary.json",
            )
            if not (dest / name).exists()
        ]
        raise FileNotFoundError(f"{repo_for(src, tgt)} 缺少文件：{', '.join(missing)}")
    return dest


def ready() -> bool:
    return _pair_complete(_pair_dir("zh", "en")) or _pair_complete(_pair_dir("en", "zh"))


def loaded_pair() -> str | None:
    return _loaded_key


def _malloc_trim() -> None:
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:
        pass


def _unload() -> None:
    global _translator, _src_sp, _tgt_sp, _loaded_key
    _translator = None
    _src_sp = None
    _tgt_sp = None
    _loaded_key = None
    gc.collect()
    _malloc_trim()


def _load(src: str, tgt: str) -> tuple[ctranslate2.Translator, spm.SentencePieceProcessor, spm.SentencePieceProcessor]:
    global _translator, _src_sp, _tgt_sp, _loaded_key
    key = f"{src}-{tgt}:{repo_for(src, tgt)}"
    if _translator is not None and _src_sp and _tgt_sp and _loaded_key == key:
        return _translator, _src_sp, _tgt_sp
    _unload()
    path = ensure_pair(src, tgt)
    src_sp = spm.SentencePieceProcessor()
    tgt_sp = spm.SentencePieceProcessor()
    src_sp.load(str(path / "source.spm"))
    tgt_file = path / "target.spm"
    tgt_sp.load(str(tgt_file if tgt_file.exists() else path / "source.spm"))
    translator = ctranslate2.Translator(
        str(path),
        device="cpu",
        compute_type=COMPUTE_TYPE,
        inter_threads=INTER_THREADS,
        intra_threads=1,
    )
    _translator = translator
    _src_sp = src_sp
    _tgt_sp = tgt_sp
    _loaded_key = key
    return translator, src_sp, tgt_sp


def split_chunks(text: str) -> list[str]:
    text = text.strip()
    if len(text) <= 900:
        return [text]
    chunks: list[str] = []
    buf: list[str] = []
    size = 0
    for paragraph in text.split("\n"):
        piece = paragraph if paragraph else " "
        if size + len(piece) > 900 and buf:
            chunks.append("\n".join(buf).strip())
            buf = [paragraph]
            size = len(paragraph)
        else:
            buf.append(paragraph)
            size += len(piece)
    if buf:
        chunks.append("\n".join(buf).strip())
    return [chunk for chunk in chunks if chunk] or [text[:900]]


def apply_glossary(text: str, glossary: list[dict[str, str]] | None) -> str:
    result = text
    for entry in glossary or []:
        source = (entry.get("source") or "").strip()
        target = (entry.get("target") or "").strip()
        if source and target:
            result = result.replace(source, target)
    return result


def _encode(sp: spm.SentencePieceProcessor, text: str) -> list[str]:
    tokens = sp.encode(text, out_type=str)
    if not tokens or tokens[-1] != "</s>":
        tokens.append("</s>")
    return tokens


def _decode(sp: spm.SentencePieceProcessor, tokens: list[str]) -> str:
    cleaned = [tok for tok in tokens if tok not in ("</s>", "<unk>", "<pad>", "<s>")]
    return sp.decode(cleaned).strip()


def _collapse_repetition(text: str) -> str:
    """OPUS-MT sometimes loops on short inputs (e.g. decision -> 决定 决 决 决...)."""
    if not text or len(text) < 4:
        return text
    parts = text.split()
    # "决定 决 定" — model re-emits the word as spaced characters.
    if (
        len(parts) >= 2
        and len(parts[0]) >= 2
        and all(len(p) == 1 for p in parts[1:])
        and "".join(parts[1:]).startswith(parts[0][:1])
        and parts[0].startswith("".join(parts[1:])[:1])
    ):
        glued = "".join(parts[1:])
        if glued == parts[0] or parts[0].startswith(glued) or glued.startswith(parts[0]):
            return parts[0]
    # Collapse runs of the same whitespace-separated token: "决 决 决" -> "决"
    if len(parts) >= 3:
        collapsed: list[str] = []
        i = 0
        while i < len(parts):
            j = i + 1
            while j < len(parts) and parts[j] == parts[i]:
                j += 1
            if j - i >= 3:
                collapsed.append(parts[i])
            else:
                collapsed.extend(parts[i:j])
            i = j
        text = " ".join(collapsed)
    # Collapse long same-char runs without spaces: "决决决决" -> "决"
    out: list[str] = []
    i = 0
    while i < len(text):
        j = i + 1
        while j < len(text) and text[j] == text[i]:
            j += 1
        run = j - i
        if run >= 4 and "\u4e00" <= text[i] <= "\u9fff":
            out.append(text[i])
        else:
            out.append(text[i:j])
        i = j
    text = "".join(out).strip()
    # Collapse immediate duplicate words: "苹果苹果" -> "苹果"
    text = re.sub(r"([\u4e00-\u9fff]{2,4})\1+", r"\1", text)
    # Trim leftover "决定 决" / "决定决" after the loop was mostly collapsed.
    parts = text.split()
    if (
        len(parts) >= 2
        and len(parts[-1]) == 1
        and len(parts[-2]) >= 2
        and parts[-1] in parts[-2]
    ):
        text = " ".join(parts[:-1])
    # "决定决" / "苹果果" — trailing char echoes one inside the stem.
    while len(text) >= 3 and "\u4e00" <= text[-1] <= "\u9fff":
        if text[-1] == text[-3] and "\u4e00" <= text[-3] <= "\u9fff":
            text = text[:-1]
            continue
        stem = text[:-1].rstrip()
        if len(stem) >= 2 and text[-1] in stem and not text[-1].isspace():
            # Only strip when the leftover is a single echoed character, not a new word.
            if len(text) - len(stem) <= 1:
                text = stem
                continue
        break
    return text.strip()


def _run_pair(text: str, src: str, tgt: str) -> str:
    with _lock:
        translator, src_sp, tgt_sp = _load(src, tgt)
        outputs: list[str] = []
        for chunk in split_chunks(text):
            source_tokens = _encode(src_sp, chunk)
            # Cap output length to ~2x source (+margin). A fixed 512 lets short
            # words spiral into token-repetition loops.
            max_len = min(512, max(16, len(source_tokens) * 2 + 8))
            result = translator.translate_batch(
                [source_tokens],
                beam_size=2,
                max_decoding_length=max_len,
                repetition_penalty=1.2,
                no_repeat_ngram_size=3,
            )
            outputs.append(_collapse_repetition(_decode(tgt_sp, result[0].hypotheses[0])))
        return "\n".join(outputs)


def translate_text(
    text: str,
    source_lang: str = "auto",
    target_lang: str = "en",
    glossary: list[dict[str, str]] | None = None,
) -> tuple[str, str, str]:
    cleaned = text.strip()
    if not cleaned:
        raise ValueError("请先输入要翻译的文本。")
    if len(cleaned) > MAX_CHARS:
        raise ValueError(f"单次最多 {MAX_CHARS} 字，请分段翻译。")

    detected = detect_language(cleaned) if source_lang in ("", "auto") else source_lang
    src = canonical_lang(detected)
    tgt = canonical_lang(target_lang)
    if src == tgt:
        return apply_glossary(cleaned, glossary), detected, target_lang

    current = cleaned
    for hop_src, hop_tgt in hops(src, tgt):
        current = _run_pair(current, hop_src, hop_tgt)
    return apply_glossary(current, glossary), detected, target_lang
