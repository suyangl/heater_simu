import os
import sqlite3
from pathlib import Path

DATA = Path(os.environ.get('DATA_DIR', '/data'))


def connect():
    DATA.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DATA/'jobs.sqlite', timeout=30)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, status TEXT, progress REAL, error TEXT, created REAL)')
    return db


def update(job_id, status, progress, error=None):
    with connect() as db:
        db.execute('UPDATE jobs SET status=?, progress=?, error=? WHERE id=?', (status, progress, error, job_id))
