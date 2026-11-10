from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.case import AVERAGE_START, ITERATIONS, cfd_coefficient, generate, source_boxes
from app.main import app
from app.models import Box, Project, U_VALUES
from app.queue import connect


@pytest.mark.parametrize('wall', ['N', 'S', 'E', 'W'])
def test_case(tmp_path: Path, wall):
    p = Project(exterior_wall=wall, heater={'wall': wall}, furniture=[])
    meta = generate(p, tmp_path)
    assert meta['cell_count'] <= 150000
    assert {'window', 'heater', wall} <= set(meta['patches'])
    for rel in ['system/blockMeshDict', 'system/fvSchemes', 'system/fvSolution',
                'system/controlDict', 'constant/g', 'constant/thermophysicalProperties',
                'constant/turbulenceProperties', '0/T', '0/U', '0/p', '0/p_rgh']:
        assert (tmp_path/rel).is_file()
    temperature = (tmp_path/'0/T').read_text()
    assert f'mode coefficient; h uniform {cfd_coefficient(3.5)}' in temperature
    assert 'mode power' not in temperature
    assert 'heater { type zeroGradient; }' in temperature
    assert meta['source_cell_count'] >= 4
    assert 'cellZone heaterAir; volumeMode absolute;' in (tmp_path/'system/fvOptions').read_text()
    assert f'h ({p.thermal()["effective_power_w"]} 0)' in (tmp_path/'system/fvOptions').read_text()
    assert 'source setToCellZone; set heaterAir;' in (tmp_path/'system/topoSetDict').read_text()
    assert 'type fieldAverage;' in (tmp_path/'system/controlDict').read_text()
    assert f'timeStart {AVERAGE_START}' in (tmp_path/'system/controlDict').read_text()
    assert AVERAGE_START > ITERATIONS*.6
    for box in source_boxes(p):
        assert all(0 <= lo < hi <= size for (lo, hi), size in zip(box, (p.room.length, p.room.width, p.room.height)))
    assert 'value (0 0 -9.81)' in (tmp_path/'constant/g').read_text()
    assert 'whf { type wallHeatFlux;' in (tmp_path/'system/controlDict').read_text()


def test_furniture_patches(tmp_path):
    meta = generate(Project(), tmp_path)
    assert 'furniture' in meta['patches']


def test_cfd_coefficient_guard():
    assert cfd_coefficient(3.5) == pytest.approx(1/(1/3.5-.13))
    assert cfd_coefficient(1/.13) == 50
    assert cfd_coefficient(100) == 50


def test_empty_source_zone_rejected(tmp_path):
    p = Project(furniture=[Box(x=1.3, y=3.3, z=.15, l=.8, w=.1, h=.5),
                           Box(x=1.3, y=3.4, z=.65, l=.8, w=.1, h=.1)])
    with pytest.raises(ValueError, match='空气单元'):
        generate(p, tmp_path)


def test_api_empty_source_zone(tmp_path, monkeypatch):
    monkeypatch.setattr('app.main.DATA', tmp_path)
    p = Project(furniture=[Box(x=1.3, y=3.3, z=.15, l=.8, w=.1, h=.5),
                           Box(x=1.3, y=3.4, z=.65, l=.8, w=.1, h=.1)])
    response = TestClient(app).post('/api/simulate', json=p.model_dump())
    assert response.status_code == 422
    assert '空气单元' in response.json()['detail']


def test_rejected_case_leaves_no_directory_or_job(tmp_path, monkeypatch):
    monkeypatch.setattr('app.main.DATA', tmp_path)
    monkeypatch.setattr('app.queue.DATA', tmp_path)
    existing = tmp_path/'existing'
    existing.mkdir()
    with connect() as db:
        db.execute('INSERT INTO jobs VALUES (?, ?, ?, ?, ?)', ('existing', 'done', 1, None, 0))
    project = Project(furniture=[Box(x=1.3, y=3.3, z=.15, l=.8, w=.1, h=.5),
                                 Box(x=1.3, y=3.4, z=.65, l=.8, w=.1, h=.1)])
    for _ in range(2):
        response = TestClient(app).post('/api/simulate', json=project.model_dump())
        assert response.status_code == 422
        assert '空气单元' in response.json()['detail']
        assert [path for path in tmp_path.iterdir() if path.is_dir()] == [existing]
        with connect() as db:
            assert [tuple(row) for row in db.execute('SELECT id, status FROM jobs')] == [('existing', 'done')]


def test_overlap_rejected():
    with pytest.raises(ValidationError, match='重叠'):
        Project(furniture=[Box(x=.1,y=.1,l=1,w=1,h=1), Box(x=.5,y=.5,l=1,w=1,h=1)])


@pytest.mark.parametrize('change', [
    {'window': {'width': 9}}, {'heater': {'offset': 8}},
    {'furniture': [{'x': 0, 'y': 0, 'l': 9, 'w': 1, 'h': 1}]},
    {'outdoor_temp': float('nan')}, {'heater': {'power_w': 0}},
    {'furniture': [{'x':0,'y':0,'l':.2,'w':.2,'h':.2}]*6}])
def test_invalid(change):
    with pytest.raises(ValidationError):
        Project(**change)


def test_mapping():
    assert U_VALUES['A'] == (.15, .8)
    assert U_VALUES['G'] == (2.2, 5)


def test_thermostat():
    p = Project()
    t = p.thermal()
    assert t['effective_power_w'] == pytest.approx(405.3)
    assert t['rated_power_w'] == 1500
    assert t['duty_cycle'] == pytest.approx(405.3/1500)
    assert not t['insufficient_power']
    assert Project(heater={'power_w': 100}).thermal()['insufficient_power']
    assert Project(outdoor_temp=25).thermal()['effective_power_w'] == 0


def test_api_invalid_and_unknown():
    client = TestClient(app)
    assert client.post('/api/simulate', json={'heater': {'power_w': -1}}).status_code == 422
    assert client.get('/api/jobs/missing').status_code == 404


def test_job_restores_its_project(tmp_path, monkeypatch):
    project = Project(heater={'setpoint_c': 21})
    path = tmp_path/'saved'
    path.mkdir()
    (path/'project.json').write_text(project.model_dump_json())
    monkeypatch.setattr('app.main.DATA', tmp_path)
    monkeypatch.setattr('app.main.find', lambda job_id: {'id': 'saved', 'status': 'done'})
    response = TestClient(app).get('/api/jobs/saved')
    assert response.status_code == 200
    assert response.json()['project'] == project.model_dump()
