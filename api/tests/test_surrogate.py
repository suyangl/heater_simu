import json

from fastapi.testclient import TestClient

from app.main import app


def test_surrogate_missing(tmp_path,monkeypatch):
    monkeypatch.setattr('app.main.DATA',tmp_path)
    client=TestClient(app)
    assert client.get('/api/surrogate/manifest').json()['available'] is False
    assert client.get('/api/surrogate/artifact').status_code==404


def test_surrogate_manifest_and_file(tmp_path,monkeypatch):
    monkeypatch.setattr('app.main.DATA',tmp_path)
    path=tmp_path/'datasets/v1/s1-v1.json';path.parent.mkdir(parents=True)
    artifact={'version':'s1-v1','cases':[],'axes':{},'availability':[], 'validation':{},'built_at':1}
    path.write_text(json.dumps(artifact))
    client=TestClient(app)
    response=client.get('/api/surrogate/manifest')
    assert response.status_code==200 and response.json()['cases']==0
    assert client.get('/api/surrogate/artifact').json()==artifact
    path.write_text('{')
    assert client.get('/api/surrogate/manifest').status_code==503
