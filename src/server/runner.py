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
        accepts = t["accepts"]
        if accepts["kind"] not in (kind, "both"):
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
