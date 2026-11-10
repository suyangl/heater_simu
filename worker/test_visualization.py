import base64
import unittest

import numpy as np
import pyvista as pv

from app.models import Project
from visualization import build_visualization, streamline_payload, surface_payload


def unpack(data, dtype='<f4'):
    return np.frombuffer(base64.b64decode(data), dtype=dtype)


class VisualizationTest(unittest.TestCase):
    def setUp(self):
        self.mesh = pv.ImageData(dimensions=(11, 11, 11), spacing=(.4, .35, .25)).cast_to_unstructured_grid()
        self.mesh.cell_data['T'] = 288.15+self.mesh.cell_centers().points[:, 2]*4
        self.mesh.cell_data['U'] = np.tile([.1, .02, .1], (self.mesh.n_cells, 1))
        self.sampled = self.mesh.cell_data_to_point_data()
        self.mask = np.ones(self.sampled.n_points, dtype=bool)
        self.mask[0] = False

    def build(self, boundary=None, mean=20):
        return build_visualization(self.mesh, boundary if boundary is not None else pv.MultiBlock(),
                                   Project(), self.sampled, self.mask, mean)

    def test_geometry_fields_connectivity_and_mask(self):
        result = self.build(pv.MultiBlock({'walls': self.mesh.extract_surface()}))
        speed = unpack(result['U']['data'])
        self.assertTrue(np.isnan(speed[0]))
        np.testing.assert_allclose(speed[1:], np.linalg.norm([.1, .02, .1]), rtol=1e-6)
        self.assertEqual(result['U']['components'], 1)
        self.assertGreater(result['streamlines']['line_count'], 0)
        self.assertLessEqual(result['streamlines']['line_count'], 180)
        offsets = unpack(result['streamlines']['offsets'], '<u4')
        self.assertEqual(offsets[-1], result['streamlines']['point_count'])
        self.assertTrue(np.all(np.diff(offsets) <= 96))
        for surface in [*result['surfaces'], result['isosurface']]:
            self.assertIsNotNone(surface)
            self.assertEqual(len(unpack(surface['positions'])), surface['vertex_count']*3)
            self.assertEqual(len(unpack(surface['indices'], '<u4')), surface['triangle_count']*3)
            self.assertLess(unpack(surface['indices'], '<u4').max(), surface['vertex_count'])
            self.assertTrue(np.isfinite(unpack(surface['T'])).all())
            self.assertTrue(np.isfinite(unpack(surface['speed'])).all())
        np.testing.assert_allclose(unpack(result['isosurface']['T']), result['isosurface']['level_c'], atol=1e-4)

    def test_still_uniform_air_has_no_lines_or_isosurface(self):
        self.mesh.cell_data['T'][:] = 293.15
        self.mesh.cell_data['U'][:] = 0
        self.sampled = self.mesh.cell_data_to_point_data()
        result = self.build()
        self.assertEqual(result['surfaces'], [])
        self.assertIsNone(result['isosurface'])
        self.assertEqual(result['streamlines']['line_count'], 0)
        self.assertEqual(unpack(result['streamlines']['offsets'], '<u4').tolist(), [0])
        self.assertEqual(result['U']['max'], 0)

    def test_nonfinite_velocity_rejected(self):
        self.mesh.cell_data['U'][0] = np.nan
        with self.assertRaisesRegex(ValueError, 'velocity'):
            self.build()

    def test_surface_decimation_retains_fields(self):
        payload = surface_payload(self.sampled.extract_surface(), max_faces=100)
        self.assertLessEqual(payload['triangle_count'], 100)
        self.assertEqual(len(unpack(payload['T'])), payload['vertex_count'])

    def test_streamline_point_and_line_caps(self):
        lines = pv.PolyData(np.column_stack((np.arange(200), np.zeros(200), np.zeros(200))))
        lines.lines = np.concatenate([np.r_[40, np.arange(i*40, (i+1)*40)] for i in range(5)])
        lines['T'] = np.full(200, 293.15)
        lines['U'] = np.ones((200, 3))
        result = streamline_payload(lines, max_lines=2, max_points=8)
        self.assertEqual(result['line_count'], 2)
        self.assertEqual(result['point_count'], 16)
        self.assertEqual(unpack(result['indices'], '<u4').tolist(), list(range(16)))
        np.testing.assert_allclose(unpack(result['T']), 20, atol=1e-4)


if __name__ == '__main__':
    unittest.main()
