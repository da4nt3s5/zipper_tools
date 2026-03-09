import os, sys, subprocess, uuid, yaml, shutil
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server.registry import load_tools, save_tools

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS_DIR = os.path.join(_BASE, "tools_storage")

def _run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr

def add_tool(repo_url: str):
    print(f"[*] Iniciando registro de herramienta: {repo_url}")

    print("[*] Verificando acceso al repositorio...")
    code, _, err = _run(["git", "ls-remote", repo_url])
    if code != 0:
        raise RuntimeError(f"Repo no accesible: {err}")
    print("[+] Repositorio accesible")

    tool_id = str(uuid.uuid4())[:8]
    base = os.path.join(TOOLS_DIR, tool_id)
    repo = os.path.join(base, "repo")
    os.makedirs(base, exist_ok=True)

    print(f"[*] Clonando repo (id={tool_id})...")
    code, _, err = _run(["git", "clone", "--depth", "1", repo_url, repo])
    if code != 0:
        shutil.rmtree(base)
        raise RuntimeError(f"Error al clonar: {err}")
    print("[+] Repo clonado")

    manifest = os.path.join(repo, "zipper_tools.yaml")
    if not os.path.exists(manifest):
        shutil.rmtree(base)
        raise RuntimeError("Falta zipper_tools.yaml en el repositorio")
    print("[+] Manifest encontrado")

    data = yaml.safe_load(open(manifest))

    tools = load_tools()
    tools[tool_id] = {
        "id": tool_id,
        "repo": repo_url,
        "accepts": data["accepts"],
        "entrypoint": data["entrypoint"],
        "runtime": data["runtime"],
        "path": base
    }
    save_tools(tools)
    print(f"[+] Herramienta registrada exitosamente (id={tool_id})")
    return tools[tool_id]


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Uso: python tools_add.py <repo_url>")
        sys.exit(1)
    try:
        result = add_tool(sys.argv[1])
        print(f"[OK] {result}")
    except RuntimeError as e:
        print(f"[ERROR] {e}")
        sys.exit(1)
