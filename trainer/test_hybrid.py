import json

import numpy as np
import pytest

from app.models import Project
from trainer.build_hybrid import accepted, build, train, validate
from trainer.dataset import write_json
from trainer.hybrid import context, features, fit, intersects, regress
from trainer.test_s1 import result


def row(group, split='train', offset=0):
    x = np.array([features(Project(), (1, 1, z)) for z in (.2, .8, 1.4)])
    return dict(id=group, group=group, split=split, x=x, y=np.array([-.1, 0, .1])+offset,
                c=context(Project())[2], k=.7, delta=14)


def test_features_no_windows_shadow_and_ridge():
    p = Project(openings=[], furniture=[])
    f = features(p, (1, 1, 1))
    assert len(f) == 28 and np.isfinite(f).all()
    assert f[5:7] == [0, 0] and f[8] == 0
    box = Project().furniture[0]
    assert intersects((0, .5, .2), (3, .5, .2), box)
    assert not intersects((0, 3, .2), (3, 3, .2), box)
    model = fit([[0, 1], [1, 1], [2, 1]], [1, 2, 3], .0001)
    assert regress(model, [1, 1]) == pytest.approx(2)
    with pytest.raises(ValueError, match='nonempty'):
        fit([], [], 1)
    with pytest.raises(ValueError, match='finite'):
        fit([[float('nan')]], [1], 1)


def test_training_excludes_holdouts_and_cv_restandardizes():
    rows = [row('a'), row('b'), row('held', 'holdout', 5)]
    artifact = build(rows)
    assert artifact['field'] == train(rows[:2])['field']
    report = artifact['validation']
    assert report['grouped_cv']['cases'] == 2
    assert report['holdout']['cases'] == 1
    assert report['holdout']['field_rmse_c'] > 60
    assert validate([row('only')])['grouped_cv']['cases'] == 0
    with pytest.raises(ValueError, match='No accepted'):
        build([])


def test_read_only_multiroot_random_and_setpoint_normalization(tmp_path):
    roots = [tmp_path/'template', tmp_path/'random']
    for index, root in enumerate(roots):
        root.mkdir()
        p = Project(outdoor_temp=index*5)
        case = dict(id=str(index), project=p.model_dump(), split='train', template='random' if index else 'bedroom', position='under_window')
        write_json(root/'manifest.json', {'cases': [case]})
        directory = root/'cases'/case['id']
        directory.mkdir(parents=True)
        write_json(directory/'metadata.json', case | {'status': 'accepted'})
        output = result(p)
        output['kpi']['room_average_c'] = 18.8
        output['T']['min'] = 18.8
        write_json(directory/'result.json', output)
    before = {str(p): p.read_bytes() for root in roots for p in root.rglob('*') if p.is_file()}
    rows = accepted(roots)
    assert len(rows) == 2
    assert rows[0]['group'] == 'bedroom:under_window'
    assert rows[1]['group'].endswith(':1')
    assert rows[1]['random'] and not rows[0]['random']
    assert rows[0]['y'] == pytest.approx(np.zeros(len(rows[0]['y'])), abs=1e-6)
    assert before == {str(p): p.read_bytes() for root in roots for p in root.rglob('*') if p.is_file()}
    with pytest.raises(ValueError, match='Duplicate'):
        accepted([roots[0], roots[0]])
    write_json(roots[0]/'cases/0/metadata.json', {'status': 'pending'})
    assert accepted([roots[0]]) == []


def test_final_comparison_and_quick_mode(monkeypatch):
    from trainer import validate_hybrid as evaluation
    rows = [row('a'), row('b'), row('held', 'holdout')]
    for item in rows:
        item.update(random=True, project=Project().model_dump())
    old = train(rows[:2])
    old['grid'] = dict(nx=24, ny=20, nz=12)
    report = evaluation.comparison(rows, old)
    assert report['validation']['grouped_cv_random']['cases'] == 2
    assert report['old']['holdout']['cases'] == report['new']['holdout']['cases'] == 1
    assert report['new']['window_cooling']['pairs'] > 0
    reading = report['old']['window_cooling']['readings'][0]
    assert reading['side_minus_interior_c'] == pytest.approx(reading['side_c']-reading['interior_c'])
    monkeypatch.setattr(evaluation, 'train', lambda _: pytest.fail('quick mode must not train'))
    monkeypatch.setattr(evaluation, 'validate', lambda _: pytest.fail('quick mode must not run CV'))
    assert 'new' not in evaluation.comparison(rows, old, quick=True)
    assert evaluation.comparison([], old, quick=True)['old']['holdout']['cases'] == 0
    assert evaluation.window_readings(old, [])['pairs'] == 0
    rows[0]['project']['openings'] = []
    assert evaluation.window_readings(old, rows[:1])['pairs'] == 0
    with pytest.raises(KeyError):
        evaluation.comparison(rows, {}, quick=True)


def test_parity_fixture_generated_by_python():
    from pathlib import Path
    fixture = json.loads((Path(__file__).resolve().parents[1]/'frontend/src/hybrid-fixture.json').read_text())
    for sample in fixture['samples']:
        p = Project.model_validate(sample['project'])
        vector = features(p, sample['point'])
        assert vector == pytest.approx(sample['features'], abs=1e-12)
        assert 1+regress(fixture['model']['field'], vector) == pytest.approx(sample['theta'])
