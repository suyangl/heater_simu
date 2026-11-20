import argparse
import json
import hashlib
from pathlib import Path

import numpy as np

from app.models import Project
from trainer.build_hybrid import accepted, metrics, score, train, validate
from trainer.hybrid import features, opening_center, regress
from trainer.build_s1 import GRID


def random_case(row):
    return row.get('random', False)


def window_regression(model):
    fixture = json.loads(Path(__file__).with_name('window-cooling-regression.json').read_text())
    p = Project.model_validate(fixture['project'])
    dims = np.array(GRID)
    spacing = np.array([p.room.length, p.room.width, p.room.height])/dims
    temperatures = []
    for name in ('side', 'interior'):
        q = np.array(fixture[name])/spacing-.5
        low = np.floor(q).astype(int)
        fraction = q-low
        temperature = 0.
        for i in range(8):
            bits = np.array([(i >> axis) & 1 for axis in range(3)])
            point = (low+bits+.5)*spacing
            value = np.float32(p.outdoor_temp+(p.heater.setpoint_c-p.outdoor_temp)*
                               (1+float(regress(model['field'], features(p, point)))))
            temperature += float(value)*float(np.prod(np.where(bits, fraction, 1-fraction)))
        temperatures.append(temperature)
    return dict(side_c=temperatures[0], interior_c=temperatures[1],
                side_minus_interior_c=temperatures[0]-temperatures[1],
                cooler=temperatures[0] < temperatures[1], side_point=fixture['side'], interior_point=fixture['interior'])


def window_readings(model, rows):
    readings = []
    for row in rows:
        p = Project.model_validate(row['project'])
        r = p.room
        z = min(1.6, r.height*.9)
        for index, (_, opening) in enumerate(p.opening_patches()):
            if opening.type != 'window':
                continue
            x, y, _ = opening_center(p, opening)
            side = {'N': (x, r.width-.3, z), 'S': (x, .3, z),
                    'E': (r.length-.3, y, z), 'W': (.3, y, z)}[opening.wall]
            interior = (r.length/2, r.width/2, z)
            boxes = [*p.furniture, p.heater.box(r)]
            if any(all(lo <= v <= hi for v, (lo, hi) in zip(point, box.bounds()))
                   for point in (side, interior) for box in boxes):
                continue
            temperatures = [p.outdoor_temp+row['delta']*(1+float(regress(model['field'], features(p, point))))
                            for point in (side, interior)]
            readings.append(dict(id=row['id'], split=row['split'], window=index, side_point=side,
                                 interior_point=interior, side_c=temperatures[0], interior_c=temperatures[1],
                                 side_minus_interior_c=temperatures[0]-temperatures[1]))
    differences = [r['side_minus_interior_c'] for r in readings]
    return dict(pairs=len(readings), warmer_pairs=sum(d > 0 for d in differences),
                mean_side_minus_interior_c=float(np.mean(differences)) if differences else None,
                readings=readings)


def comparison(rows, old, quick=False):
    random = [r for r in rows if random_case(r)]
    models = {'old': old}
    report = {}
    if not quick:
        report['validation'] = validate(rows)
        templates = [r for r in rows if not random_case(r)]
        report['old_template_validation'] = validate(templates) if templates else None
        models['new'] = train([r for r in rows if r['split'] == 'train'])
    for name, model in models.items():
        report[name] = {split: metrics([score(model, r) for r in random if r['split'] == split])
                        for split in ('train', 'holdout')}
        report[name]['window_cooling'] = window_readings(model, random)
        report[name]['window_regression'] = window_regression(model)
    report['notes'] = ['Power errors are fractions; multiply by 100 for percent.',
                       'Old model random-train score is external evaluation; new random-train score is in-sample, not CV.',
                       'Window check: 1.6 m head height, 0.3 m inward from window centre versus room centre; solids skipped. Geometric diagnostic, not a universal physical constraint.']
    return report


def main():
    parser = argparse.ArgumentParser(description='Grouped leave-one-group-out and independent holdout hybrid validation')
    parser.add_argument('--root', type=Path, action='append', required=True)
    parser.add_argument('--old-model', type=Path)
    parser.add_argument('--quick', action='store_true', help='Old-model scoring only; no fitting or CV')
    args = parser.parse_args()
    if args.quick and not args.old_model:
        parser.error('--quick requires --old-model')
    rows = accepted(args.root)
    if args.old_model:
        raw = args.old_model.read_bytes()
        report = comparison(rows, json.loads(raw), args.quick)
        report['old_model_sha256'] = hashlib.sha256(raw).hexdigest()
    else:
        report = validate(rows)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
