#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== zipper_tools Installer ==="

# -------------------------
# Prereqs
# -------------------------
need() { command -v "$1" >/dev/null || { echo "[!] Falta $1"; exit 1; }; }
need git

# -------------------------
# Verificar que src/ existe
# -------------------------
if [ ! -d "${SCRIPT_DIR}/src" ]; then
    echo "[!] No se encontró el directorio src/."
    echo "    Ejecuta install.sh desde dentro del repositorio clonado:"
    echo "      git clone git@github.com:da4nt3s5/zipper_tools.git"
    echo "      cd zipper_tools"
    echo "      ./install.sh"
    exit 1
fi

# -------------------------
# Python venv + dependencias
# -------------------------
VENV_DIR="${SCRIPT_DIR}/.venv"

if [ -d "$VENV_DIR" ]; then
    echo "[✓] Virtualenv ya existe en $VENV_DIR, omitiendo creación."
else
    echo
    echo "[*] Detectando versiones de Python instaladas..."

    PYTHON_CANDIDATES=()
    for cmd in python3 python3.10 python3.11 python3.12 python3.13; do
        if command -v "$cmd" >/dev/null 2>&1; then
            full_path="$(command -v "$cmd")"
            version="$("$full_path" -c 'import sys; print("{}.{}.{}".format(*sys.version_info[:3]))' 2>/dev/null)"
            real_path="$(realpath "$full_path" 2>/dev/null || echo "$full_path")"
            already=0
            for seen in "${PYTHON_CANDIDATES[@]+"${PYTHON_CANDIDATES[@]}"}"; do
                [[ "$seen" == "$real_path"* ]] && already=1 && break
            done
            [ "$already" -eq 0 ] && PYTHON_CANDIDATES+=("$real_path ($version)")
        fi
    done

    if [ ${#PYTHON_CANDIDATES[@]} -eq 0 ]; then
        echo "[!] No se encontró ningún intérprete Python. Instala Python 3.10 o superior."
        exit 1
    fi

    echo
    echo "    Versiones disponibles:"
    for i in "${!PYTHON_CANDIDATES[@]}"; do
        echo "      [$((i+1))] ${PYTHON_CANDIDATES[$i]}"
    done
    echo

    read -rp "    Selecciona el número de la versión a usar [1-${#PYTHON_CANDIDATES[@]}]: " sel
    if ! [[ "$sel" =~ ^[0-9]+$ ]] || [ "$sel" -lt 1 ] || [ "$sel" -gt ${#PYTHON_CANDIDATES[@]} ]; then
        echo "[!] Selección inválida."
        exit 1
    fi

    SELECTED="${PYTHON_CANDIDATES[$((sel-1))]}"
    PYTHON_BIN="${SELECTED%% *}"
    PY_VERSION="$("$PYTHON_BIN" -c 'import sys; print("{}.{}".format(*sys.version_info[:2]))')"
    PY_MAJOR="$("$PYTHON_BIN" -c 'import sys; print(sys.version_info[0])')"
    PY_MINOR="$("$PYTHON_BIN" -c 'import sys; print(sys.version_info[1])')"

    if [ "$PY_MAJOR" -lt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 10 ]; }; then
        echo
        echo "[!] Python $PY_VERSION es demasiado antiguo."
        echo "    zipper_tools requiere Python 3.10 o superior."
        echo "    Instala una versión más nueva e intenta de nuevo."
        exit 1
    fi

    echo
    echo "[*] Creando virtualenv con $PYTHON_BIN (Python $PY_VERSION)..."
    "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/pip" install --upgrade pip >/dev/null
"$VENV_DIR/bin/pip" install -r "${SCRIPT_DIR}/requirements.txt"

echo
echo "[✓] zipper_tools instalado correctamente"
echo "    Activa el entorno: source .venv/bin/activate"
echo "    Inicia el servidor: ./src/run_server.sh"
