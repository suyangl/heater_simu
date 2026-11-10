import json
import shutil
import time
import uuid

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

from .case import generate
from .models import Project
from .queue import DATA, connect

app = FastAPI(title='HeatSimu M0')


@app.get('/api/health')
def health():
    with connect() as db:
        db.execute('SELECT 1')
    heartbeat = DATA/'worker.heartbeat'
    return {'status': 'ok', 'worker_alive': heartbeat.exists() and time.time()-heartbeat.stat().st_mtime < 30}


@app.get('/api/example')
def example():
    return Project()


@app.post('/api/simulate', status_code=202)
def simulate(project: Project):
    job_id = str(uuid.uuid4())
    path = DATA/job_id
    try:
        meta = generate(project, path)
    except ValueError as exc:
        if path.exists():
            shutil.rmtree(path)
        raise HTTPException(422, str(exc)) from exc
    (path/'mesh.json').write_text(json.dumps(meta))
    with connect() as db:
        db.execute('INSERT INTO jobs VALUES (?, ?, ?, ?, ?)', (job_id, 'queued', 0, None, time.time()))
    return {'job_id': job_id}


def find(job_id):
    with connect() as db:
        row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
    if row is None:
        raise HTTPException(404, '任务不存在')
    return dict(row)


@app.get('/api/jobs/{job_id}')
def job(job_id: str):
    row = find(job_id)
    row['project'] = json.loads((DATA/row['id']/'project.json').read_text())
    log = DATA/row['id']/'run.log'
    if log.exists():
        with log.open('rb') as f:
            f.seek(max(0, log.stat().st_size-4000))
            row['log_tail'] = f.read().decode(errors='replace')
    return row


@app.get('/api/jobs/{job_id}/result')
def result(job_id: str):
    row = find(job_id)
    if row['status'] != 'done':
        raise HTTPException(409, '结果尚未完成')
    return FileResponse(DATA/row['id']/'result.json', media_type='application/json')
