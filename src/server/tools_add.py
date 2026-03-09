import os, sys, subprocess, uuid, yaml, shutil
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server.registry import load_tools, save_tools

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS_DIR = os.path.join(_BASE, "tools_storage")

def _run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr

def add_tool(repo_url: str):
    code, _, err = _run(["git", "ls-remote", repo_url])
    if code != 0:
        raise RuntimeError(f"Repo no accesible: {err}")

    tool_id = str(uuid.uuid4())[:8]
    base = os.path.join(TOOLS_DIR, tool_id)
    repo = os.path.join(base, "repo")
    os.makedirs(base, exist_ok=True)

    _run(["git", "clone", "--depth", "1", repo_url, repo])

    manifest = os.path.join(repo, "zipper_tools.yaml")
    if not os.path.exists(manifest):
        shutil.rmtree(base)
        raise RuntimeError("Falta zipper_tools.yaml")

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
    return tools[tool_id]
