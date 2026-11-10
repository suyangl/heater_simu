import copy
import json

import pytest

from app.case import generate
from app.models import Project
from trainer.dataset import complete, prepare, rejection, run_case, summary, write_json
from trainer.doe import cases, load_definition, project_for


def valid_result():
    return {'T': {'min': 16, 'max': 26}, 'kpi': {
        'energy_balance_error': .02, 'room_average_c': 19.1, 'cfd_heater_power_w': 100,
        'insufficient_power': False, 'air_density_min': 1.15, 'air_density_max': 1.25,
        'solve_wall_time_s': 200, 'cell_count': 70000}}


def test_doe_count_splits_and_reproducibility():
    plan = cases()
    assert plan == cases()
    assert len(plan) == len({case['id'] for case in plan}) == 70
    assert sum(case['split'] == 'train' for case in plan) == 64
    assert {case['dpe'] for case in plan if case['split'] == 'train'} == set('ACEG')
    assert {case['dpe'] for case in plan if case['split'] == 'holdout'} == set('BDF')
    assert all(sum(case['dpe'] == d and case['split'] == 'holdout' for case in plan) == 2 for d in 'BDF')
    for case in plan:
        project = Project.model_validate(case['project'])
        assert project.outdoor_temp == 5
        assert project.heater.setpoint_c == 19
        assert project.heater.power_w == 2500


@pytest.mark.parametrize('template', load_definition()['templates'], ids=lambda t: t['id'])
@pytest.mark.parametrize('position', load_definition()['positions'])
def test_template_positions_generate_valid_mesh(tmp_path, template, position):
    project = project_for(template, 'E', position, load_definition())
    meta = generate(project, tmp_path)
    assert 4 <= meta['source_cell_count']
    assert meta['cell_count'] <= 150000


def test_unknown_position_rejected():
    definition = load_definition()
    with pytest.raises(ValueError, match='Unknown heater position'):
        project_for(definition['templates'][0], 'A', 'typo', definition)


@pytest.mark.parametrize('field,value', [('energy_balance_error', .101), ('room_average_c', 19.501),
                                       ('room_average_c', 18.499), ('insufficient_power', True),
                                       ('cfd_heater_power_w', -1), ('air_density_min', .3),
                                       ('energy_balance_error', float('nan'))])
def test_quality_rejects_invalid_results(field, value):
    result = valid_result()
    result['kpi'][field] = value
    assert rejection(result)


def test_quality_boundaries_and_missing_metrics():
    result = valid_result()
    result['kpi'].update(energy_balance_error=.1, room_average_c=19.5)
    assert rejection(result) is None
    assert rejection({})


def test_resume_skips_valid_completed_case(tmp_path):
    case = cases()[0]
    calls = []
    def execute(work, project):
        calls.append(project)
        return valid_result()
    first = run_case(tmp_path, case, execute)
    assert first['status'] == 'accepted'
    assert first['required_power_w'] == 100
    assert not (tmp_path/'cases'/case['id']/'work').exists()
    assert run_case(tmp_path, case, execute) == first
    assert len(calls) == 1
    assert summary(tmp_path, [case])['accepted'] == 1


def test_failure_retried_once_then_resumable_skip(tmp_path):
    case = cases()[0]
    calls = []
    def execute(work, project):
        calls.append(1)
        raise RuntimeError('solver failed')
    result = run_case(tmp_path, case, execute)
    assert result['status'] == 'failed' and result['attempts'] == 2
    assert 'solver failed' in result['error']
    run_case(tmp_path, case, execute)
    assert len(calls) == 2
    directory = tmp_path/'cases'/case['id']
    assert (directory/'attempt-1-error.txt').exists()
    assert (directory/'attempt-2.json').exists()


def test_transient_failure_can_recover(tmp_path):
    calls = []
    def execute(work, project):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError('temporary failure')
        return valid_result()
    record = run_case(tmp_path, cases()[0], execute)
    assert record['status'] == 'accepted' and record['attempts'] == 2


def test_rejected_quality_never_included_and_retry_bounded(tmp_path):
    bad = valid_result()
    bad['kpi']['energy_balance_error'] = .5
    case = cases()[0]
    result = run_case(tmp_path, case, lambda *_: bad)
    assert result['status'] == 'rejected' and result['attempts'] == 2
    assert not complete(tmp_path/'cases'/case['id'], result)
    assert summary(tmp_path, [case])['accepted'] == 0


def test_interrupted_attempt_restarts_cleanly(tmp_path):
    case = cases()[0]
    directory = tmp_path/'cases'/case['id']
    (directory/'work').mkdir(parents=True)
    (directory/'work'/'stale-field').touch()
    write_json(directory/'metadata.json', {'status': 'running', 'attempts': 1})
    def execute(work, project):
        assert not (work/'stale-field').exists()
        return valid_result()
    result = run_case(tmp_path, case, execute)
    assert result['status'] == 'accepted' and result['attempts'] == 2
    assert 'interrupted' in json.loads((directory/'attempt-1.json').read_text())['error']


@pytest.mark.parametrize('contents', [None, '{invalid json'])
def test_missing_or_corrupt_result_not_skipped(tmp_path, contents):
    case = cases()[0]
    directory = tmp_path/'cases'/case['id']
    directory.mkdir(parents=True)
    write_json(directory/'metadata.json', {'status': 'accepted', 'attempts': 1})
    if contents:
        (directory/'result.json').write_text(contents)
    assert run_case(tmp_path, case, lambda *_: valid_result())['attempts'] == 2


def test_exhausted_interrupted_attempt_recorded_failed(tmp_path):
    case = cases()[0]
    directory = tmp_path/'cases'/case['id']
    directory.mkdir(parents=True)
    write_json(directory/'metadata.json', {'status': 'running', 'attempts': 2})
    record = run_case(tmp_path, case, lambda *_: pytest.fail('must not run'))
    assert record['status'] == 'failed'


def test_manifest_refuses_changed_definition(tmp_path):
    definition = load_definition()
    plan = cases(definition)
    prepare(tmp_path, definition, plan)
    prepare(tmp_path, definition, plan)
    changed = copy.deepcopy(definition)
    changed['outdoor_temp'] = 0
    with pytest.raises(ValueError, match='manifest differs'):
        prepare(tmp_path, changed, plan)
