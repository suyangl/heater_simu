#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose up -d --build
docker compose exec -T api python - <<'PY'
import base64
import json
import time
import urllib.request

base = 'http://localhost:8000/api'
def get(path):
    with urllib.request.urlopen(base+path, timeout=20) as response:
        return json.load(response)
for _ in range(60):
    try:
        if get('/health')['worker_alive']:
            break
    except Exception:
        pass
    time.sleep(2)
else:
    raise RuntimeError('API or worker not ready')
example = get('/example')
request = urllib.request.Request(base+'/simulate', data=json.dumps(example).encode(), headers={'Content-Type': 'application/json'})
with urllib.request.urlopen(request) as response:
    job_id = json.load(response)['job_id']
print('job_id:', job_id, flush=True)
started = time.monotonic()
while time.monotonic()-started < 1350:
    job = get('/jobs/'+job_id)
    if job['status'] == 'failed':
        raise RuntimeError(json.dumps(job, ensure_ascii=False))
    if job['status'] == 'done':
        break
    time.sleep(3)
else:
    raise TimeoutError('CFD exceeded 1350 seconds')
result = get('/jobs/'+job_id+'/result')
kpi = result['kpi']
print(json.dumps({'temperature': {k:v for k,v in result['T'].items() if k!='data'}, 'kpi': kpi}, indent=2), flush=True)
if not kpi['insufficient_power']:
    assert abs(kpi['room_average_c']-example['heater']['setpoint_c']) <= .5, 'thermostat mean differs from setpoint by >0.5 C'
assert 0 <= kpi['cfd_heater_power_w'] <= example['heater']['power_w']
assert kpi['analytic_effective_power_w'] > 0
assert kpi['thermostat_iterations'] > 0
assert kpi['source_power_w'] == kpi['cfd_heater_power_w']
assert kpi['max_temperature_distance_to_heater_m'] < .5, 'maximum is not near heater'
assert kpi['energy_balance_error'] < .1, 'energy balance error >10%'
assert 1.0 < kpi['air_density_min'] <= kpi['air_density_max'] < 1.35, 'air density outside plausible range'
assert kpi['average_end'] > kpi['average_start'] > 0
assert kpi['cell_count'] <= 150000
payload_bytes = len(json.dumps(result).encode())
assert payload_bytes < 3000000
assert len(base64.b64decode(result['U']['data'])) == result['grid']['nx']*result['grid']['ny']*result['grid']['nz']*4
assert result['surfaces'] and all(s['triangle_count'] > 0 for s in result['surfaces'])
assert 100 <= result['streamlines']['line_count'] <= 200
assert result['isosurface']['triangle_count'] > 0
print('Visualization payload bytes:', payload_bytes, 'surfaces:', len(result['surfaces']), 'streamlines:', result['streamlines']['line_count'], flush=True)
print('E2E PASS', flush=True)
PY
