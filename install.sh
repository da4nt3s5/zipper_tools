#!/usr/bin/env bash
set -euo pipefail

echo "=== central_tools Installer ==="

# -------------------------
# Ask port
# -------------------------
DEFAULT_PORT=8080
read -rp "Puerto para central_tools [${DEFAULT_PORT}]: " CT_PORT
CT_PORT="${CT_PORT:-$DEFAULT_PORT}"

if ! [[ "$CT_PORT" =~ ^[0-9]+$ ]]; then
  echo "[!] Puerto inválido"
  exit 1
fi

CT_DIR="$PWD/central_tools"
CT_HOST="0.0.0.0"

echo "[*] Instalando en ${CT_DIR}"
echo "[*] Puerto: ${CT_PORT}"

# -------------------------
# Prereqs
# -------------------------
need() { command -v "$1" >/dev/null || { echo "[!] Falta $1"; exit 1; }; }
need python3
need pip3
need git

# -------------------------
# Directories
# -------------------------
mkdir -p "${CT_DIR}"/{server,tools_storage,tools_runtime/work,logs}

# -------------------------
# Python venv
# -------------------------
python3 -m venv "${CT_DIR}/.venv"
source "${CT_DIR}/.venv/bin/activate"
pip install --upgrade pip >/dev/null
pip install fastapi uvicorn pydantic PyYAML >/dev/null

# -------------------------
# server/__init__.py
# -------------------------
cat > "${CT_DIR}/server/__init__.py" <<'PY'
# central_tools server
PY

# -------------------------
# tools_db.json
# -------------------------
cat > "${CT_DIR}/server/tools_db.json" <<'JSON'
{}
JSON

# -------------------------
# registry.py
# -------------------------
cat > "${CT_DIR}/server/registry.py" <<'PY'
import json, os

DB_PATH = "server/tools_db.json"

def load_tools():
    if not os.path.exists(DB_PATH):
        return {}
    with open(DB_PATH) as f:
        return json.load(f)

def save_tools(data):
    with open(DB_PATH, "w") as f:
        json.dump(data, f, indent=2)
PY

# -------------------------
# tools_add.py
# -------------------------
cat > "${CT_DIR}/server/tools_add.py" <<'PY'
import os, subprocess, uuid, yaml, shutil
from server.registry import load_tools, save_tools

TOOLS_DIR = "tools_storage"

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

    manifest = os.path.join(repo, "central_tools.yaml")
    if not os.path.exists(manifest):
        shutil.rmtree(base)
        raise RuntimeError("Falta central_tools.yaml")

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
PY

# -------------------------
# runner.py
# -------------------------
cat > "${CT_DIR}/server/runner.py" <<'PY'
import os, subprocess, time
from server.registry import load_tools

def run_job(store, job_id):
    job = store.read_job(job_id)
    kind = job["kind"]
    url = job.get("url")
    file_path = store.input_file_path(job_id) if kind == "file" else None
    jobdir = store.job_dir(job_id)

    tools = load_tools()
    results = []

    for t in tools.values():
        if t["accepts"]["kind"] != kind:
            continue

        outdir = os.path.join(jobdir, "tools", t["id"])
        os.makedirs(outdir, exist_ok=True)

        ctx = {
            "file": file_path or "",
            "url": url or "",
            "outdir": outdir,
            "jobdir": jobdir
        }

        cmd = t["entrypoint"]["cmd"].format(**ctx)

        start = time.time()
        try:
            subprocess.run(cmd, shell=True, check=True)
            status, err = "ok", None
        except Exception as e:
            status, err = "error", str(e)

        results.append({
            "tool": t["id"],
            "status": status,
            "runtime_ms": int((time.time() - start) * 1000),
            "error": err
        })

    return {"tools": results}
PY

# -------------------------
# storage.py
# -------------------------
cat > "${CT_DIR}/server/storage.py" <<'PY'
import os, json

class JobStore:
    def __init__(self, base_dir):
        self.base_dir = base_dir
        os.makedirs(base_dir, exist_ok=True)

    def job_dir(self, job_id):
        return os.path.join(self.base_dir, job_id)

    def create_job(self, job_id, kind, url=None):
        d = self.job_dir(job_id)
        os.makedirs(d, exist_ok=True)
        os.makedirs(f"{d}/input", exist_ok=True)
        os.makedirs(f"{d}/tools", exist_ok=True)
        self._write(job_id, {"job_id": job_id, "kind": kind, "url": url, "status": "queued"})

    async def save_uploaded_file(self, job_id, upload):
        with open(f"{self.job_dir(job_id)}/input/sample.bin", "wb") as f:
            f.write(await upload.read())

    def input_file_path(self, job_id):
        return f"{self.job_dir(job_id)}/input/sample.bin"

    def update_status(self, job_id, status):
        job = self.read_job(job_id)
        job["status"] = status
        self._write(job_id, job)

    def finish(self, job_id, status, results):
        job = self.read_job(job_id)
        job["status"] = status
        job["results"] = results
        self._write(job_id, job)

    def read_job(self, job_id):
        p = f"{self.job_dir(job_id)}/job.json"
        return json.load(open(p)) if os.path.exists(p) else None

    def _write(self, job_id, data):
        with open(f"{self.job_dir(job_id)}/job.json", "w") as f:
            json.dump(data, f, indent=2)
PY

# -------------------------
# app.py
# -------------------------
cat > "${CT_DIR}/server/app.py" <<'PY'
from fastapi import FastAPI, UploadFile, File, Body, HTTPException
from pydantic import BaseModel
from typing import Optional
import uuid
from server.storage import JobStore
from server.runner import run_job
from server.tools_add import add_tool

app = FastAPI(title="central_tools")
store = JobStore("tools_runtime/work")

class UrlIn(BaseModel):
    type: str = "url"
    url: str

class RepoIn(BaseModel):
    repo_url: str

@app.post("/submit")
async def submit(file: Optional[UploadFile] = File(None), body: Optional[UrlIn] = Body(None)):
    job_id = str(uuid.uuid4())
    if file:
        store.create_job(job_id, "file")
        await store.save_uploaded_file(job_id, file)
    elif body:
        store.create_job(job_id, "url", body.url)
    else:
        raise HTTPException(400, "Enviar archivo o URL")

    store.update_status(job_id, "running")
    res = run_job(store, job_id)
    store.finish(job_id, "finished", res)
    return {"job_id": job_id}

@app.post("/tools/add")
def tools_add(data: RepoIn):
    return add_tool(data.repo_url)

@app.get("/jobs/{job_id}")
def job(job_id: str):
    j = store.read_job(job_id)
    if not j:
        raise HTTPException(404)
    return j
PY

# -------------------------
# run_server.sh
# -------------------------
cat > "${CT_DIR}/run_server.sh" <<EOF
#!/usr/bin/env bash
source "\$(dirname "\$0")/.venv/bin/activate"
uvicorn server.app:app --host ${CT_HOST} --port ${CT_PORT}
EOF
chmod +x "${CT_DIR}/run_server.sh"

echo
echo "[✓] central_tools instalado correctamente"
echo "    cd central_tools && ./run_server.sh"
