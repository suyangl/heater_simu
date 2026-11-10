import base64
import json
import os
import re
import signal
import subprocess
import threading
import time
import traceback

import numpy as np
import pyvista as pv

from app.foam_output import wall_heat_flux
from app.case import control_dict, dictionary
from app.models import Project
from app.queue import DATA, connect, update


def heartbeat():
    while True:
        DATA.mkdir(parents=True, exist_ok=True)
        (DATA/'worker.heartbeat').touch()
        time.sleep(5)


def run(command, path, timeout=1200):
    with (path/'run.log').open('a') as log:
        log.write('\n$ '+' '.join(command)+'\n')
        log.flush()
        with subprocess.Popen(command, cwd=path, env={**os.environ, 'PWD': str(path)}, stdout=log,
                              stderr=subprocess.STDOUT, start_new_session=True) as process:
            try:
                code = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                raise
            if code:
                raise subprocess.CalledProcessError(code, command)


def thermostat_power(power, room_mean, project):
    if not np.isfinite(room_mean):
        raise ValueError('Thermostat received a non-finite room temperature')
    demand = max(0, project.heater.setpoint_c-project.outdoor_temp)
    if not demand:
        return 0.
    rise = room_mean-project.outdoor_temp
    if rise <= 0:
        return project.heater.power_w
    return min(project.heater.power_w, max(0., power*demand/rise))


def averaged_room_mean(path):
    reader = pv.OpenFOAMReader(str(path/'case.foam'))
    reader.cell_to_point_creation = False
    reader.set_active_time_value(max(reader.time_values))
    mesh = reader.read()['internalMesh']
    volumes = mesh.compute_cell_sizes(length=False, area=False).cell_data['Volume']
    return float(np.average(np.asarray(mesh.cell_data['TMean'])-273.15, weights=volumes))


def solve_thermostat(path, nprocs, budget=1200):
    if nprocs not in (1, 2):
        raise ValueError('M0 supports OPENFOAM_NPROCS=1 or 2')
    project = Project.model_validate_json((path/'project.json').read_text())
    started = time.monotonic()
    deadline = started+budget
    def execute(command):
        remaining = deadline-time.monotonic()
        if remaining <= 0:
            raise TimeoutError('CFD thermostat exceeded its wall-time budget')
        run(command, path, remaining)
    if nprocs == 2:
        execute(['decomposePar'])
    (path/'case.foam').touch()
    power = project.thermal()['effective_power_w']
    history = []
    end = 0
    def block(length, samples):
        nonlocal end
        end += length
        start = end-samples+1
        (path/'system/controlDict').write_text(dictionary('controlDict', control_dict(end, start)))
        execute(['foamDictionary', 'system/fvOptions', '-entry', 'convector.sources.h', '-set', f'({power:.12g} 0)'])
        command = ['buoyantSimpleFoam'] if nprocs == 1 else ['mpirun', '--allow-run-as-root', '-np', '2', 'buoyantSimpleFoam', '-parallel']
        execute(command)
        if nprocs == 2:
            execute(['reconstructPar', '-latestTime'])
        mean = averaged_room_mean(path)
        if not np.isfinite(mean):
            raise ValueError('Thermostat received a non-finite room temperature')
        return start, mean
    insufficient = False
    for attempt in range(8):
        _, mean = block(1500 if attempt == 0 else 700, 400 if attempt == 0 else 300)
        history.append({'end_iteration': end, 'power_w': power, 'room_mean_c': mean})
        (path/'thermostat.json').write_text(json.dumps(history, allow_nan=False))
        insufficient = power >= project.heater.power_w*(1-1e-9) and mean < project.heater.setpoint_c-.5
        if abs(mean-project.heater.setpoint_c) <= .5 or insufficient or project.heater.setpoint_c <= project.outdoor_temp:
            break
        power = thermostat_power(power, mean, project)
    else:
        raise RuntimeError('CFD thermostat did not settle within eight control blocks')
    average_start, final_mean = block(600, 600)
    if project.heater.setpoint_c > project.outdoor_temp and not insufficient and abs(final_mean-project.heater.setpoint_c) > .5:
        raise RuntimeError(f'Final thermostat averaging drifted from setpoint: {final_mean:.3f} C')
    meta = json.loads((path/'case_meta.json').read_text())
    meta.update(average_start=average_start, iterations=end, cfd_heater_power_w=power,
                thermostat_iterations=len(history), insufficient_power=insufficient,
                thermostat_history=history)
    (path/'case_meta.json').write_text(json.dumps(meta, allow_nan=False))
    return time.monotonic()-started


def postprocess(path, elapsed):
    project = Project.model_validate_json((path/'project.json').read_text())
    (path/'case.foam').touch()
    reader = pv.OpenFOAMReader(str(path/'case.foam'))
    reader.skip_zero_time = True
    reader.cell_to_point_creation = False
    reader.set_active_time_value(max(reader.time_values))
    data = reader.read()
    mesh = data['internalMesh']
    meta = json.loads((path/'case_meta.json').read_text())
    for block in [mesh, *data['boundary']]:
        for field in ('T', 'U', 'p'):
            block.cell_data[field] = np.asarray(block.cell_data[field+'Mean'])
    cell_t = np.asarray(mesh.cell_data['T'])-273.15
    if not np.isfinite(cell_t).all():
        raise ValueError('求解温度包含无效数值')
    volumes = mesh.compute_cell_sizes(length=False, area=False).cell_data['Volume']
    room_mean = float(np.average(cell_t, weights=volumes))
    r = project.room
    dims = (56, 48, 32)
    spacing = tuple(s/n for s,n in zip((r.length, r.width, r.height), dims))
    origin = tuple(s/2 for s in spacing)
    grid = pv.ImageData(dimensions=dims, spacing=spacing, origin=origin)
    sampled = grid.sample(mesh.cell_data_to_point_data())
    values = np.array(sampled['T'], dtype='<f4')-273.15
    mask = sampled['vtkValidPointMask'].astype(bool)
    points = grid.points
    for box in [*project.furniture, project.heater.box(r)]:
        inside = np.ones(len(points), dtype=bool)
        for d, (lo, hi) in enumerate(box.bounds()):
            inside &= (points[:, d] >= lo) & (points[:, d] <= hi)
        mask &= ~inside
    values[~mask] = np.nan
    if not mask.any():
        raise ValueError('重采样无有效空气点')
    thermal = project.thermal()
    flux_time, flux = wall_heat_flux(path, {'heater', project.exterior_wall, 'window'},
                                    (meta['average_start'], meta['iterations']))
    if not np.isclose(flux_time, max(reader.time_values)):
        raise ValueError('wallHeatFlux output does not match the final temperature field')
    losses = {patch: -value for patch, value in flux.items() if patch != 'heater'}
    loss = sum(losses.values())
    heater_flux = flux['heater']
    air_rho = np.asarray(mesh.cell_data['p'])/(8314.462618/28.96*(cell_t+273.15))
    centers = mesh.cell_centers().points
    hot_center = centers[int(np.argmax(cell_t))]
    hb = project.heater.box(r).bounds()
    hot_distance = float(np.linalg.norm([max(lo-v, 0, v-hi) for v,(lo,hi) in zip(hot_center,hb)]))
    log = (path/'run.log').read_text()
    residuals = {}
    for field, initial, final in re.findall(r'Solving for (\w+), Initial residual = ([\deE.+-]+), Final residual = ([\deE.+-]+)', log):
        residuals[field] = {'initial': float(initial), 'final': float(final)}
    iterations = re.findall(r'^Time = (\d+)', log, re.MULTILINE)
    effective = meta['cfd_heater_power_w']
    result = {'source': 'openfoam', 'grid': dict(zip(('nx','ny','nz'), dims), origin=origin, spacing=spacing),
              'T': {'dtype': 'float32', 'encoding': 'base64', 'data': base64.b64encode(values.tobytes()).decode(),
                    'min': float(np.min(cell_t)), 'max': float(np.max(cell_t)), 'mean': room_mean},
              'kpi': {'room_average_c': room_mean, **thermal, 'setpoint_c': project.heater.setpoint_c,
                      'analytic_effective_power_w': thermal['effective_power_w'],
                      'cfd_heater_power_w': effective, 'effective_power_w': effective,
                      'duty_cycle': effective/project.heater.power_w,
                      'insufficient_power': meta['insufficient_power'],
                      'thermostat_iterations': meta['thermostat_iterations'],
                      'thermostat_history': meta['thermostat_history'],
                      'modelling_note': 'M0 excludes radiation; CFD thermostat controls convective heating only.',
                      'heat_loss_w': loss, 'heat_loss_split_w': losses,
                      'heater_heat_flux_w': heater_flux, 'wall_heat_flux_time': flux_time,
                      'energy_balance_error': abs(loss-effective)/max(abs(effective), 1e-9),
                      'source_power_w': effective, 'average_start': meta['average_start'],
                      'average_end': meta['iterations'],
                      'air_density_min': float(np.min(air_rho)), 'air_density_max': float(np.max(air_rho)),
                      'max_temperature_distance_to_heater_m': hot_distance,
                      'solve_wall_time_s': elapsed, 'cell_count': mesh.n_cells,
                      'iterations': int(iterations[-1]) if iterations else 0, 'final_residuals': residuals}}
    (path/'result.json').write_text(json.dumps(result, allow_nan=False))


def main():
    if os.environ.get('MAX_PARALLEL_JOBS', '1') != '1':
        raise ValueError('M0 supports MAX_PARALLEL_JOBS=1 only')
    threading.Thread(target=heartbeat, daemon=True).start()
    with connect() as db:
        db.execute("UPDATE jobs SET status='failed', error='worker restarted during run' WHERE status IN ('meshing','solving','postprocessing')")
    while True:
        with connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute("SELECT id FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
            if row:
                db.execute("UPDATE jobs SET status='meshing', progress=0.05 WHERE id=?", (row['id'],))
        if not row:
            time.sleep(2)
            continue
        job_id = row['id']
        path = DATA/job_id
        try:
            run(['blockMesh'], path, 120)
            run(['topoSet'], path, 120)
            update(job_id, 'solving', .15)
            nprocs = int(os.environ.get('OPENFOAM_NPROCS', '2'))
            elapsed = solve_thermostat(path, nprocs)
            update(job_id, 'postprocessing', .9)
            postprocess(path, elapsed)
            update(job_id, 'done', 1)
        except Exception as exc:
            with (path/'run.log').open('a') as f:
                f.write(traceback.format_exc())
            update(job_id, 'failed', 1, str(exc))


if __name__ == '__main__':
    main()
