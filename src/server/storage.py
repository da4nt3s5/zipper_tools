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
