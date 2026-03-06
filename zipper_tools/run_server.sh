#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
"$SCRIPT_DIR/.venv/bin/python3" -m uvicorn server.app:app --host 0.0.0.0 --port 3030
