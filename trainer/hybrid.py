"""Shared geometry features and standardized ridge models; no solver calls."""
import json
import math
import os
from pathlib import Path

import numpy as np

from app.models import ACH, U_VALUES


SPATIAL_NAMES = ['z', 'z2', 'heater_near', 'heater_far', 'plume', 'window', 'downdraft', 'exterior', 'shadow']
CASE_NAMES = ['wall_u', 'window_u', 'ach', 'window_floor_ratio', 'heater_window_distance',
              'volume', 'opaque_floor_ratio', 'furniture_volume_ratio', 'height', 'aspect']
FEATURE_NAMES = SPATIAL_NAMES + CASE_NAMES + ['z_wall_u', 'z2_wall_u', 'plume_wall_u',
    'window_window_u', 'downdraft_ach', 'exterior_wall_u', 'shadow_heater', 'z_ach', 'heater_volume']


def opening_center(project, opening):
    r = project.room
    along = opening.offset+opening.width/2
    z = opening.sill+opening.height/2
    return {'N': (along, r.width, z), 'S': (along, 0, z),
            'E': (r.length, along, z), 'W': (0, along, z)}[opening.wall]


def context(project):
    r = project.room
    box = project.heater.box(r)
    center = (box.x+box.l/2, box.y+box.w/2, box.z+box.h/2)
    windows = [(opening_center(project, o), o.sill) for _, o in project.opening_patches() if o.type == 'window']
    wall_u, window_u = U_VALUES[project.dpe]
    floor = r.length*r.width
    volume = floor*r.height
    window_area = sum(o.width*o.height for _, o in project.opening_patches() if o.type == 'window')
    opaque = sum((r.length if w in ('N', 'S') else r.width)*r.height for w in project.wall_set)
    opaque -= sum(o.width*o.height for _, o in project.opening_patches() if o.wall in project.wall_set)
    nearest = min((math.dist(center, c) for c, _ in windows), default=0.)
    scalars = [wall_u, window_u, ACH[project.dpe], window_area/floor, nearest, volume, opaque/floor,
               sum(b.l*b.w*b.h for b in project.furniture)/volume, r.height, r.length/r.width]
    return center, windows, scalars


def intersects(start, end, box):
    low, high = 0., 1.
    for a, b, (lo, hi) in zip(start, end, box.bounds()):
        delta = b-a
        if abs(delta) < 1e-12:
            if a < lo or a > hi:
                return False
        else:
            near, far = sorted(((lo-a)/delta, (hi-a)/delta))
            low, high = max(low, near), min(high, far)
            if low > high:
                return False
    return high > 1e-8 and low < 1-1e-8


def features(project, point, prepared=None):
    center, windows, c = prepared or context(project)
    x, y, height = point
    z = height/project.room.height
    distance = math.dist(point, center)
    near, far = math.exp(-distance/.5), math.exp(-distance/1.5)
    plume = math.exp(-math.hypot(x-center[0], y-center[1])/.5)*z*(height > center[2])
    distances = [(math.dist(point, w), sill) for w, sill in windows]
    window = math.exp(-min(d for d, _ in distances)/.5) if distances else 0.
    down = max((math.exp(-d/.5) for d, sill in distances if height < sill), default=0.)
    walls = {'N': project.room.width-y, 'S': y, 'E': project.room.length-x, 'W': x}
    exterior = math.exp(-min(walls[w] for w in project.wall_set)/.5)
    shadow = float(any(intersects(center, point, b) for b in project.furniture))
    return [z, z*z, near, far, plume, window, down, exterior, shadow, *c,
            z*c[0], z*z*c[0], plume*c[0], window*c[1], down*c[2], exterior*c[0],
            shadow*near, z*c[2], near*c[5]]


def fit(x, y, alpha):
    x, y = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    if x.ndim != 2 or not len(x) or not np.isfinite(x).all() or not np.isfinite(y).all():
        raise ValueError('Ridge requires nonempty finite training data')
    mean, std = x.mean(axis=0), x.std(axis=0)
    std[std < 1e-12] = 1
    standardized = (x-mean)/std
    intercept = float(y.mean())
    coef = np.linalg.solve(standardized.T@standardized+alpha*np.eye(x.shape[1]), standardized.T@(y-intercept))
    return dict(mean=mean.tolist(), std=std.tolist(), coef=coef.tolist(), intercept=intercept)


def regress(model, x):
    return (np.asarray(x)-model['mean'])/model['std']@np.asarray(model['coef'])+model['intercept']


def power_model_path():
    base = Path(__file__).resolve().parents[1]
    bundled = base/'frontend/public/surrogate/hybrid-v1.json'
    return Path(os.environ.get('THERMOSTAT_POWER_MODEL', str(bundled if bundled.exists() else base/'hybrid-v1.json')))


def load_power_model():
    model = json.loads(power_model_path().read_text())
    if model.get('version') != 'hybrid-v1' or model.get('case_names') != CASE_NAMES:
        raise ValueError('Incompatible thermostat power model')
    power = model['power']
    for name in ('mean', 'std', 'coef'):
        values = np.asarray(power[name], dtype=float)
        if values.shape != (len(CASE_NAMES),) or not np.isfinite(values).all():
            raise ValueError('Invalid thermostat power ridge')
    if not np.isfinite(power['intercept']) or np.any(np.asarray(power['std']) <= 0):
        raise ValueError('Invalid thermostat power ridge')
    return power
