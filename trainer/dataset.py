import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import fcntl
import hashlib
import importlib
import json
import math
import multiprocessing
import os
from pathlib import Path
import shutil
import time
import traceback

from app import models
from app.case import generate
from app.models import Project
from trainer.doe import cases, load_definition

DEFAULT_ROOT = Path('/data/datasets/v1')


def emit(root, value):
    line = json.dumps(value)+'\n'
    with (Path(root)/'batch.log').open('a') as log:
        log.write(line)
    print(line, end='', flush=True)


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False)+'\n')
    temporary.replace(path)


def read_json(path):
    return json.loads(path.read_text()) if path.exists() else {}


def rejection(result):
    try:
        k = result['kpi']
        values = [k['energy_balance_error'], k['room_average_c'], k['cfd_heater_power_w'],
                  result['T']['min'], result['T']['max'], k['air_density_min'], k['air_density_max']]
        if not all(math.isfinite(value) for value in values):
            return 'Non-finite result metrics'
        if not 0 <= k['energy_balance_error'] <= .1:
            return f'Energy balance rejected: {k["energy_balance_error"]}'
        if abs(k['room_average_c']-19) > .5 or k['insufficient_power']:
            return f'Thermostat rejected: {k["room_average_c"]} C, insufficient={k["insufficient_power"]}'
        if k['cfd_heater_power_w'] < 0 or not result['T']['min'] <= k['room_average_c'] <= result['T']['max']:
            return 'Invalid power or temperature range'
        if not 1 < k['air_density_min'] <= k['air_density_max'] < 1.35:
            return 'Air density rejected'
    except (KeyError, TypeError, ValueError) as exc:
        return f'Invalid result: {exc}'
    return None


def complete(directory, record):
    if record.get('status') != 'accepted' or not (directory/'result.json').exists():
        return False
    try:
        return rejection(read_json(directory/'result.json')) is None
    except (ValueError, OSError):
        return False


def execute_case(work, project):
    pipeline = importlib.import_module('runner')
    generate(project, work)
    pipeline.run(['blockMesh'], work, 120)
    pipeline.run(['topoSet'], work, 120)
    elapsed = pipeline.solve_thermostat(work, 2)
    pipeline.postprocess(work, elapsed)
    return read_json(work/'result.json')


def run_case(root, case, execute=execute_case):
    directory = Path(root)/'cases'/case['id']
    directory.mkdir(parents=True, exist_ok=True)
    record = read_json(directory/'metadata.json')
    if complete(directory, record):
        return record
    project = Project.model_validate(case['project'])
    thermal = project.thermal()
    record = {**record, **case, 'analytic_ua_w_k': thermal['ua_total'],
              'analytic_power_w': thermal['ua_total']*(project.heater.setpoint_c-project.outdoor_temp),
              'updated_at': time.time()}
    attempts = record.get('attempts', 0)
    if record.get('status') == 'running':
        write_json(directory/f'attempt-{attempts}.json',
                   {**record, 'status': 'failed', 'error': 'Previous trainer process interrupted'})
    if attempts >= 2:
        if record.get('status') in ('running', 'accepted'):
            record.update(status='failed', error='Interrupted or missing/corrupt result; retry budget exhausted')
            write_json(directory/'metadata.json', record)
        return record
    for attempt in range(attempts+1, 3):
        work = directory/'work'
        shutil.rmtree(work, ignore_errors=True)
        work.mkdir()
        record.update(status='running', attempts=attempt, updated_at=time.time(), error=None)
        write_json(directory/'metadata.json', record)
        started = time.monotonic()
        try:
            result = execute(work, project)
            reason = rejection(result)
            k = result['kpi']
            record.update(status='rejected' if reason else 'accepted', error=reason,
                          required_power_w=k['cfd_heater_power_w'], energy_balance_error=k['energy_balance_error'],
                          room_mean_c=k['room_average_c'], min_c=result['T']['min'], max_c=result['T']['max'],
                          solve_wall_time_s=k['solve_wall_time_s'], cell_count=k['cell_count'])
            write_json(directory/'result.json', result)
        except Exception as exc:
            record.update(status='failed', error=f'{type(exc).__name__}: {exc}')
            (directory/f'attempt-{attempt}-error.txt').write_text(traceback.format_exc())
        if (work/'run.log').exists():
            shutil.copyfile(work/'run.log', directory/f'attempt-{attempt}.log')
        record.update(wall_time_s=time.monotonic()-started, updated_at=time.time())
        write_json(directory/f'attempt-{attempt}.json', record)
        write_json(directory/'metadata.json', record)
        emit(root, {key: record.get(key) for key in ('id', 'status', 'attempts', 'wall_time_s', 'error')})
        if record['status'] == 'accepted':
            shutil.rmtree(work)
            break
    return record


def resource_capacity():
    cpus = len(os.sched_getaffinity(0))
    cpu_limit = Path('/sys/fs/cgroup/cpu.max')
    if cpu_limit.exists():
        quota, period = cpu_limit.read_text().split()
        if quota != 'max':
            cpus = min(cpus, max(1, int(quota)//int(period)))
    available = next(int(line.split()[1])*1024 for line in Path('/proc/meminfo').read_text().splitlines()
                     if line.startswith('MemAvailable:'))
    memory_limit = Path('/sys/fs/cgroup/memory.max')
    if memory_limit.exists() and memory_limit.read_text().strip() != 'max':
        available = min(available, int(memory_limit.read_text()))
    workers = max(1, min(cpus//2, int((available-1024**3)//(3*1024**3))))
    return {'cpus': cpus, 'memory_gib': round(available/1024**3, 2), 'capacity': workers}


def summary(root, plan):
    counts = dict.fromkeys(('accepted', 'rejected', 'failed', 'running', 'pending'), 0)
    seconds = []
    for case in plan:
        record = read_json(root/'cases'/case['id']/'metadata.json')
        state = record.get('status', 'pending')
        counts[state] += 1
        if state == 'accepted':
            seconds.append(record['wall_time_s'])
    return {**counts, 'total': len(plan), 'mean_case_wall_time_s': sum(seconds)/len(seconds) if seconds else None}


def prepare(root, definition, plan):
    root.mkdir(parents=True, exist_ok=True)
    base = Path(__file__).resolve().parents[1]
    runner = base/'worker/runner.py' if (base/'worker/runner.py').exists() else base/'runner.py'
    model_path = Path(models.__file__)
    sources = [runner, runner.with_name('visualization.py'), model_path, model_path.with_name('case.py')]
    digest = hashlib.sha256()
    for source in sources:
        digest.update(source.name.encode()+b'\0'+source.read_bytes())
    manifest = {'definition': definition, 'cases': plan, 'physics_sha256': digest.hexdigest()}
    path = root/'manifest.json'
    if path.exists() and read_json(path) != manifest:
        raise ValueError('Dataset manifest differs; use a new version/directory, never mix designs')
    write_json(path, manifest)


def main():
    parser = argparse.ArgumentParser(description='Resumable M0 CFD dataset; no surrogate training')
    parser.add_argument('--root', type=Path, default=DEFAULT_ROOT)
    parser.add_argument('--workers', type=int)
    parser.add_argument('--status', action='store_true')
    args = parser.parse_args()
    definition = load_definition()
    plan = cases(definition)
    if args.status:
        print(json.dumps(summary(args.root, plan), indent=2), flush=True)
        return
    args.root.mkdir(parents=True, exist_ok=True)
    with (args.root/'.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error('Another trainer already owns this dataset')
        prepare(args.root, definition, plan)
        resources = resource_capacity()
        workers = args.workers if args.workers is not None else resources['capacity']
        if not 1 <= workers <= resources['capacity']:
            parser.error(f'workers must be 1..{resources["capacity"]} for this container')
        emit(args.root, {'event': 'batch_started', 'root': str(args.root), 'workers': workers, **resources})
        with ProcessPoolExecutor(max_workers=workers, mp_context=multiprocessing.get_context('spawn')) as pool:
            futures = [pool.submit(run_case, args.root, case) for case in plan]
            for future in as_completed(futures):
                future.result()
                state = summary(args.root, plan)
                write_json(args.root/'status.json', state)
                emit(args.root, state)
        emit(args.root, {'event': 'batch_finished', **summary(args.root, plan)})


if __name__ == '__main__':
    main()
