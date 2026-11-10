"""Export accepted visualization snapshots without modifying the dataset or running a solver."""
import argparse
import json
from pathlib import Path
import re


KPI = ('room_average_c', 'heat_loss_w', 'heat_loss_groups_w', 'energy_balance_error',
       'solve_wall_time_s', 'cell_count', 'rated_power_w', 'cfd_heater_power_w',
       'analytic_effective_power_w', 'thermostat_iterations', 'duty_cycle',
       'insufficient_power', 'not_settled')


def compact_result(result):
    def surface(value, iso=False):
        kept = {key: value[key] for key in ('positions', 'indices')}
        return kept | {'name': value.get('name'), 'T': '' if iso else value['T'],
                       'speed': value['speed'] if iso else ''} | (
                           {'level_c': value['level_c']} if iso else {})

    return {
        'source': 'openfoam',
        'grid': result['grid'],
        'T': {key: result['T'][key] for key in ('data', 'min', 'max', 'mean')},
        'U': {'data': '', 'min': result['U']['min'], 'max': result['U']['max']},
        'surfaces': [surface(value) for value in result['surfaces']],
        'streamlines': {key: result['streamlines'][key] for key in
                        ('positions', 'indices', 'offsets', 'speed', 'line_count')} | {'T': ''},
        'isosurface': surface(result['isosurface'], True) if result.get('isosurface') else None,
        'temperature_range': result['temperature_range'],
        'kpi': {key: result['kpi'][key] for key in KPI if key in result['kpi']},
    }


def build(root, output):
    root, output = Path(root).resolve(), Path(output).resolve()
    if output == root or root in output.parents:
        raise ValueError('Output must be outside the read-only dataset')
    output.mkdir(parents=True, exist_ok=True)
    index = {'version': 1, 'cases': []}
    for directory in sorted((root/'cases').glob('*')):
        metadata_file = directory/'metadata.json'
        if not metadata_file.is_file():
            continue
        metadata = json.loads(metadata_file.read_text())
        if metadata.get('status') != 'accepted':
            continue
        case_id = metadata['id']
        if not re.fullmatch(r'[A-Za-z0-9_-]+', case_id):
            raise ValueError(f'Invalid case id: {case_id!r}')
        result = compact_result(json.loads((directory/'result.json').read_text()))
        (output/f'{case_id}.json').write_text(json.dumps(result, separators=(',', ':'), allow_nan=False)+'\n')
        project = metadata['project']
        index['cases'].append({key: metadata[key] for key in ('id', 'template', 'dpe', 'position')} | {
            'setpoint_c': project['heater']['setpoint_c'], 'outdoor_temp': project['outdoor_temp'],
            'project': project,
        })
    (output/'index.json').write_text(json.dumps(index, separators=(',', ':'), allow_nan=False)+'\n')
    return index


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    index = build(args.dataset, args.output)
    files = [args.output/'index.json', *(args.output/f'{row["id"]}.json' for row in index['cases'])]
    print(f'Exported {len(index["cases"])} accepted examples; {sum(p.stat().st_size for p in files)} bytes total')


if __name__ == '__main__':
    main()
