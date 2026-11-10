import base64
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np
import pyvista as pv

from app.models import Project
from runner import postprocess, run, settled_control, settled_power, solve_thermostat, thermostat_power


class PostprocessTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name)
        self.project = Project()
        (self.path/'project.json').write_text(self.project.model_dump_json())
        (self.path/'case_meta.json').write_text(json.dumps({'average_start': 2, 'iterations': 3,
            'cfd_heater_power_w': 405.3, 'thermostat_iterations': 2, 'insufficient_power': False,
            'thermostat_history': []}))
        (self.path/'run.log').write_text('Time = 3\n')
        self.mesh = pv.ImageData(dimensions=(3, 3, 3), spacing=(2, 1.75, 1.25)).cast_to_unstructured_grid()
        self.mesh.cell_data['T'] = np.full(self.mesh.n_cells, 330.)
        self.mesh.cell_data['TMean'] = np.full(self.mesh.n_cells, 292.15)
        self.mesh.cell_data['p'] = np.full(self.mesh.n_cells, 120000.)
        self.mesh.cell_data['pMean'] = np.full(self.mesh.n_cells, 101325.)
        self.mesh.cell_data['U'] = np.ones((self.mesh.n_cells, 3))
        self.mesh.cell_data['UMean'] = np.zeros((self.mesh.n_cells, 3))
        data = pv.MultiBlock({'internalMesh': self.mesh, 'boundary': pv.MultiBlock()})
        self.reader = Mock(time_values=[3], read=Mock(return_value=data))
        self.flux = self.path/'postProcessing'/'whf'/'0'/'wallHeatFlux.dat'
        self.flux.parent.mkdir(parents=True)
        self.flux.write_text('2 heater 0 0 0\n2 N -1 0 -200\n2 window -1 0 -205.3\n'
                             '3 heater 0 0 0\n3 N -1 0 -200\n3 window -1 0 -205.3\n')

    def process(self):
        with patch('runner.pv.OpenFOAMReader', return_value=self.reader):
            postprocess(self.path, 12)
        return json.loads((self.path/'result.json').read_text())

    def test_averaged_temperature_and_source_energy(self):
        result = self.process()
        self.assertAlmostEqual(result['kpi']['room_average_c'], 19)
        self.assertAlmostEqual(result['kpi']['energy_balance_error'], 0)
        self.assertEqual(result['kpi']['source_power_w'], 405.3)
        self.assertAlmostEqual(result['kpi']['air_density_min'], 101325/(8314.462618/28.96*292.15))
        values = np.frombuffer(base64.b64decode(result['T']['data']), dtype='<f4')
        np.testing.assert_allclose(values[np.isfinite(values)], 19, atol=1e-4)

    def test_missing_average_field(self):
        del self.mesh.cell_data['TMean']
        with self.assertRaises(KeyError):
            self.process()

    def test_incomplete_flux_window(self):
        self.flux.write_text('3 heater 0 0 0\n3 N -1 0 -200\n3 window -1 0 -205.3\n')
        with self.assertRaisesRegex(ValueError, 'averaging window'):
            self.process()

    def test_zero_effective_power(self):
        (self.path/'project.json').write_text(Project(outdoor_temp=25).model_dump_json())
        meta = json.loads((self.path/'case_meta.json').read_text())
        meta['cfd_heater_power_w'] = 0
        (self.path/'case_meta.json').write_text(json.dumps(meta))
        self.flux.write_text('2 heater 0 0 0\n2 N 0 0 0\n2 window 0 0 0\n'
                             '3 heater 0 0 0\n3 N 0 0 0\n3 window 0 0 0\n')
        self.assertEqual(self.process()['kpi']['energy_balance_error'], 0)

    def test_power_rescaling_and_capacity(self):
        self.assertAlmostEqual(thermostat_power(405.3, 30.55, self.project), 405.3*14/25.55)
        self.assertEqual(thermostat_power(405.3, 5, self.project), 1500)
        self.assertEqual(thermostat_power(405.3, 5.01, self.project), 1500)
        self.assertEqual(thermostat_power(405.3, 30, Project(outdoor_temp=25)), 0)
        with self.assertRaises(ValueError):
            thermostat_power(405.3, float('nan'), self.project)

    def test_control_loop_preserves_fields_and_finishes_with_fixed_power_window(self):
        (self.path/'system').mkdir()
        with patch('runner.run') as run, patch('runner.averaged_room_mean', side_effect=[30.55, 19.1, 19.0]):
            solve_thermostat(self.path, 2)
        meta = json.loads((self.path/'case_meta.json').read_text())
        self.assertEqual(meta['iterations'], 2800)
        self.assertEqual(meta['average_start'], 2201)
        self.assertEqual(meta['thermostat_iterations'], 2)
        self.assertAlmostEqual(meta['cfd_heater_power_w'], 405.3*14/25.55)
        commands = [call.args[0] for call in run.call_args_list]
        self.assertEqual(commands.count(['decomposePar']), 1)
        self.assertEqual(commands.count(['reconstructPar', '-latestTime']), 3)
        self.assertIn('startFrom latestTime;', (self.path/'system/controlDict').read_text())
        self.assertIn('restartOnRestart true;', (self.path/'system/controlDict').read_text())

    def test_cfd_capacity_flag_overrides_analytic_guess(self):
        (self.path/'system').mkdir()
        with patch('runner.run'), patch('runner.averaged_room_mean', side_effect=[5, 16, 16]):
            solve_thermostat(self.path, 1)
        meta = json.loads((self.path/'case_meta.json').read_text())
        self.assertTrue(meta['insufficient_power'])
        self.assertEqual(meta['cfd_heater_power_w'], 1500)

    def test_settled_mode_uses_matching_long_final_flux_and_field_window(self):
        (self.path/'system').mkdir()
        with patch('runner.run'), patch('runner.averaged_room_mean', return_value=19), \
                patch('runner.wall_heat_flux', return_value=(4500, {'heater': 0, 'N': -405.3, 'window': 0})) as flux:
            solve_thermostat(self.path, 2, settled=True)
        meta = json.loads((self.path/'case_meta.json').read_text())
        self.assertEqual(meta['thermostat_mode'], 'settled')
        self.assertEqual(meta['average_start'], 2501)
        self.assertEqual(meta['iterations'], 4500)
        self.assertEqual(flux.call_args.args[-1], (2501, 4500))
        self.assertEqual(meta['thermostat_history'][-1]['phase'], 'final')

    def test_thermostat_budget_error(self):
        with self.assertRaises(TimeoutError):
            solve_thermostat(self.path, 2, budget=0)

    def test_capacity_flag_uses_final_averaged_temperature(self):
        (self.path/'system').mkdir()
        for final_mean, insufficient in [(18.49, True), (18.5, False), (19, False), (19.5, False)]:
            with self.subTest(final_mean=final_mean):
                with patch('runner.run'), patch('runner.averaged_room_mean', side_effect=[5, 16, final_mean]):
                    solve_thermostat(self.path, 1)
                meta = json.loads((self.path/'case_meta.json').read_text())
                self.assertEqual(meta['insufficient_power'], insufficient)
                self.assertEqual(meta['cfd_heater_power_w'], 1500)

    def test_rated_power_final_overheating_is_not_accepted_as_insufficient(self):
        (self.path/'system').mkdir()
        with patch('runner.run'), patch('runner.averaged_room_mean', side_effect=[5, 16, 19.51]):
            with self.assertRaisesRegex(RuntimeError, 'Final thermostat averaging drifted'):
                solve_thermostat(self.path, 1)

    def test_no_heating_demand(self):
        (self.path/'system').mkdir()
        (self.path/'project.json').write_text(Project(outdoor_temp=25).model_dump_json())
        with patch('runner.run'), patch('runner.averaged_room_mean', side_effect=[25, 25]):
            solve_thermostat(self.path, 1)
        self.assertEqual(json.loads((self.path/'case_meta.json').read_text())['cfd_heater_power_w'], 0)

    def test_nonfinite_controller_measurement(self):
        (self.path/'system').mkdir()
        with patch('runner.run'), patch('runner.averaged_room_mean', return_value=float('nan')):
            with self.assertRaises(ValueError):
                solve_thermostat(self.path, 1)

    def test_process_failure_and_timeout(self):
        run([sys.executable, '-c', 'pass'], self.path)
        with self.assertRaises(subprocess.CalledProcessError):
            run([sys.executable, '-c', 'raise SystemExit(3)'], self.path)
        with self.assertRaises(subprocess.TimeoutExpired):
            run([sys.executable, '-c', 'import time; time.sleep(60)'], self.path, .05)


class SettledControlTest(unittest.TestCase):
    def test_secant_damping_and_bad_slope_fallback(self):
        p = Project()
        self.assertAlmostEqual(settled_power(100, 21, p, (80, 17)), 93)
        self.assertAlmostEqual(settled_power(100, 20, p, (120, 19)), 100+.7*(100*14/15-100))
        self.assertGreaterEqual(settled_power(100, 30, p, (99, 29)), 65)
        self.assertEqual(settled_power(100, 30, Project(outdoor_temp=25)), 0)
        with self.assertRaises(ValueError):
            settled_power(100, float('nan'), p)

    def control(self, values, project=None):
        values = iter(values)
        calls = []
        def measure(power, length, samples, phase):
            calls.append((power, length, samples, phase))
            mean, error = next(values)
            return {'power_w': power, 'room_mean_c': mean, 'energy_balance_error': error}
        result = settled_control(project or Project(), 100, measure)
        return result, calls

    def test_does_not_update_from_unsettled_measurements(self):
        result, calls = self.control([(22, .2), (22.1, .02), (19.1, .02), (19.1, .02), (19.05, .01)])
        self.assertEqual([c[0] for c in calls[:2]], [100, 100])
        self.assertLess(calls[2][0], 100)
        self.assertEqual(calls[-1][1:], (2000, 2000, 'final'))
        self.assertEqual(result['room_mean_c'], 19.05)

    def test_low_ua_uses_longer_settle_blocks(self):
        _, calls = self.control([(19, .01), (19, .01), (19, .01)], Project(dpe='A'))
        self.assertEqual(calls[0][1], 2000)
        self.assertEqual(calls[1][1], 1500)

    def test_final_drift_resumes_control_instead_of_failing(self):
        result, calls = self.control([(19, .01), (19, .01), (18.1, .01),
                                      (18.1, .01), (19, .01), (19, .01), (19, .01)])
        self.assertEqual(result['room_mean_c'], 19)
        self.assertGreater(calls[4][0], calls[3][0])

    def test_final_bad_balance_holds_same_power_and_reaverages(self):
        result, calls = self.control([(19, .01), (19, .01), (19, .125),
                                      (19, .01), (19, .02)])
        self.assertEqual(result['energy_balance_error'], .02)
        self.assertTrue(all(c[0] == 100 for c in calls))

    def test_never_settling_raises(self):
        with self.assertRaisesRegex(RuntimeError, '60 measurement blocks'):
            self.control([(19, .2)]*60)


if __name__ == '__main__':
    unittest.main()
