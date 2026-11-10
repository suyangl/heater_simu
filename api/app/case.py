import itertools
import json
import math
from pathlib import Path

from .models import Project, U_VALUES

ITERATIONS = 1500
AVERAGE_START = 1101


def control_dict(end, average_start):
    return '''application buoyantSimpleFoam;
startFrom latestTime; startTime 0; stopAt endTime; endTime END;
deltaT 1; writeControl timeStep; writeInterval END; purgeWrite 1;
writeFormat ascii; writePrecision 8; runTimeModifiable false;
functions {
whf { type wallHeatFlux; libs (fieldFunctionObjects); timeStart AVG; writeControl writeTime; }
averages { type fieldAverage; libs (fieldFunctionObjects); timeStart AVG; writeControl writeTime;
restartOnRestart true;
fields (T { mean on; prime2Mean off; base iteration; } U { mean on; prime2Mean off; base iteration; }
p { mean on; prime2Mean off; base iteration; }); }
}'''.replace('END', str(end)).replace('AVG', str(average_start))


def cfd_coefficient(h_eff):
    return 1/max(1/h_eff-.13, 1/50)


def source_boxes(project):
    r = project.room
    bounds = project.heater.box(r).bounds()
    front = [list(b) for b in bounds]
    axis = 1 if project.heater.wall in ('N', 'S') else 0
    inward = project.heater.wall in ('N', 'E')
    face = bounds[axis][0 if inward else 1]
    front[axis] = [max(0, face-.1), face] if inward else [face, min((r.length, r.width)[axis], face+.1)]
    top = [list(b) for b in bounds]
    top[2] = [bounds[2][1], min(r.height, bounds[2][1]+.1)]
    return [box for box in (front, top) if all(hi > lo for lo, hi in box)]


def dictionary(name, body, cls='dictionary'):
    return f'FoamFile {{ version 2.0; format ascii; class {cls}; object {name}; }}\n{body}\n'


def generate(project: Project, path: Path):
    r, win = project.room, project.window
    sizes = (r.length, r.width, r.height)
    boxes = [project.heater.box(r), *project.furniture]
    heating_boxes = source_boxes(project)
    axes = [{0., size} for size in sizes]
    for box in boxes:
        for axis, bounds in zip(axes, box.bounds()):
            axis.update(bounds)
    for box in heating_boxes:
        for axis, bounds in zip(axes, box):
            axis.update(bounds)
    openings = project.opening_patches()
    for _, opening in openings:
        along = 0 if opening.wall in ('N', 'S') else 1
        axes[along].update((opening.offset, opening.offset+opening.width))
        axes[2].update((opening.sill, opening.sill+opening.height))
    axes = [sorted({round(v, 8) for v in axis}) for axis in axes]
    if math.prod(len(axis)-1 for axis in axes) > 150000:
        raise ValueError('几何分割过多：请减少门窗或家具的不同边界坐标')
    spacing = .08
    while True:
        counts = [[max(1, math.ceil((b-a)/spacing)) for a, b in zip(axis, axis[1:])] for axis in axes]
        if math.prod(sum(c) for c in counts) <= 150000:
            break
        spacing *= 1.05
    vertices = list(itertools.product(*axes))
    index = {v: i for i, v in enumerate(vertices)}
    cells, solid = {}, {}
    for ijk in itertools.product(*(range(len(a)-1) for a in axes)):
        mid = [(axes[d][i]+axes[d][i+1])/2 for d, i in enumerate(ijk)]
        occupied = next((n for n, b in enumerate(boxes) if all(lo < v < hi for v, (lo, hi) in zip(mid, b.bounds()))), None)
        if occupied is not None:
            solid[ijk] = 'heater' if occupied == 0 else 'furniture'
            continue
        i,j,k = ijk
        corners = [(i,j,k), (i+1,j,k), (i+1,j+1,k), (i,j+1,k),
                   (i,j,k+1), (i+1,j,k+1), (i+1,j+1,k+1), (i,j+1,k+1)]
        cells[ijk] = [index[tuple(axes[d][c[d]] for d in range(3))] for c in corners]
    names = ('N','S','E','W','floor','ceiling','window','heater','furniture') if project.legacy else ('N','S','E','W','floor','ceiling','heater','furniture',*(p for p,_ in openings))
    faces = {name: [] for name in names}
    directions = [(0,-1,'W',(0,4,7,3)), (0,1,'E',(1,2,6,5)),
                  (1,-1,'S',(0,1,5,4)), (1,1,'N',(3,7,6,2)),
                  (2,-1,'floor',(0,3,2,1)), (2,1,'ceiling',(4,5,6,7))]
    cell_count = 0
    source_cell_count = 0
    for ijk, verts in cells.items():
        cell_count += math.prod(counts[d][ijk[d]] for d in range(3))
        mid = [(axes[d][ijk[d]]+axes[d][ijk[d]+1])/2 for d in range(3)]
        if any(all(lo < v < hi for v, (lo, hi) in zip(mid, box)) for box in heating_boxes):
            source_cell_count += math.prod(counts[d][ijk[d]] for d in range(3))
        for axis, sign, name, local in directions:
            neighbor = list(ijk)
            neighbor[axis] += sign
            neighbor = tuple(neighbor)
            if neighbor in cells:
                continue
            patch = solid.get(neighbor, name)
            center = [(axes[d][ijk[d]]+axes[d][ijk[d]+1])/2 for d in range(3)]
            for opening_patch, opening in openings:
                along = 0 if opening.wall in ('N', 'S') else 1
                if patch == opening.wall and opening.offset < center[along] < opening.offset+opening.width and opening.sill < center[2] < opening.sill+opening.height:
                    patch = opening_patch
                    break
            faces[patch].append('('+' '.join(str(verts[n]) for n in local)+')')
    active = [p for p, f in faces.items() if f]
    def write(rel, body, cls='dictionary'):
        target = path/rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(dictionary(target.name, body, cls))
    vertex_text = '\n'.join('('+' '.join(map(str, v))+')' for v in vertices)
    blocks = '\n'.join(f"hex ({' '.join(map(str, v))}) ({' '.join(str(counts[d][ijk[d]]) for d in range(3))}) simpleGrading (1 1 1)" for ijk,v in cells.items())
    boundary = '\n'.join(p+' { type wall; faces ('+' '.join(faces[p])+'); }' for p in active)
    write('system/blockMeshDict', f'scale 1;\nvertices ({vertex_text});\nblocks ({blocks});\nedges ();\nboundary ({boundary});\nmergePatchPairs ();')
    thermal = project.thermal()
    if source_cell_count < 4:
        raise ValueError('暖器前方及上方需要至少四个空气单元')
    selections = []
    for i, box in enumerate(heating_boxes):
        lo = ' '.join(str(b[0]) for b in box)
        hi = ' '.join(str(b[1]) for b in box)
        selections.append(f'{{ name heaterAir; type cellSet; action {"new" if i == 0 else "add"}; source boxToCell; box ({lo}) ({hi}); }}')
    selections.append('{ name heaterAir; type cellZoneSet; action new; source setToCellZone; set heaterAir; }')
    write('system/topoSetDict', 'actions ('+'\n'.join(selections)+');')
    write('system/decomposeParDict', 'numberOfSubdomains 2; method scotch;')
    write('system/fvOptions', f'''convector {{ type scalarSemiImplicitSource; active yes;
selectionMode cellZone; cellZone heaterAir; volumeMode absolute;
sources {{ h ({thermal["effective_power_w"]} 0); }} }}
limitT {{ type limitTemperature; active yes; selectionMode all; min 233; max 500; }}''')
    write('system/controlDict', control_dict(ITERATIONS, AVERAGE_START))
    write('system/fvSchemes', '''ddtSchemes { default steadyState; }
gradSchemes { default Gauss linear; }
divSchemes { default none; div(phi,U) bounded Gauss upwind; div(phi,h) bounded Gauss upwind; div(phi,k) bounded Gauss upwind; div(phi,epsilon) bounded Gauss upwind; div(phi,K) bounded Gauss upwind; div(phid,p) Gauss upwind; div(((rho*nuEff)*dev2(T(grad(U))))) Gauss linear; }
laplacianSchemes { default Gauss linear corrected; }
interpolationSchemes { default linear; }
snGradSchemes { default corrected; }
fluxRequired { default no; p_rgh; }''')
    write('system/fvSolution', '''solvers {
p_rgh { solver GAMG; tolerance 1e-7; relTol 0.01; smoother GaussSeidel; }
"(U|h|e|k|epsilon)" { solver PBiCGStab; preconditioner DILU; tolerance 1e-7; relTol 0.1; }
}
SIMPLE { momentumPredictor no; nNonOrthogonalCorrectors 0; pRefCell 0; pRefValue 0; }
relaxationFactors { fields { p_rgh 0.7; } equations { U 0.3; h 0.8; "(k|epsilon)" 0.7; } }''')
    write('constant/g', 'dimensions [0 1 -2 0 0 0 0]; value (0 0 -9.81);', 'uniformDimensionedVectorField')
    write('constant/thermophysicalProperties', '''thermoType { type heRhoThermo; mixture pureMixture; transport const; thermo hConst; equationOfState perfectGas; specie specie; energy sensibleEnthalpy; }
mixture { specie { molWeight 28.96; } thermodynamics { Cp 1005; Hf 0; } transport { mu 1.8e-5; Pr 0.71; } }''')
    write('constant/turbulenceProperties', 'simulationType RAS; RAS { model kEpsilon; turbulence on; printCoeffs on; }')
    write('constant/radiationProperties', 'radiationModel none;')
    wall_u, window_u = cfd_coefficient(thermal['wall_h_eff']), cfd_coefficient(U_VALUES[project.dpe][1])
    coefficients = {wall: wall_u for wall in project.wall_set}
    coefficients.update({patch: window_u if o.type == 'window' else cfd_coefficient(o.u_value)
                         for patch, o in openings if o.wall in project.wall_set})
    initial = project.outdoor_temp+273.15+thermal['effective_power_w']/thermal['ua_total']
    for name, dims, val, cls in [('T','[0 0 0 1 0 0 0]',str(initial),'volScalarField'), ('U','[0 1 -1 0 0 0 0]','(0 0 0)','volVectorField'), ('p','[1 -1 -2 0 0 0 0]','101325','volScalarField'), ('p_rgh','[1 -1 -2 0 0 0 0]','101325','volScalarField'), ('alphat','[1 -1 -1 0 0 0 0]','0','volScalarField')]:
        bcs = []
        for patch in active:
            bc = 'type zeroGradient;'
            if name == 'T' and patch in coefficients:
                mode = f'mode coefficient; h uniform {coefficients[patch]}; Ta constant {project.outdoor_temp+273.15};'
                bc = f'type externalWallHeatFluxTemperature; {mode} kappaMethod fluidThermo; value uniform {initial};'
            elif name == 'U':
                bc = 'type noSlip;'
            elif name == 'p_rgh':
                bc = 'type fixedFluxPressure; value uniform 101325;'
            elif name == 'p':
                bc = 'type calculated; value uniform 101325;'
            elif name == 'alphat':
                bc = 'type compressible::alphatJayatillekeWallFunction; Prt 0.85; value uniform 0;'
            bcs.append(f'{patch} {{ {bc} }}')
        write('0/'+name, f'dimensions {dims}; internalField uniform {val}; boundaryField {{'+ '\n'.join(bcs)+'}', cls)
    for name, dims, val, bc in [('k', '[0 2 -2 0 0 0 0]', '.08', 'kqRWallFunction'),
                               ('epsilon', '[0 2 -3 0 0 0 0]', '.23', 'epsilonWallFunction'),
                               ('nut', '[0 2 -1 0 0 0 0]', '0', 'nutkWallFunction')]:
        boundary = '\n'.join(f'{patch} {{ type {bc}; value uniform {val}; }}' for patch in active)
        write('0/'+name, f'dimensions {dims}; internalField uniform {val}; boundaryField {{ {boundary} }}', 'volScalarField')
    (path/'project.json').write_text(project.model_dump_json())
    meta = {'cell_count': cell_count, 'mesh_spacing': spacing, 'patches': active,
            'source_cell_count': source_cell_count, 'average_start': AVERAGE_START, 'iterations': ITERATIONS}
    (path/'case_meta.json').write_text(json.dumps(meta))
    return meta
