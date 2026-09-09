#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_DIR="${YIXIA_MODEL_DIR:-$ROOT/models/opus}"
PORT="${YIXIA_PORT:-18790}"
VENV="${YIXIA_VENV:-$ROOT/.venv}"

export OMP_NUM_THREADS="${YIXIA_THREADS:-1}"
export MKL_NUM_THREADS="${YIXIA_THREADS:-1}"
export OPENBLAS_NUM_THREADS="${YIXIA_THREADS:-1}"
export YIXIA_THREADS="${YIXIA_THREADS:-1}"

if [[ ! -x "$VENV/bin/python" ]]; then
  python3 -m venv "$VENV"
fi
"$VENV/bin/pip" install -q -r "$ROOT/server/requirements.txt"

"$VENV/bin/python" - <<PY
from pathlib import Path
from huggingface_hub import snapshot_download

root = Path("$MODEL_DIR")
pairs = {
    "opus-mt-zh-en-ctranslate2": "gaudi/opus-mt-zh-en-ctranslate2",
    "opus-mt-en-zh-ctranslate2": "gaudi/opus-mt-en-zh-ctranslate2",
}
patterns = ["model.bin", "config.json", "source.spm", "target.spm", "shared_vocabulary.json"]
for name, repo in pairs.items():
    dest = root / name
    if (dest / "model.bin").exists():
        continue
    print(f"Downloading {repo} (~155 MB)...")
    dest.mkdir(parents=True, exist_ok=True)
    snapshot_download(repo_id=repo, local_dir=str(dest), allow_patterns=patterns)
PY

export YIXIA_MODEL_DIR="$MODEL_DIR"
export YIXIA_PORT="$PORT"
echo "译匣 API  http://127.0.0.1:${PORT}/v1"
cd "$ROOT/server"
exec "$VENV/bin/python" -m uvicorn app:app --host 127.0.0.1 --port "$PORT" --workers 1
