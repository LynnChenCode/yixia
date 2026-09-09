#!/usr/bin/env bash
set -euo pipefail

ROOT="${LLAMA_HOME:-/tmp/llama}"
MODEL="${HYMT_MODEL:-/tmp/models/Hy-MT2-1.8B-Q4_K_M.gguf}"
PORT="${LLAMA_PORT:-18791}"
TAG="${LLAMA_TAG:-b10679}"

mkdir -p "$ROOT" /tmp/models

if [[ ! -x "$ROOT/llama-b10679/llama-server" && ! -x "$ROOT/llama-server" ]]; then
  echo "Downloading llama.cpp $TAG (ubuntu-x64)..."
  curl -L --fail --retry 3 -o /tmp/llama.tar.gz \
    "https://github.com/ggml-org/llama.cpp/releases/download/${TAG}/llama-${TAG}-bin-ubuntu-x64.tar.gz"
  tar -xzf /tmp/llama.tar.gz -C "$ROOT"
fi

if [[ ! -f "$MODEL" ]]; then
  echo "Downloading Hy-MT2-1.8B Q4_K_M (~1.13 GB)..."
  curl -L --fail --retry 3 -o "$MODEL" \
    "https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/main/Hy-MT2-1.8B-Q4_K_M.gguf"
fi

SERVER="$(find "$ROOT" -name llama-server -type f | head -n 1)"
LIBDIR="$(dirname "$SERVER")"
export LD_LIBRARY_PATH="$LIBDIR:${LD_LIBRARY_PATH:-}"

echo "Hy-MT2 listening on http://127.0.0.1:${PORT}"
exec "$SERVER" \
  --model "$MODEL" \
  --host 127.0.0.1 \
  --port "$PORT" \
  --jinja \
  -ngl 0 \
  -c 2048 \
  --parallel 1 \
  -t "${LLAMA_THREADS:-4}" \
  --temp 0.7 \
  --top-p 0.6 \
  --top-k 20 \
  --repeat-penalty 1.05 \
  --alias Hy-MT2-1.8B
