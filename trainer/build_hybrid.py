"""Read-only multi-root hybrid training and grouped validation."""
import argparse
import itertools
import json
import math
from pathlib import Path

import numpy as np

from app.models import ACH, U_VALUES, Project
from trainer.build_s1 import GRID, normalized_field
from trainer.dataset import complete, read_json, write_json
from trainer.doe import cases, load_definition
from trainer.hybrid import CASE_NAMES, FEATURE_NAMES, context, features, fit, regress


def accepted(roots):
    rows, seen = [], set()
    for root in roots:
        root = Path(root)
        manifest = read_json(root/'manifest.json')
        for case in manifest.get('cases', []):
            directory = root/'cases'/case['id']
            record = read_json(directory/'metadata.json')
            if not complete(directory, record):
                continue
            if record.get('project') != case['project']:
                raise ValueError(f'Accepted project differs from manifest: {directory}')
            key = json.dumps(case['project'], sort_keys=True)
            if key in seen:
                raise ValueError('Duplicate project across dataset roots; avoid train/holdout leakage')
            seen.add(key)
            if case['split'] not in ('train', 'holdout'):
                raise ValueError('Unknown split')
            p = Project.model_validate(case['project'])
            result = read_json(directory/'result.json')
            delta = p.heater.setpoint_c-p.outdoor_temp
            k = result['kpi']['cfd_heater_power_w']/(p.thermal()['ua_total']*delta) if delta > 0 else 0
            if not math.isfinite(k) or k <= 0:
                raise ValueError('Hybrid requires positive heating rise and power')
            # S1 normalizes by measured mean rise; restore the requested setpoint normalization.
            theta = np.asarray(normalized_field(result, p))*(result['kpi']['room_average_c']-p.outdoor_temp)/delta
            prepared = context(p)
            points = [((i+.5)*p.room.length/GRID[0], (j+.5)*p.room.width/GRID[1], (z+.5)*p.room.height/GRID[2])
                      for z, j, i in itertools.product(range(GRID[2]), range(GRID[1]), range(GRID[0]))]
            valid = np.isfinite(theta)
            if not valid.any():
                raise ValueError('Hybrid case has no valid air points')
            x = np.asarray([features(p, point, prepared) for point, keep in zip(points, valid) if keep])
            group = str(root.resolve())+':'+case['id'] if case['template'] == 'random' else case['template']+':'+case['position']
            rows.append(dict(id=case['id'], split=case['split'], group=group, random=case['template'] == 'random', project=p.model_dump(),
                             x=x, y=theta[valid]-1, c=prepared[2], k=k, delta=delta))
    return rows


def train(rows):
    if not rows:
        raise ValueError('No accepted training cases')
    return dict(field=fit(np.concatenate([r['x'] for r in rows]), np.concatenate([r['y'] for r in rows]), 100),
                power=fit([r['c'] for r in rows], np.log([r['k'] for r in rows]), 1))


def metrics(predictions):
    if not predictions:
        return dict(cases=0, field_rmse_c=None, mean_power_relative_error=None, max_power_relative_error=None)
    return dict(cases=len(predictions), field_rmse_c=float(np.sqrt(sum(s for s, _, _ in predictions)/sum(n for _, n, _ in predictions))),
                mean_power_relative_error=float(np.mean([p for _, _, p in predictions])),
                max_power_relative_error=float(max(p for _, _, p in predictions)))


def score(model, row, baseline_mean=None):
    residual = np.full(len(row['y']), baseline_mean) if baseline_mean is not None else regress(model['field'], row['x'])
    k = 1 if baseline_mean is not None else math.exp(float(regress(model['power'], row['c'])))
    return float(np.sum(((residual-row['y'])*row['delta'])**2)), len(residual), abs(k-row['k'])/row['k']


def validate(rows):
    training = [r for r in rows if r['split'] == 'train']
    model = train(training)
    cv, base_cv, random_cv, template_cv = [], [], [], []
    for group in sorted({r['group'] for r in training}):
        fit_rows = [r for r in training if r['group'] != group]
        if not fit_rows:
            continue
        fold = train(fit_rows)
        mean = float(np.concatenate([r['y'] for r in fit_rows]).mean())
        for row in training:
            if row['group'] == group:
                cv.append(score(fold, row))
                if row.get('random', False):
                    random_cv.append(cv[-1])
                else:
                    template_cv.append(cv[-1])
                base_cv.append(score(fold, row, mean))
    holdout = [r for r in rows if r['split'] == 'holdout']
    mean = float(np.concatenate([r['y'] for r in training]).mean())
    return dict(grouped_cv=metrics(cv), grouped_cv_random=metrics(random_cv),
                grouped_cv_template=metrics(template_cv), grouped_cv_baseline=metrics(base_cv),
                holdout=metrics([score(model, r) for r in holdout]),
                holdout_baseline=metrics([score(model, r, mean) for r in holdout]))


def build(rows):
    model = train([r for r in rows if r['split'] == 'train'])
    return dict(version='hybrid-v1', grid=dict(zip(('nx', 'ny', 'nz'), GRID)),
                feature_names=FEATURE_NAMES, case_names=CASE_NAMES, u_values=U_VALUES, ach=ACH,
                **model, training_cases=sum(r['split'] == 'train' for r in rows), validation=validate(rows))


def fixture(artifact, rows):
    samples = []
    definition = load_definition(Path(__file__).with_name('doe-random-v1.json'))
    definition['counts'] = {'train': 2, 'holdout': 0}
    projects = [Project.model_validate(row['project']) for row in rows[:3]]
    projects.extend(Project.model_validate(row['project']) for row in cases(definition))
    projects.append(Project(openings=[], furniture=[]))
    for p in projects:
        for point in [(p.room.length*.3, p.room.width*.7, .2), (p.room.length*.8, .2, p.room.height*.8)]:
            vector = features(p, point)
            samples.append(dict(project=p.model_dump(), point=point, features=vector, case_features=context(p)[2],
                                theta=1+float(regress(artifact['field'], vector)),
                                k=math.exp(float(regress(artifact['power'], context(p)[2]))), ua=p.thermal()['ua_total']))
    return dict(model=artifact, samples=samples)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, action='append', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--fixture', type=Path)
    args = parser.parse_args()
    if any(args.output.resolve().is_relative_to(root.resolve()) or
           args.fixture and args.fixture.resolve().is_relative_to(root.resolve()) for root in args.root):
        parser.error('Outputs must be outside read-only dataset roots')
    rows = accepted(args.root)
    artifact = build(rows)
    if len(json.dumps(artifact).encode()) >= 50000:
        raise ValueError('Hybrid artifact exceeds 50 kB')
    write_json(args.output, artifact)
    if args.fixture:
        write_json(args.fixture, fixture(artifact, rows))
    print(json.dumps(dict(bytes=args.output.stat().st_size, training_cases=artifact['training_cases'], validation=artifact['validation']), indent=2))


if __name__ == '__main__':
    main()
