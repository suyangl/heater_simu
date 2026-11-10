import json

import pytest

from trainer.build_static_examples import build, compact_result


def result():
    surface = dict(positions='xyz', indices='ijk', T='temperature', speed='speed',
                   name='floor', level_c=19, vertex_count=100)
    return dict(grid={'nx': 2}, T=dict(data='air', min=18, max=20, mean=19, dtype='float32'),
                U=dict(data='unused speed grid', min=0, max=.2), surfaces=[surface],
                streamlines=dict(positions='p', indices='i', offsets='o', speed='s', T='t', line_count=1),
                isosurface=surface, temperature_range=[18, 20],
                kpi=dict(room_average_c=19, heat_loss_w=100, thermostat_history=['large unused history']))


def test_compact_visualization_keeps_air_and_real_geometry_without_unused_arrays():
    original = result()
    compact = compact_result(original)
    assert compact['T']['data'] == 'air'
    assert compact['surfaces'][0]['T'] == 'temperature'
    assert compact['surfaces'][0]['positions'] == 'xyz'
    assert compact['isosurface']['speed'] == 'speed'
    assert compact['streamlines']['line_count'] == 1
    assert compact['U'] == dict(data='', min=0, max=.2)
    assert 'thermostat_history' not in compact['kpi']
    assert 'vertex_count' not in compact['surfaces'][0]
    assert original['U']['data'] == 'unused speed grid'


def test_exports_accepted_only_with_small_index_and_does_not_modify_dataset(tmp_path):
    root, output = tmp_path/'dataset', tmp_path/'public'
    for name, status in [('accepted-case', 'accepted'), ('pending-case', 'running'), ('bad-case', 'rejected')]:
        case = root/'cases'/name
        case.mkdir(parents=True)
        metadata = dict(id=name, status=status, template='bedroom_small', dpe='A', position='under_window',
                        project=dict(heater=dict(setpoint_c=19), outdoor_temp=5))
        (case/'metadata.json').write_text(json.dumps(metadata))
        (case/'result.json').write_text(json.dumps(result()))
    before = {str(p): p.read_bytes() for p in root.rglob('*') if p.is_file()}
    index = build(root, output)
    assert [case['id'] for case in index['cases']] == ['accepted-case']
    assert index['cases'][0]['setpoint_c'] == 19
    assert index['cases'][0]['outdoor_temp'] == 5
    assert sorted(p.name for p in output.iterdir()) == ['accepted-case.json', 'index.json']
    assert json.loads((output/'accepted-case.json').read_text())['source'] == 'openfoam'
    assert before == {str(p): p.read_bytes() for p in root.rglob('*') if p.is_file()}


def test_empty_export_and_reject_output_inside_dataset(tmp_path):
    assert build(tmp_path/'empty', tmp_path/'public')['cases'] == []
    with pytest.raises(ValueError, match='read-only'):
        build(tmp_path/'dataset', tmp_path/'dataset'/'public')


def test_accepted_missing_result_is_reported_not_silently_skipped(tmp_path):
    case = tmp_path/'dataset'/'cases'/'missing'
    case.mkdir(parents=True)
    (case/'metadata.json').write_text(json.dumps(dict(id='missing', status='accepted')))
    with pytest.raises(FileNotFoundError):
        build(tmp_path/'dataset', tmp_path/'public')
