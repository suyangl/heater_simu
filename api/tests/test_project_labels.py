import json

import pytest
from fastapi.testclient import TestClient

from app.case import generate
from app.main import app
from app.models import Project
from app.project_labels import KINDS, solver_project, user_project


@pytest.mark.parametrize('key,label', KINDS.items())
def test_kind_wire_adapter(key, label):
    data = Project().model_dump()
    data['furniture'][0]['kind'] = key
    normalized = solver_project(data)
    assert normalized['furniture'][0]['kind'] == label
    assert data['furniture'][0]['kind'] == key
    assert user_project(normalized) == data
    assert Project.model_validate(normalized).furniture[0].kind == label


def test_omitted_furniture_keeps_solver_defaults():
    assert solver_project({}) == {}
    assert Project.model_validate(solver_project({})).furniture == Project().furniture
    assert solver_project(None) is None
    assert solver_project({'furniture': None}) == {'furniture': None}


def test_saved_kind_keys_and_unchanged_solver_case(tmp_path, monkeypatch):
    monkeypatch.setattr('app.main.DATA', tmp_path)
    monkeypatch.setattr('app.queue.DATA', tmp_path)
    data = Project().model_dump()
    data['furniture'][0].update(kind='bed', name='My bed')
    client = TestClient(app)
    response = client.post('/api/simulate', json=data)
    assert response.status_code == 202, response.text
    job = response.json()['job_id']
    path = tmp_path/job
    assert json.loads((path/'user_project.json').read_text())['furniture'][0]['kind'] == 'bed'
    assert json.loads((path/'project.json').read_text())['furniture'][0]['kind'] == '床'
    assert client.get('/api/jobs/'+job).json()['project']['furniture'][0]['kind'] == 'bed'
    reference = tmp_path/'reference'
    generate(Project.model_validate(solver_project(data)), reference)
    for field in reference.rglob('*'):
        if field.is_file():
            assert (path/field.relative_to(reference)).read_bytes() == field.read_bytes()
    (path/'user_project.json').unlink()
    assert client.get('/api/jobs/'+job).json()['project']['furniture'][0]['kind'] == 'bed'
    data['furniture'][0]['kind'] = 'invalid'
    assert client.post('/api/simulate', json=data).status_code == 422
