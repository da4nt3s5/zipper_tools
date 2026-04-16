from fastapi import FastAPI, UploadFile, File, Body, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional
import os, uuid
from server.storage import JobStore
from server.runner import run_job
from server.tools_add import add_tool

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

app = FastAPI(title="zipper_tools")
store = JobStore(os.path.join(_BASE, "tools_runtime", "work"))

# Serve static files (CSS, JS, SVG) under /static
app.mount("/static", StaticFiles(directory=_STATIC), name="static")

class UrlIn(BaseModel):
    type: str = "url"
    url: str

class RepoIn(BaseModel):
    repo_url: str

@app.get("/")
def index():
    return FileResponse(os.path.join(_STATIC, "index.html"))

@app.get("/jobs")
def list_jobs(q: str = Query(default="")):
    return {"jobs": store.list_jobs(q)}

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
    try:
        return add_tool(data.repo_url)
    except RuntimeError as e:
        raise HTTPException(400, str(e))

_MAX_MATCH_LEN = 120

def _format_findings(findings: list) -> dict:
    """Convierte lista de hallazgos en resumen legible."""
    summary = []
    for item in findings:
        name = item.get("name", "?")
        matches = item.get("matches", [])
        # Filtrar matches que son solo CSS/HTML masivo (> 1000 chars)
        clean = [m for m in matches if len(m) < 1000]
        if not clean:
            continue
        truncated = [
            m if len(m) <= _MAX_MATCH_LEN else m[:_MAX_MATCH_LEN] + "…"
            for m in clean
        ]
        summary.append({"tipo": name, "results": truncated})
    return {"hallazgos": summary, "total_tipos": len(summary)}


@app.get("/jobs/{job_id}")
def job(job_id: str):
    j = store.read_job(job_id)
    if not j:
        raise HTTPException(404)

    import json as _json

    tools_dir = os.path.join(store.job_dir(job_id), "tools")
    if j.get("results") and os.path.isdir(tools_dir):
        for tool_result in j["results"].get("tools", []):
            tool_id = tool_result["tool"]
            tool_outdir = os.path.join(tools_dir, tool_id)
            output = {}
            if os.path.isdir(tool_outdir):
                for fname in os.listdir(tool_outdir):
                    fpath = os.path.join(tool_outdir, fname)
                    try:
                        with open(fpath) as f:
                            content = f.read()
                        try:
                            parsed = _json.loads(content)
                            # Si es lista de hallazgos con campo "name"+"matches", formatear
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
                            # Texto plano: truncar si es muy largo
                            output[fname] = content[:2000] + ("…" if len(content) > 2000 else "")
                    except Exception:
                        output[fname] = None
            tool_result["output"] = output

    return j
