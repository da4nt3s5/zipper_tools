#!/usr/bin/env python3
"""
zipper_tools - add tool CLI
"""
import os
import sys
import subprocess
import uuid
import shutil
import yaml
import argparse

# =================================================
# Paths correctos para ejecución directa
# =================================================
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS_DIR = os.path.join(BASE_DIR, "tools_storage")

if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from server.registry import load_tools, save_tools  # noqa: E402

# =================================================
# Helpers
# =================================================
def run(cmd, cwd=None):
    p = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)
    return p.returncode, p.stdout.strip(), p.stderr.strip()

# =================================================
# Wizard interactivo
# =================================================
def interactive_manifest(repo_path: str) -> dict:
    print("\n[!] No se encontró zipper_tools.yaml")
    print("[*] Creando manifiesto interactivo...\n")

    # ---------- tipo de entrada ----------
    kind_map = {"1": "file", "2": "url", "3": "both"}
    print("¿Qué tipo de entrada maneja la herramienta?")
    print("  1) archivo")
    print("  2) url")
    print("  3) ambos")
    kind = kind_map.get(input("> ").strip(), "file")

    # ---------- runtime ----------
    print("\nRuntime:")
    print("  1) python")
    print("  2) docker")
    print("  3) binario")
    print("  4) go")
    rt = input("> ").strip()
    runtime = {"type": "python"}
    if rt == "2":
        runtime = {"type": "docker"}
    elif rt == "3":
        runtime = {"type": "binary"}
    elif rt == "4":
        runtime = {"type": "go"}

    # ---------- comando ----------
    print("\nComando de ejecución")
    print("Usa placeholders: {file} {url} {outdir}")
    cmd = input("> ").strip()

    # ---------- manifiesto ----------
    manifest = {
        "accepts": {
            "kind": kind
        },
        "entrypoint": {
            "cmd": cmd
        },
        "runtime": runtime
    }

    path = os.path.join(repo_path, "zipper_tools.yaml")
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(manifest, f, sort_keys=False)
    print(f"\n[✓] zipper.yaml creado en {path}\n")
    return manifest

# =================================================
# Core: agregar herramienta
# =================================================
def add_tool(repo_url: str, manifest_override: dict = None) -> dict:
    # 1) verificar repo
    code, _, err = run(["git", "ls-remote", repo_url])
    if code != 0:
        raise RuntimeError(f"Repo no accesible: {err}")

    tool_id = str(uuid.uuid4())[:8]
    tool_base = os.path.join(TOOLS_DIR, tool_id)
    repo_path = os.path.join(tool_base, "repo")
    os.makedirs(tool_base, exist_ok=True)

    # 2) clonar
    code, _, err = run(["git", "clone", "--depth", "1", repo_url, repo_path])
    if code != 0:
        shutil.rmtree(tool_base, ignore_errors=True)
        raise RuntimeError(f"Error clonando repo: {err}")

    # 3) leer manifiesto
    manifest_path = os.path.join(repo_path, "zipper_tools.yaml")
    if manifest_override:
        manifest = manifest_override
        with open(manifest_path, "w", encoding="utf-8") as f:
            yaml.dump(manifest, f, sort_keys=False)
    elif os.path.exists(manifest_path):
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = yaml.safe_load(f)
    else:
        shutil.rmtree(tool_base, ignore_errors=True)
        raise RuntimeError("NEEDS_MANIFEST")

    # 4) registrar
    tools = load_tools()
    tools[tool_id] = {
        "id": tool_id,
        "repo": repo_url,
        "accepts": manifest["accepts"],
        "entrypoint": manifest["entrypoint"],
        "runtime": manifest["runtime"],
        "path": tool_base,
    }
    save_tools(tools)
    return tools[tool_id]

# =================================================
# CLI
# =================================================
def main():
    parser = argparse.ArgumentParser(description="Agregar herramienta a central_tools")
    parser.add_argument("repo_url", nargs="?", help="URL del repositorio GitHub")
    args = parser.parse_args()

    repo_url = args.repo_url or input("Ingrese la URL del repositorio GitHub: ").strip()
    if not repo_url:
        print("[✗] No se ingresó ninguna URL", file=sys.stderr)
        sys.exit(1)

    try:
        tool = add_tool(repo_url)
    except RuntimeError as e:
        if "NEEDS_MANIFEST" in str(e):
            # No zipper_tools.yaml — run interactive wizard
            tool_base_guess = os.path.join(TOOLS_DIR, "tmp_wizard")
            repo_path_guess = os.path.join(tool_base_guess, "repo")
            # Re-clone so wizard has the repo path
            os.makedirs(tool_base_guess, exist_ok=True)
            run(["git", "clone", "--depth", "1", repo_url, repo_path_guess])
            manifest = interactive_manifest(repo_path_guess)
            shutil.rmtree(tool_base_guess, ignore_errors=True)
            tool = add_tool(repo_url, manifest_override=manifest)
        else:
            print(f"\n[✗] Error: {e}", file=sys.stderr)
            sys.exit(1)
    except Exception as e:
        print(f"\n[✗] Error: {e}", file=sys.stderr)
        sys.exit(1)

    print("\n[✓] Herramienta agregada correctamente")
    print(f"    ID:   {tool['id']}")
    print(f"    Repo: {tool['repo']}")
    print(f"    Tipo: {tool['accepts']['kind']}")
    print(f"    Runtime: {tool['runtime']['type']}")

if __name__ == "__main__":
    main()
