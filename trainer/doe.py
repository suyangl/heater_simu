import itertools
import json
import random
from pathlib import Path

from app.models import Project

DEFINITION = Path(__file__).with_name('doe-v1.json')


def load_definition():
    return json.loads(DEFINITION.read_text())


def project_for(template, dpe, position, definition):
    length = template['room']['length']
    offset = (length-.8)/2
    wall = 'N'
    if position == 'beside_window':
        offset = .1
    elif position == 'opposite_wall':
        wall = 'S'
    elif position == 'interior_corner':
        wall, offset = 'W', .15
    elif position != 'under_window':
        raise ValueError(f'Unknown heater position: {position}')
    return Project(room=template['room'], furniture=template['furniture'], dpe=dpe,
                   exterior_wall='N', outdoor_temp=definition['outdoor_temp'],
                   window={'offset': (length-1.2)/2, 'width': 1.2, 'height': 1.35, 'sill': .9},
                   heater={'wall': wall, 'offset': offset, 'power_w': definition['solver_power_ceiling_w'],
                           'setpoint_c': definition['setpoint_c']})


def cases(definition=None):
    definition = definition or load_definition()
    templates, positions = definition['templates'], definition['positions']
    rows = [(t, d, p, 'train') for t, d, p in itertools.product(templates, definition['training_dpe'], positions)]
    rng = random.Random(definition['holdout_seed'])
    combinations = list(itertools.product(templates, positions))
    for dpe in definition['holdout_dpe']:
        rows.extend((t, dpe, p, 'holdout') for t, p in rng.sample(combinations, definition['holdouts_per_dpe']))
    return [{'id': f'{split}-{template["id"]}-{dpe}-{position}', 'split': split,
             'template': template['id'], 'dpe': dpe, 'position': position,
             'project': project_for(template, dpe, position, definition).model_dump()}
            for template, dpe, position, split in rows]
