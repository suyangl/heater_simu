import math
from pathlib import Path


def wall_heat_flux(case: Path, required: set[str], window: tuple[int, int] | None = None):
    samples: dict[float, dict[str, float]] = {}
    files = sorted((case/'postProcessing'/'whf').glob('*/wallHeatFlux*.dat'),
                   key=lambda file: (float(file.parent.name), file.stat().st_mtime_ns))
    if not files:
        raise FileNotFoundError('OpenFOAM wallHeatFlux output is missing')
    for file in files:
        file_samples: dict[float, dict[str, float]] = {}
        for line in file.read_text().splitlines():
            if not line.strip() or line.lstrip().startswith('#'):
                continue
            columns = line.split()
            if len(columns) != 5:
                raise ValueError(f'Malformed wallHeatFlux row in {file.name}')
            time, patch, minimum, maximum, integral = columns
            values = [float(v) for v in (time, minimum, maximum, integral)]
            if not all(math.isfinite(v) for v in values):
                raise ValueError('Non-finite wallHeatFlux output')
            file_samples.setdefault(values[0], {})[patch] = values[3]
        samples.update(file_samples)
    complete = [t for t, patches in samples.items() if required <= patches.keys()]
    if window is not None:
        start, end = window
        times = list(range(start, end+1))
        if not times or any(t not in complete for t in times):
            raise ValueError('Incomplete wallHeatFlux averaging window')
        patches = set(samples[end])
        if any(set(samples[t]) != patches for t in times):
            raise ValueError('Inconsistent wallHeatFlux patches in averaging window')
        return end, {p: math.fsum(samples[t][p] for t in times)/len(times) for p in patches}
    if not complete:
        raise ValueError('No complete wallHeatFlux sample for required patches')
    time = max(complete)
    return time, samples[time]
