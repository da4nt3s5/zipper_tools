#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== zipper_tools Installer ==="

# -------------------------
# Prereqs
# -------------------------
need() { command -v "$1" >/dev/null || { echo "[!] Falta $1"; exit 1; }; }
need python3
need pip3
need git

# -------------------------
# Runtime directories
# -------------------------
mkdir -p "${SCRIPT_DIR}/src/tools_storage"
mkdir -p "${SCRIPT_DIR}/src/tools_runtime/work"
mkdir -p "${SCRIPT_DIR}/src/logs"

# -------------------------
# Python venv + dependencias
# -------------------------
python3 -m venv "${SCRIPT_DIR}/src/.venv"
"${SCRIPT_DIR}/src/.venv/bin/pip" install --upgrade pip >/dev/null
"${SCRIPT_DIR}/src/.venv/bin/pip" install -r "${SCRIPT_DIR}/requirements.txt"

echo
echo "[✓] zipper_tools instalado correctamente"
echo "    ./src/run_server.sh"
