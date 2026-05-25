from fastapi import FastAPI, UploadFile, File, Body, HTTPException, Query, Depends, Header
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional
import os, uuid, re
from server.storage import JobStore
from server.runner import run_job
from server.tools_add import add_tool
from server.auth import (
    decode_token, create_token,
    load_users, save_users,
    hash_password, verify_password, ROLES,
)

_BASE   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

app   = FastAPI(title="zipper_tools")
store = JobStore(os.path.join(_BASE, "tools_runtime", "work"))

app.mount("/static", StaticFiles(directory=_STATIC), name="static")

# ── Auth dependencies ────────────────────────────────────────
async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "No autenticado")
    data = decode_token(authorization.removeprefix("Bearer ").strip())
    if not data:
        raise HTTPException(401, "Token inválido o expirado")
    user = load_users().get(data["sub"])
    if not user:
        raise HTTPException(401, "Usuario no encontrado")
    return user

def require_roles(*roles):
    async def dep(user: dict = Depends(get_current_user)):
        if user["role"] not in roles:
            raise HTTPException(403, "Permisos insuficientes")
        return user
    return dep

# ── Models ───────────────────────────────────────────────────
class UrlIn(BaseModel):
    type: str = "url"
    url: str

class LoginIn(BaseModel):
    username: str
    password: str

class ChangePasswordIn(BaseModel):
    new_password: str

class CreateUserIn(BaseModel):
    username: str
    password: str
    role: str

class AddToolIn(BaseModel):
    repo_url: str
    kind: Optional[str] = None
    runtime_type: Optional[str] = None
    cmd: Optional[str] = None

# ── Static / UI ──────────────────────────────────────────────
@app.get("/")
def index():
    return FileResponse(os.path.join(_STATIC, "templates", "index.html"))

# ── Auth ─────────────────────────────────────────────────────
@app.post("/auth/login")
def login(data: LoginIn):
    users = load_users()
    user  = users.get(data.username)
    if not user or not verify_password(data.password, user["password"]):
        raise HTTPException(401, "Credenciales incorrectas")
    token = create_token(user["username"], user["role"])
    return {
        "token": token,
        "username": user["username"],
        "role": user["role"],
        "must_change_password": user.get("must_change_password", False),
    }

@app.get("/auth/me")
def me(current_user: dict = Depends(get_current_user)):
    return {
        "username": current_user["username"],
        "role": current_user["role"],
        "must_change_password": current_user.get("must_change_password", False),
    }

@app.post("/auth/change-password")
def change_password(data: ChangePasswordIn, current_user: dict = Depends(get_current_user)):
    if len(data.new_password) < 8:
        raise HTTPException(400, "La contraseña debe tener al menos 8 caracteres")
    users = load_users()
    users[current_user["username"]]["password"] = hash_password(data.new_password)
    users[current_user["username"]]["must_change_password"] = False
    save_users(users)
    return {"ok": True}

# ── User management (admin only) ─────────────────────────────
@app.get("/users")
def list_users(current_user: dict = Depends(require_roles("admin"))):
    users = load_users()
    return {"users": [
        {"username": u["username"], "role": u["role"]}
        for u in users.values()
    ]}

@app.post("/users")
def create_user(data: CreateUserIn, current_user: dict = Depends(require_roles("admin"))):
    if data.role not in ROLES:
        raise HTTPException(400, f"Rol inválido. Opciones: {ROLES}")
    users = load_users()
    if data.username in users:
        raise HTTPException(400, f"Usuario '{data.username}' ya existe")
    if len(data.password) < 8:
        raise HTTPException(400, "La contraseña debe tener al menos 8 caracteres")
    users[data.username] = {
        "username": data.username,
        "password": hash_password(data.password),
        "role": data.role,
        "must_change_password": False,
    }
    save_users(users)
    return {"username": data.username, "role": data.role}

@app.delete("/users/{username}")
def delete_user(username: str, current_user: dict = Depends(require_roles("admin"))):
    if username == "admin":
        raise HTTPException(400, "No se puede eliminar el usuario admin")
    users = load_users()
    if username not in users:
        raise HTTPException(404, "Usuario no encontrado")
    del users[username]
    save_users(users)
    return {"ok": True}

# ── Jobs ─────────────────────────────────────────────────────
@app.get("/jobs")
def list_jobs(q: str = Query(default=""), current_user: dict = Depends(get_current_user)):
    return {"jobs": store.list_jobs(q)}

@app.post("/submit")
async def submit(
    file: Optional[UploadFile] = File(None),
    body: Optional[UrlIn] = Body(None),
    current_user: dict = Depends(get_current_user),
):
    job_id = str(uuid.uuid4())
    if file:
        store.create_job(job_id, "file", filename=file.filename)
        await store.save_uploaded_file(job_id, file)
    elif body:
        store.create_job(job_id, "url", body.url)
    else:
        raise HTTPException(400, "Enviar archivo o URL")

    store.update_status(job_id, "running")
    res = run_job(store, job_id)
    store.finish(job_id, "finished", res)
    return {"job_id": job_id}

# ── Tools ─────────────────────────────────────────────────────
@app.post("/tools/add")
def tools_add(data: AddToolIn, current_user: dict = Depends(require_roles("admin", "user"))):
    manifest = None
    if data.kind and data.runtime_type and data.cmd:
        manifest = {
            "accepts":    {"kind": data.kind},
            "entrypoint": {"cmd": data.cmd},
            "runtime":    {"type": data.runtime_type},
        }
    try:
        return add_tool(data.repo_url, manifest)
    except RuntimeError as e:
        if "NEEDS_MANIFEST" in str(e):
            raise HTTPException(422, "NEEDS_MANIFEST: el repositorio no tiene zipper_tools.yaml — completa los campos de manifiesto")
        raise HTTPException(400, str(e))

# ── Results formatting ────────────────────────────────────────
_MAX_MATCH_LEN = 120
_ANSI = re.compile(r'\x1b\[[0-9;]*[mGKHFJSTABCDEFf]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[()][0-9A-Za-z]')

def _parse_text_findings(text: str):
    """Parse [Category] / item lines from tool text output into hallazgos list."""
    sections, order, current = {}, [], None
    for line in text.split('\n'):
        stripped = line.strip()
        m = re.match(r'^\[([^\]]+)\]$', stripped)
        if m:
            current = m.group(1)
            if current not in sections:
                sections[current] = []
                order.append(current)
        elif current and stripped:
            val = stripped.lstrip('- ').strip()
            if val:
                sections[current].append(val[:_MAX_MATCH_LEN])
    return [{"tipo": k, "results": sections[k]} for k in order if sections[k]]

def _format_findings(findings: list) -> dict:
    summary = []
    for item in findings:
        name    = item.get("name", "?")
        matches = item.get("matches", [])
        clean   = [m for m in matches if len(m) < 1000 and "HackerOne_CTF_Flag" not in m]
        if not clean:
            continue
        truncated = [m if len(m) <= _MAX_MATCH_LEN else m[:_MAX_MATCH_LEN] + "…" for m in clean]
        summary.append({"tipo": name, "results": truncated})
    return {"hallazgos": summary, "total_tipos": len(summary)}

@app.get("/jobs/{job_id}")
def job(job_id: str, current_user: dict = Depends(get_current_user)):
    j = store.read_job(job_id)
    if not j:
        raise HTTPException(404)

    import json as _json

    tools_dir = os.path.join(store.job_dir(job_id), "tools")
    if j.get("results") and os.path.isdir(tools_dir):
        for tool_result in j["results"].get("tools", []):
            tool_id    = tool_result["tool"]
            tool_outdir = os.path.join(tools_dir, tool_id)
            output = {}
            if os.path.isdir(tool_outdir):
                for fname in os.listdir(tool_outdir):
                    fpath = os.path.join(tool_outdir, fname)
                    try:
                        with open(fpath) as f:
                            content = _ANSI.sub('', f.read())
                        try:
                            parsed = _json.loads(content)
                            if isinstance(parsed, dict) and "results" in parsed and isinstance(parsed["results"], list):
                                output[fname] = {
                                    "paquete": parsed.get("package"),
                                    **_format_findings(parsed["results"]),
                                }
                            elif isinstance(parsed, list) and parsed and "name" in parsed[0]:
                                output[fname] = _format_findings(parsed)
                            else:
                                output[fname] = parsed
                        except Exception:
                            findings = _parse_text_findings(content)
                            if findings:
                                output[fname] = {"hallazgos": findings}
                            else:
                                output[fname] = content[:8000] + ("…" if len(content) > 8000 else "")
                    except Exception:
                        output[fname] = None
            tool_result["output"] = output

    return j
