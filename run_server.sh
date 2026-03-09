#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/zipper_tools"
python3 -m uvicorn server.app:app --host 0.0.0.0 --port 3030
