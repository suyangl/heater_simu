import copy
from collections import Counter
from pathlib import Path

import pytest

from app.models import Project
from trainer import dataset
from trainer.build_s1 import build
from trainer.build_static_examples import build as build_examples
from trainer.dataset import summary, write_json
from trainer.doe import cases, load_definition


DEFINITION = Path(__file__).with_name('doe-random-v1.json')


def test_seeded_random_plan_validity_and_ranges():
    definition = load_definition(DEFINITION)
    plan = cases(definition)
    assert plan == cases(definition)
    changed = copy.deepcopy(definition)
    changed['seed'] += 1
    assert plan != cases(changed)
    assert Counter(c['split'] for c in plan) == {'train': 120, 'holdout': 20}
    assert len({c['id'] for c in plan}) == 140
    assert {c['dpe'] for c in plan} == set('ABCDEFG')
    assert {len(c['project']['furniture']) for c in plan} == set(range(6))
    assert {c['project']['heater']['wall'] for c in plan} == set('NSEW')
    assert any(len(c['project']['exterior_walls']) == 2 for c in plan)
    assert any(not c['project']['furniture'] for c in plan)
    for c in plan:
        p = Project.model_validate(c['project'])
        assert c['id'].startswith('rand-'+c['split']+'-')
        assert c['template'] == c['position'] == 'random'
        for key, (low, high) in definition['room'].items():
            assert low <= getattr(p.room, key) <= high
        assert p.heater.power_w == 2500 and p.heater.setpoint_c == 19
        assert (p.heater.length, p.heater.depth, p.heater.height, p.heater.z) == (.8, .1, .5, .15)
        assert 0 <= p.outdoor_temp <= 10
        assert len(p.wall_set) in (1, 2)
        if len(p.wall_set) == 2:
            assert set(p.wall_set) not in ({'N', 'S'}, {'E', 'W'})
        windows = [o for _, o in p.opening_patches() if o.type == 'window']
        doors = [o for _, o in p.opening_patches() if o.type == 'door']
        assert 1 <= len(windows) <= 2
        assert len(doors) <= 1 and all(o.wall not in p.wall_set for o in doors)
        for o in windows:
            for key, (low, high) in definition['window'].items():
                assert low <= getattr(o, key) <= high
        f = c['sampled_features']
        assert f['furniture_count'] == len(p.furniture)
        assert f['window_count'] == len(windows)
        assert f['interior_door'] == bool(doors)
        assert f['area_m2'] == p.room.length*p.room.width
        assert f['exterior_wall_count'] == len(p.wall_set)
        assert f['heater_wall'] == p.heater.wall
        assert f['outdoor_temp'] == p.outdoor_temp
        assert p.thermal()['ua_total'] > 0


def test_empty_and_bounded_failure():
    definition = load_definition(DEFINITION)
    definition['counts'] = {'train': 0, 'holdout': 0}
    assert cases(definition) == []
    definition['counts']['train'] = 1
    definition['max_attempts'] = 2
    definition['window']['height'] = [10, 11]
    with pytest.raises(ValueError, match='bounded attempts'):
        cases(definition)
    definition['max_attempts'] = 0
    with pytest.raises(ValueError, match='max_attempts'):
        cases(definition)


def test_random_cases_excluded_from_template_exports_and_skippable(tmp_path, monkeypatch):
    definition = load_definition(DEFINITION)
    definition['counts'] = {'train': 1, 'holdout': 1}
    plan = cases(definition)
    write_json(tmp_path/'manifest.json', {'definition': definition, 'cases': plan})
    for c in plan:
        directory = tmp_path/'cases'/c['id']
        directory.mkdir(parents=True)
        write_json(directory/'metadata.json', c | {'status': 'accepted', 'wall_time_s': 1})
        p = Project.model_validate(c['project'])
        write_json(directory/'result.json', {'T': {'min': 18, 'max': 20}, 'kpi': {
            'energy_balance_error': .01, 'room_average_c': 19, 'insufficient_power': False,
            'cfd_heater_power_w': p.thermal()['effective_power_w'],
            'air_density_min': 1.15, 'air_density_max': 1.25}})
    artifact = build(tmp_path)
    assert artifact['cases'] == artifact['availability'] == []
    assert artifact['validation']['train']['accepted'] == 0
    assert build_examples(tmp_path, tmp_path.parent/(tmp_path.name+'-export'))['cases'] == []
    monkeypatch.setenv('TRAIN_SKIP_TEMPLATES', 'random')
    assert summary(tmp_path, plan)['accepted'] == 2
    write_json(tmp_path/'cases'/plan[0]['id']/'metadata.json', {'status': 'pending'})
    assert summary(tmp_path, plan)['skipped'] == 1


def test_s1_mixed_plan_ignores_non_template(tmp_path):
    definition = load_definition()
    plan = cases(definition)
    random_case = cases(load_definition(DEFINITION))[0]
    write_json(tmp_path/'manifest.json', {'definition': definition, 'cases': [*plan, random_case]})
    assert len(build(tmp_path)['availability']) == 64


@pytest.mark.parametrize('outdoor', [0, 10])
def test_outdoor_temperature_thermal_and_acceptance(outdoor):
    p = Project(outdoor_temp=outdoor)
    thermal = p.thermal()
    assert thermal['effective_power_w'] == pytest.approx(thermal['ua_total']*(19-outdoor))
    result = {'T': {'min': 18, 'max': 20}, 'kpi': {
        'energy_balance_error': .01, 'room_average_c': 19, 'cfd_heater_power_w': thermal['effective_power_w'],
        'insufficient_power': False, 'air_density_min': 1.15, 'air_density_max': 1.25}}
    assert dataset.rejection(result) is None


def test_cli_selects_doe_without_running(tmp_path, monkeypatch, capsys):
    definition = load_definition(DEFINITION)
    plan = cases(definition)
    for c in plan:
        directory = tmp_path/'cases'/c['id']
        directory.mkdir(parents=True)
        write_json(directory/'metadata.json', {'status': 'pending'})
    monkeypatch.setattr('sys.argv', ['dataset', '--root', str(tmp_path), '--doe', str(DEFINITION), '--status'])
    dataset.main()
    assert '"pending": 140' in capsys.readouterr().out
