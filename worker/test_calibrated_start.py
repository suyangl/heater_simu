import json
from unittest.mock import patch

import numpy as np
import pytest

from app.models import Project
from trainer import hybrid
from trainer.dataset import training_policy
from runner import initial_thermostat_power, solve_thermostat


@pytest.fixture
def calibrated(monkeypatch):
    monkeypatch.setenv('THERMOSTAT_CALIBRATED_START', '1')


def test_disabled_and_nonsettled_keep_analytic_power(monkeypatch):
    p = Project()
    monkeypatch.delenv('THERMOSTAT_CALIBRATED_START', raising=False)
    assert initial_thermostat_power(p, True) == p.thermal()['effective_power_w']
    monkeypatch.setenv('THERMOSTAT_CALIBRATED_START', '1')
    monkeypatch.setenv('THERMOSTAT_POWER_MODEL', '/nonexistent/model.json')
    assert initial_thermostat_power(p, False) == p.thermal()['effective_power_w']


def test_real_ridge_matches_shared_prediction(calibrated):
    p = Project()
    expected_k = np.exp(hybrid.regress(hybrid.load_power_model(), hybrid.context(p)[2]))
    demand = p.thermal()['ua_total']*(p.heater.setpoint_c-p.outdoor_temp)
    assert initial_thermostat_power(p, True) == pytest.approx(min(p.heater.power_w, expected_k*demand))


@pytest.mark.parametrize('intercept', [1000., -1000., np.log(.1)])
def test_positive_clamp_and_calibration_before_rated_cap(calibrated, intercept):
    p = Project(heater={'power_w': 10})
    model = dict(mean=[0]*10, std=[1]*10, coef=[0]*10, intercept=intercept)
    with patch('runner.load_power_model', return_value=model):
        power = initial_thermostat_power(p, True)
    assert 0 < power <= 10
    if intercept == np.log(.1):
        assert power == 10


@pytest.mark.parametrize('outdoor', [19, 25])
def test_no_heating_stays_zero_without_loading_model(calibrated, monkeypatch, outdoor):
    monkeypatch.setenv('THERMOSTAT_POWER_MODEL', '/nonexistent/model.json')
    assert initial_thermostat_power(Project(outdoor_temp=outdoor), True) == 0


def test_missing_model_is_explicit(calibrated, monkeypatch):
    monkeypatch.setenv('THERMOSTAT_POWER_MODEL', '/nonexistent/model.json')
    with pytest.raises(FileNotFoundError):
        initial_thermostat_power(Project(), True)


@pytest.mark.parametrize('corruption', ['empty', 'version', 'names', 'std', 'coef', 'intercept'])
def test_invalid_model_is_rejected(calibrated, monkeypatch, tmp_path, corruption):
    model = json.loads(hybrid.power_model_path().read_text())
    if corruption == 'empty':
        model = {}
    elif corruption == 'version':
        model['version'] = 'unknown'
    elif corruption == 'names':
        model['case_names'] = []
    elif corruption == 'std':
        model['power']['std'][0] = 0
    elif corruption == 'coef':
        model['power']['coef'] = []
    else:
        model['power']['intercept'] = float('nan')
    path = tmp_path/'model.json'
    path.write_text(json.dumps(model))
    monkeypatch.setenv('THERMOSTAT_POWER_MODEL', str(path))
    with pytest.raises(ValueError):
        initial_thermostat_power(Project(), True)


def test_policy_records_model_and_features_only_when_enabled(monkeypatch, tmp_path):
    monkeypatch.delenv('THERMOSTAT_CALIBRATED_START', raising=False)
    assert 'initial_power' not in training_policy()
    monkeypatch.setenv('THERMOSTAT_CALIBRATED_START', '1')
    first = training_policy()['initial_power']
    assert first['mode'] == 'hybrid-v1'
    assert len(first['features_sha256']) == 64
    model = json.loads(hybrid.power_model_path().read_text())
    model['power']['intercept'] += .01
    path = tmp_path/'model.json'
    path.write_text(json.dumps(model))
    monkeypatch.setenv('THERMOSTAT_POWER_MODEL', str(path))
    assert training_policy()['initial_power']['model_sha256'] != first['model_sha256']


def test_shared_settled_dispatch_receives_calibrated_power(calibrated, tmp_path):
    p = Project()
    (tmp_path/'project.json').write_text(p.model_dump_json())
    (tmp_path/'case_meta.json').write_text('{}')
    with patch('runner.settled_control', side_effect=RuntimeError('dispatch reached')) as control:
        with pytest.raises(RuntimeError, match='dispatch reached'):
            solve_thermostat(tmp_path, 1, settled=True)
    assert control.call_args.args[1] == pytest.approx(initial_thermostat_power(p, True))
