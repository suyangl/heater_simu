import base64

import numpy as np
import pyvista as pv

from app.case import source_boxes


def packed(values, dtype='<f4'):
    return base64.b64encode(np.asarray(values, dtype=dtype).tobytes()).decode()


def surface_payload(surface, max_faces=2000):
    surface = surface.extract_surface().triangulate().clean()
    if surface.n_cells > max_faces:
        surface = surface.decimate_pro(1-max_faces/surface.n_cells, preserve_topology=True,
                                       boundary_vertex_deletion=True)
    if not surface.n_points or not surface.n_cells:
        return None
    temperature = np.asarray(surface.point_data['T'])-273.15
    speed = np.linalg.norm(surface.point_data['U'], axis=1)
    if not all(np.isfinite(a).all() for a in (surface.points, temperature, speed)):
        raise ValueError('Non-finite visualization surface field')
    indices = surface.faces.reshape(-1, 4)[:, 1:]
    return {'positions': packed(surface.points), 'indices': packed(indices, '<u4'),
            'T': packed(temperature), 'speed': packed(speed),
            'vertex_count': surface.n_points, 'triangle_count': len(indices),
            'temperature_range': [float(temperature.min()), float(temperature.max())]}


def streamline_payload(lines, max_lines=180, max_points=96):
    cells = []
    cursor = 0
    connectivity = lines.lines
    while cursor < len(connectivity):
        count = int(connectivity[cursor])
        ids = connectivity[cursor+1:cursor+1+count]
        if count >= 5:
            cells.append(ids[np.linspace(0, count-1, min(count, max_points), dtype=int)])
        cursor += count+1
    if len(cells) > max_lines:
        cells = [cells[i] for i in np.linspace(0, len(cells)-1, max_lines, dtype=int)]
    ids = np.concatenate(cells) if cells else np.array([], dtype=int)
    positions = lines.points[ids]
    temperature = np.asarray(lines.point_data['T'])[ids]-273.15 if len(ids) else np.array([])
    speed = np.linalg.norm(lines.point_data['U'][ids], axis=1) if len(ids) else np.array([])
    if not all(np.isfinite(a).all() for a in (positions, temperature, speed)):
        raise ValueError('Non-finite streamline field')
    return {'positions': packed(positions), 'indices': packed(np.arange(len(ids)), '<u4'),
            'offsets': packed(np.cumsum([0, *map(len, cells)]), '<u4'),
            'T': packed(temperature), 'speed': packed(speed),
            'line_count': len(cells), 'point_count': len(ids)}


def build_visualization(mesh, boundary, project, sampled, mask, room_mean):
    air = mesh.cell_data_to_point_data()
    if not np.isfinite(air.point_data['U']).all():
        raise ValueError('Non-finite averaged velocity')
    speed = np.linalg.norm(sampled['U'], axis=1).astype('<f4')
    speed[~mask] = np.nan
    max_speed = float(np.linalg.norm(air.point_data['U'], axis=1).max())
    surfaces = []
    for name in boundary.keys():
        patch = boundary[name]
        if patch.n_points:
            payload = surface_payload(patch.cell_data_to_point_data())
            if payload:
                surfaces.append({'name': name, **payload})
    temperature_range = [float(np.min(mesh.cell_data['T'])-273.15),
                         float(np.max(mesh.cell_data['T'])-273.15)]
    for surface in surfaces:
        temperature_range[0] = min(temperature_range[0], surface['temperature_range'][0])
        temperature_range[1] = max(temperature_range[1], surface['temperature_range'][1])
    seeds = []
    for box in source_boxes(project):
        axes = [np.linspace(lo+(hi-lo)*.15, hi-(hi-lo)*.15, n)
                for (lo, hi), n in zip(box, (4, 3, 4))]
        seeds.extend(np.array(np.meshgrid(*axes, indexing='ij')).reshape(3, -1).T)
    r = project.room
    axes = [np.linspace(size*.12, size*.88, 4) for size in (r.length, r.width, r.height)]
    seeds.extend(np.array(np.meshgrid(*axes, indexing='ij')).reshape(3, -1).T)
    seeds = np.asarray(seeds)
    seeds = seeds[mesh.find_containing_cell(seeds) >= 0]
    lines = pv.PolyData()
    if max_speed > 1e-6 and len(seeds):
        lines = air.streamlines_from_source(pv.PolyData(seeds), vectors='U',
            integration_direction='both', max_steps=1200, terminal_speed=1e-6,
            max_time=4*max(r.length, r.width, r.height)/max_speed, compute_vorticity=False)
    level = room_mean+.6*(float(np.max(mesh.cell_data['T'])-273.15)-room_mean)
    isosurface = None
    if float(air['T'].min()) < level+273.15 < float(air['T'].max()):
        isosurface = surface_payload(air.contour([level+273.15], scalars='T'), max_faces=4000)
        if isosurface:
            isosurface['level_c'] = level
    return {'U': {'dtype': 'float32', 'encoding': 'base64', 'components': 1,
                  'quantity': 'speed_m_s', 'data': packed(speed), 'min': 0., 'max': max_speed},
            'surfaces': surfaces, 'streamlines': streamline_payload(lines),
            'isosurface': isosurface, 'temperature_range': temperature_range}
