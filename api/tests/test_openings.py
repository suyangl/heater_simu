import hashlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.case import cfd_coefficient, generate
from app.main import app
from app.models import Box, Project
from trainer.doe import cases

FIXTURES = Path(__file__).parent/'fixtures'


def corner():
    return json.loads((FIXTURES/'corner_project.json').read_text())


def test_legacy_generator_byte_identical(tmp_path):
    expected = json.loads((FIXTURES/'legacy_case_sha256.json').read_text())
    projects = {'default': Project(), **{c['id']: Project.model_validate(c['project']) for c in cases()}}
    for name, project in projects.items():
        root = tmp_path/name
        generate(project, root)
        actual = hashlib.sha256(b''.join(f.relative_to(root).as_posix().encode()+b'\0'+f.read_bytes()
                                        for f in sorted(root.rglob('*')) if f.is_file())).hexdigest()
        assert actual == expected[name], name


def test_corner_geometry_thermal_and_patches(tmp_path):
    p = Project(**corner())
    assert p.thermal()['ua_total'] == pytest.approx(45.795)
    meta = generate(p, tmp_path)
    assert meta['cell_count'] <= 150000
    assert {'window_0','window_1','door_2','door_3','N','E'} <= set(meta['patches'])
    temperature = (tmp_path/'0/T').read_text()
    assert 'door_3 { type zeroGradient; }' in temperature
    assert f'door_2 {{ type externalWallHeatFluxTemperature; mode coefficient; h uniform {cfd_coefficient(1.8)};' in temperature
    assert p.loss_groups() == {'exterior_walls':['N','E'],'windows':['window_0','window_1'],'exterior_doors':['door_2']}
    p.openings[2].u_value = 2.8
    assert p.thermal()['ua_total'] == pytest.approx(47.395)


@pytest.mark.parametrize('change,message',[
    ({'exterior_walls':[]}, 'at least 1'),
    ({'exterior_walls':['N','N']}, '不能重复'),
    ({'openings':[{'wall':'S'}]}, '只能位于外墙'),
    ({'openings':[{'width':9}]}, '超出墙面'),
    ({'openings':[{'type':'door','sill':.1}]}, '必须为 0'),
    ({'openings':[{},{}]}, '重叠'),
    ({'openings':[{'type':'door','sill':0,'u_value':0}]}, 'greater than 0'),
    ({'openings':[{'type':'door','wall':'N','offset':1.3,'sill':0}]}, '遮挡门窗'),
])
def test_invalid_openings(change,message):
    with pytest.raises(ValidationError,match=message):
        Project(**change)
    response = TestClient(app).post('/api/simulate',json=change)
    assert response.status_code == 422
    assert message in response.text


def test_empty_openings_and_interior_door(tmp_path):
    p = Project(exterior_walls=['N','E'],openings=[],furniture=[])
    assert generate(p,tmp_path)['patches'] == ['N','S','E','W','floor','ceiling','heater']
    assert p.loss_groups()['windows'] == []
    assert Project(openings=[{'type':'door','wall':'S','sill':0}],furniture=[]).loss_patches() == {'N'}


def test_fifteen_boxes_and_label_only_physics(tmp_path):
    boxes = [Box(x=.1+(i%5)*.7,y=.1+(i//5)*.8,l=.3,w=.3,h=.4,kind='椅',name=f'椅子 {i}') for i in range(15)]
    p = Project(furniture=boxes)
    meta = generate(p,tmp_path/'named')
    plain = Project(furniture=[Box(**{k:v for k,v in b.model_dump().items() if k not in ('kind','name')}) for b in boxes])
    generate(plain,tmp_path/'plain')
    assert meta['cell_count'] <= 150000
    for f in (tmp_path/'named').rglob('*'):
        if f.is_file() and f.name != 'project.json':
            assert f.read_bytes() == (tmp_path/'plain'/f.relative_to(tmp_path/'named')).read_bytes()
    with pytest.raises(ValidationError,match='at most 15'):
        Project(furniture=[*boxes,boxes[0]])


def test_fully_glazed_wall_uses_only_active_opaque_loss_patches(tmp_path):
    p = Project(exterior_walls=['N','E'],openings=[{'wall':'N','offset':0,'width':4,'height':2.5,'sill':0}],
                heater={'wall':'S'},furniture=[])
    meta = generate(p,tmp_path)
    assert 'N' not in meta['patches']
    assert p.loss_groups(meta['patches']) == {'exterior_walls':['E'],'windows':['window_0'],'exterior_doors':[]}


def test_irreducible_mesh_size_is_rejected_before_building_blocks(tmp_path):
    boxes = [Box(x=.1+(i%5)*.7+.004*i,y=.1+(i//5)*.8+.003*i,z=.05+.015*i,
                 l=.25+.003*i,w=.25+.002*i,h=.23+.004*i) for i in range(15)]
    openings = [{'wall':wall,'offset':.1+.4*i,'width':.21+.001*(j*6+i),'height':.21,
                 'sill':1+.01*(j*6+i)} for j,wall in enumerate(('N','S','E','W')) for i in range(6)]
    p = Project(exterior_walls=['N','S','E','W'],openings=openings,furniture=boxes)
    with pytest.raises(ValueError,match='几何分割过多'):
        generate(p,tmp_path)
