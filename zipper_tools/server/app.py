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
