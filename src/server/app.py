from fastapi import FastAPI, UploadFile, File, Body, HTTPException
from pydantic import BaseModel
from typing import Optional
import os, uuid
from server.storage import JobStore
from server.runner import run_job
from server.tools_add import add_tool

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

app = FastAPI(title="zipper_tools")
store = JobStore(os.path.join(_BASE, "tools_runtime", "work"))

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
    try:
        return add_tool(data.repo_url)
    except RuntimeError as e:
        raise HTTPException(400, str(e))

@app.get("/jobs/{job_id}")
def job(job_id: str):
    j = store.read_job(job_id)
    if not j:
        raise HTTPException(404)

    # Adjuntar contenido de archivos de resultados por herramienta
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
                            import json as _json
                            output[fname] = _json.loads(content)
                        except Exception:
                            output[fname] = content
                    except Exception:
                        output[fname] = None
            tool_result["output"] = output

    return j
