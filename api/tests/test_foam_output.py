import os
from pathlib import Path

import pytest

from app.foam_output import wall_heat_flux


def output(path: Path, time, rows, name='wallHeatFlux.dat'):
    file = path/'postProcessing'/'whf'/str(time)/name
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text('# Time patch min max integral\n'+rows)
    return file


def test_flux_latest_complete_sample(tmp_path):
    output(tmp_path, 0, '1 heater 10 20 400\n1 N -5 -1 -300\n1 window -5 -1 -90\n')
    output(tmp_path, 2, '2 heater 10 20 401\n2 N -5 -1 -305\n2 window -5 -1 -96\n3 heater 10 20 402\n')
    time, flux = wall_heat_flux(tmp_path, {'heater', 'N', 'window'})
    assert time == 2
    assert flux == {'heater': 401, 'N': -305, 'window': -96}


def test_flux_missing(tmp_path):
    with pytest.raises(FileNotFoundError):
        wall_heat_flux(tmp_path, {'heater'})


def test_flux_restart_directory_order(tmp_path):
    output(tmp_path, 9, '20 heater 0 1 400\n')
    output(tmp_path, 10, '20 heater 0 1 405\n')
    assert wall_heat_flux(tmp_path, {'heater'}) == (20, {'heater': 405})


def test_flux_restart_filename_collision(tmp_path):
    older = output(tmp_path, 0, '1 heater 0 1 400\n')
    newer = output(tmp_path, 0, '1 heater 0 1 405\n', 'wallHeatFlux_0.dat')
    os.utime(older, ns=(1, 1))
    os.utime(newer, ns=(2, 2))
    assert wall_heat_flux(tmp_path, {'heater'}) == (1, {'heater': 405})


def test_flux_does_not_mix_incomplete_restart_with_old_sample(tmp_path):
    output(tmp_path, 0, '1 heater 0 1 400\n1 N 0 1 -400\n')
    output(tmp_path, 1, '1 heater 0 1 405\n')
    with pytest.raises(ValueError, match='complete'):
        wall_heat_flux(tmp_path, {'heater', 'N'})


def test_flux_iteration_average(tmp_path):
    output(tmp_path, 0, '1 N -1 0 -900\n2 N -1 0 -300\n3 N -1 0 -500\n')
    assert wall_heat_flux(tmp_path, {'N'}, (2, 3)) == (3, {'N': -400})


@pytest.mark.parametrize('rows', ['2 N -1 0 -300\n', '2 N -1 0 -300\n3 window -1 0 -10\n'])
def test_flux_average_incomplete(tmp_path, rows):
    output(tmp_path, 0, rows)
    with pytest.raises(ValueError, match='averaging window'):
        wall_heat_flux(tmp_path, {'N'}, (2, 3))


@pytest.mark.parametrize('rows', ['', '1 heater 0 1 400\n', '1 heater 0 1 nan\n', 'bad row\n'])
def test_flux_invalid(tmp_path, rows):
    output(tmp_path, 0, rows)
    with pytest.raises(ValueError):
        wall_heat_flux(tmp_path, {'heater', 'N', 'window'})
