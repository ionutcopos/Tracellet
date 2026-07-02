#!/usr/bin/env bash
# Start both Tracellet servers with Bun on PATH. Ctrl-C stops both.
set -euo pipefail

export PATH="$HOME/.bun/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun not found on PATH (looked in ~/.bun/bin). Install: https://bun.sh" >&2
  exit 1
fi

echo "· installing deps (if needed)…"
(cd "$ROOT/server" && bun install >/dev/null 2>&1)
(cd "$ROOT/web"    && bun install >/dev/null 2>&1)

echo "· starting API on http://localhost:3000"
(cd "$ROOT/server" && bun run src/index.ts) &
SERVER_PID=$!

echo "· starting web on http://localhost:5173"
(cd "$ROOT/web" && bun run dev) &
WEB_PID=$!

# Stop both children on exit.
trap 'kill $SERVER_PID $WEB_PID 2>/dev/null || true' EXIT INT TERM
echo "· both up — Ctrl-C to stop"
wait
