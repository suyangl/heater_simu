import random

from pydantic import ValidationError

from app.models import Project


KINDS = {
    '床': ((.9, 1.6), (1.8, 2.0), (.4, .65)),
    '桌': ((.8, 1.4), (.5, .8), (.7, .8)),
    '柜': ((.6, 1.2), (.4, .6), (1.5, 2.0)),
    '沙发': ((1.2, 2.0), (.65, .9), (.7, .95)),
    '书架': ((.5, 1.0), (.25, .4), (1.2, 1.9)),
}
WALLS = ('N', 'E', 'S', 'W')


def random_cases(definition):
    rng = random.Random(definition['seed'])
    limit = definition['max_attempts']
    if not isinstance(limit, int) or limit < 1:
        raise ValueError('max_attempts must be a positive integer')
    if definition['setpoint_c'] != 19 or definition['solver_power_ceiling_w'] != 2500:
        raise ValueError('Random training requires 19 C and a 2500 W ceiling')
    plan = []
    for split in ('train', 'holdout'):
        count = definition['counts'][split]
        if not isinstance(count, int) or count < 0:
            raise ValueError('Case counts must be nonnegative integers')
        for number in range(count):
            room = {key: rng.uniform(*bounds) for key, bounds in definition['room'].items()}
            first = rng.randrange(4)
            exterior = [WALLS[first]]
            if rng.random() < definition['corner_probability']:
                exterior.append(WALLS[(first+1) % 4])
            window_count = rng.randint(1, 2)
            door = rng.random() < definition['door_probability']
            furniture_count = rng.randint(*definition['furniture_count'])
            dpe = rng.choice('ABCDEFG')
            outdoor = rng.uniform(*definition['outdoor_temp'])
            along = lambda wall: room['length' if wall in ('N', 'S') else 'width']
            for _ in range(limit):
                openings = []
                for _ in range(window_count):
                    wall = rng.choice(exterior)
                    window = {key: rng.uniform(*bounds) for key, bounds in definition['window'].items()}
                    openings.append(dict(type='window', wall=wall, offset=rng.uniform(0, along(wall)-window['width']), **window))
                if door:
                    wall = rng.choice([w for w in WALLS if w not in exterior])
                    openings.append(dict(type='door', wall=wall, offset=rng.uniform(0, along(wall)-.8), width=.8, height=2, sill=0))
                wall = rng.choice(WALLS)
                try:
                    project = Project(room=room, exterior_walls=exterior, openings=openings,
                                      dpe=dpe, outdoor_temp=outdoor, furniture=[],
                                      heater=dict(wall=wall, offset=rng.uniform(0, along(wall)-.8),
                                                  power_w=2500, setpoint_c=19))
                except ValidationError:
                    continue
                for _ in range(furniture_count):
                    for _ in range(limit):
                        kind = rng.choice(list(KINDS))
                        l, w, h = [rng.uniform(*bounds) for bounds in KINDS[kind]]
                        if rng.random() < .5:
                            l, w = w, l
                        box = dict(x=rng.uniform(0, room['length']-l), y=rng.uniform(0, room['width']-w),
                                   z=0, l=l, w=w, h=h, kind=kind)
                        try:
                            project = Project.model_validate(project.model_dump() | {'furniture': [*project.model_dump()['furniture'], box]})
                            break
                        except ValidationError:
                            continue
                    else:
                        break
                else:
                    break
            else:
                raise ValueError(f'Could not place {split} case {number} within bounded attempts')
            plan.append(dict(id=f'rand-{split}-{number:04d}', split=split, template='random',
                             position='random', dpe=dpe, project=project.model_dump(),
                             sampled_features=dict(area_m2=room['length']*room['width'],
                                                   exterior_wall_count=len(exterior), window_count=window_count,
                                                   interior_door=door, furniture_count=furniture_count,
                                                   heater_wall=project.heater.wall, outdoor_temp=outdoor)))
    return plan
