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


def surrogate_artifact():
    path = DATA/'datasets/v1/s1-v1.json'
    if not path.exists():
        raise HTTPException(404, 'S1 artifact is not built yet')
    return path


@app.get('/api/surrogate/manifest')
def surrogate_manifest():
    try:
        path = surrogate_artifact()
    except HTTPException:
        return {'version': 's1-v1', 'available': False, 'cases': 0}
    try:
        artifact = json.loads(path.read_text())
        return {'version': artifact['version'], 'available': True, 'cases': len(artifact['cases']),
                'built_at': artifact['built_at'], 'axes': artifact['axes'],
                'availability': artifact['availability'], 'validation': artifact['validation'],
                'artifact_url': '/api/surrogate/artifact', 'static_url': '/surrogate/s1-v1.json'}
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(503, 'Invalid S1 artifact') from exc


@app.get('/api/surrogate/artifact')
def surrogate_file():
    return FileResponse(surrogate_artifact(), media_type='application/json', headers={'Cache-Control':'no-cache'})


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
    progress = DATA/row['id']/'progress.json'
    if progress.exists():
        runtime = json.loads(progress.read_text())
        stop = runtime['updated_at'] if row['status'] in ('done', 'failed') else time.time()
        row['runtime'] = {**runtime, 'elapsed_s': max(0, stop-runtime['started_at'])}
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
