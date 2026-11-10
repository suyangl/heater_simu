"""Accepted-only, normalized S1 snapshot. No solver calls or dataset mutations."""
import argparse
import base64
import itertools
import json
import math
from pathlib import Path
import struct
import time

from app.models import ACH, U_VALUES, Project
from trainer.dataset import complete, read_json, write_json
from trainer.doe import cases, load_definition, project_for

GRID = (24, 20, 12)


def quantize(values):
    finite = [v for v in values if math.isfinite(v)]
    if not finite:
        raise ValueError('No finite air samples')
    minimum, maximum = min(finite), max(finite)
    scale = (maximum-minimum)/65534 or 1.
    packed = [round((v-minimum)/scale) if math.isfinite(v) else 65535 for v in values]
    return {'min': minimum, 'scale': scale, 'data': base64.b64encode(struct.pack(f'<{len(packed)}H', *packed)).decode()}


def decode(theta):
    return [theta['min']+v*theta['scale'] if v != 65535 else float('nan')
            for (v,) in struct.iter_unpack('<H', base64.b64decode(theta['data']))]


def normalized_field(result, project, dims=GRID):
    g = result['grid']
    source = [v for (v,) in struct.iter_unpack('<f', base64.b64decode(result['T']['data']))]
    counts = [g[k] for k in ('nx', 'ny', 'nz')]
    if len(source) != math.prod(counts):
        raise ValueError('Temperature grid length mismatch')
    room = [project.room.length, project.room.width, project.room.height]
    boxes = [*project.furniture, project.heater.box(project.room)]
    rise = result['kpi']['room_average_c']-project.outdoor_temp
    if rise <= 0 or not math.isfinite(rise):
        raise ValueError('S1 requires positive finite heating rise')
    values = []
    for k, j, i in itertools.product(range(dims[2]), range(dims[1]), range(dims[0])):
        point = [(index+.5)*size/count for index, size, count in zip((i,j,k), room, dims)]
        if any(all(lo <= x <= hi for x, (lo,hi) in zip(point, box.bounds())) for box in boxes):
            values.append(float('nan'))
            continue
        indices = [min(n-1., max(0., (x-o)/s)) for x,o,s,n in zip(point,g['origin'],g['spacing'],counts)]
        total = weight = 0.
        for dx,dy,dz in itertools.product((0,1), repeat=3):
            xyz = [min(n-1, math.floor(v)+d) for v,d,n in zip(indices,(dx,dy,dz),counts)]
            w = math.prod((v-math.floor(v)) if d else 1-(v-math.floor(v)) for v,d in zip(indices,(dx,dy,dz)))
            value = source[xyz[0]+counts[0]*(xyz[1]+counts[1]*xyz[2])]
            if math.isfinite(value):
                total += w*value
                weight += w
        values.append(((total/weight)-project.outdoor_temp)/rise if weight else float('nan'))
    return values


def accepted(root):
    manifest = read_json(root/'manifest.json')
    definition = manifest.get('definition', load_definition())
    plan = manifest.get('cases', cases(definition))
    rows, availability = [], []
    for case in plan:
        directory = root/'cases'/case['id']
        record = read_json(directory/'metadata.json')
        valid = complete(directory, record)
        if case['split'] == 'train':
            availability.append({k: case[k] for k in ('id','template','dpe','position')} | {'available': valid})
        if not valid:
            continue
        if record.get('project') != case['project']:
            raise ValueError(f'Accepted project differs from manifest: {case["id"]}')
        project = Project.model_validate(case['project'])
        result = read_json(directory/'result.json')
        theta = normalized_field(result, project)
        finite = [v for v in theta if math.isfinite(v)]
        denominator = project.thermal()['ua_total']*(project.heater.setpoint_c-project.outdoor_temp)
        rise = result['kpi']['room_average_c']-project.outdoor_temp
        rows.append({k: case[k] for k in ('id','template','dpe','position','split')} | {
            'wall_u': U_VALUES[case['dpe']][0], 'k': result['kpi']['cfd_heater_power_w']/denominator,
            'mean_c': result['kpi']['room_average_c'], 'theta': quantize(theta),
            'shape': {'min': min(finite), 'max': max(finite), 'mean': sum(finite)/len(finite),
                      'comfort_fraction_18_22': sum(18 <= project.outdoor_temp+rise*v <= 22 for v in finite)/len(finite)}})
    return definition, rows, availability


def interpolate(rows, template, position, u):
    group = sorted((r for r in rows if r['template']==template and r['position']==position), key=lambda r:r['wall_u'])
    if not group:
        return None
    lower = max((r for r in group if r['wall_u'] <= u), key=lambda r:r['wall_u'], default=group[0])
    upper = min((r for r in group if r['wall_u'] >= u), key=lambda r:r['wall_u'], default=group[-1])
    fraction = (u-lower['wall_u'])/(upper['wall_u']-lower['wall_u']) if upper['wall_u'] != lower['wall_u'] else 0.
    a,b = decode(lower['theta']), decode(upper['theta'])
    theta = [x+(y-x)*fraction if math.isfinite(x) and math.isfinite(y) else float('nan') for x,y in zip(a,b)]
    return theta, lower['k']+(upper['k']-lower['k'])*fraction, group[0]['wall_u'] <= u <= group[-1]['wall_u']


def validate(rows, definition):
    train = [r for r in rows if r['split']=='train']
    reports = {}
    delta = definition['setpoint_c']-definition['outdoor_temp']
    for split in ('train','holdout'):
        errors, raw_errors, means, powers, details = [], [], [], [], []
        targets = [r for r in rows if r['split']==split]
        for row in targets:
            prediction = interpolate([r for r in train if r['id'] != row['id']],row['template'],row['position'],row['wall_u'])
            if prediction is None:
                details.append({'id':row['id'],'scored':False,'reason':'No categorical neighbours'})
                continue
            theta,k,bracketed = prediction
            actual = decode(row['theta'])
            pairs = [(p,t)
                     for p,t in zip(theta,actual) if math.isfinite(p) and math.isfinite(t)]
            if not pairs:
                continue
            squared = [(delta*(p-t))**2 for p,t in pairs]
            errors.extend(squared)
            raw_errors.extend((delta*p-(row['mean_c']-definition['outdoor_temp'])*t)**2 for p,t in pairs)
            mae = abs(definition['outdoor_temp']+delta*sum(p for p,_ in pairs)/len(pairs)-row['mean_c'])
            power = abs(k-row['k'])/row['k'] if row['k'] else 0.
            means.append(mae);powers.append(power)
            details.append({'id':row['id'],'scored':True,'bracketed':bracketed,'field_rmse_c':math.sqrt(sum(squared)/len(squared)),
                            'mean_mae_c':mae,'power_relative_error':power})
        rmse = math.sqrt(sum(errors)/len(errors)) if errors else None
        power = sum(powers)/len(powers) if powers else None
        reports[split] = {'accepted':len(targets),'scored':len(means),'field_rmse_c':rmse,
                          'raw_cfd_field_rmse_c':math.sqrt(sum(raw_errors)/len(raw_errors)) if raw_errors else None,
                          'mean_temperature_mae_c':sum(means)/len(means) if means else None,
                          'mean_power_relative_error':power,'targets_met':rmse is not None and rmse<1 and power<.1,
                          'max_power_relative_error':max(powers) if powers else None,
                          'cases':details}
    return reports


def build(root):
    definition, rows, availability = accepted(root)
    presets = {t['id']:{p: project_for(t,'A',p,definition).model_dump() for p in definition['positions']} for t in definition['templates']}
    for group in presets.values():
        for project in group.values():
            project['heater']['power_w'] = 1500
    return {'version':'s1-v1','built_at':time.time(),'grid':dict(zip(('nx','ny','nz'),GRID)),
            'tolerance_m':.02,'dataset_delta_c':definition['setpoint_c']-definition['outdoor_temp'],
            'axes':{'templates':[t['id'] for t in definition['templates']], 'positions':definition['positions'],
                    'dpe':definition['training_dpe'],'u_values':U_VALUES,'ach':ACH},
            'presets':presets,'availability':availability,'cases':[r for r in rows if r['split']=='train'],
            'validation':validate(rows,definition)}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path('/data/datasets/v1'))
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    artifact=build(args.root)
    output=args.output or args.root/'s1-v1.json'
    if len(json.dumps(artifact,separators=(',',':')).encode()) > 3_000_000:
        raise ValueError('S1 artifact exceeds 3 MB')
    write_json(output,artifact)
    print(json.dumps({'output':str(output),'bytes':output.stat().st_size,'available':len(artifact['cases']),
                      'validation':artifact['validation']},indent=2))


if __name__=='__main__':
    main()
