[中文版](PRD.md)

# PRD: HeatSimu France — A 3D Simulator for Localized Electric Heating and Electricity Costs in French Homes

| Item | Details |
|---|---|
| Version | v0.5 (personal local edition: Windows 10 + Docker Desktop, accessed via localhost, no accounts, noncommercial) |
| Repository | suyangl/heater_simu |
| Simulation engine | OpenFOAM v2406 (ESI / openfoam.com, free and open source, GPL) |
| Usage | Personal, local, noncommercial use: `docker compose up` → open `http://localhost:8080` in a browser |
| Scenario | Electric heating in French homes (apartments / detached houses) |
| Status | Pending review |

---

## 1. Background and Problem

- Approximately **1/3 of primary residences in France use electric heating** (convecteur, panneau rayonnant, radiateur à inertie, etc.). Winter electricity bills are among households' largest energy expenses.
- Electricity tariffs are complex: **Tarif Bleu Base / Heures Pleines–Heures Creuses (HP/HC) / Tempo (blue/white/red days)**. Users struggle to decide when to heat, at what power, and in which location for the lowest cost.
- Many older homes have **DPE energy ratings of E/F/G ("passoires thermiques")**, with substantial heat loss, but users lack an intuitive tool for understanding where the heat goes.
- Existing tools (electricity-bill calculators and simple ADEME simulators) provide only a total. They **do not account for room geometry, furniture obstructions, heater placement, or local comfort zones**, and provide no visualization.

**Core insight**: Many people only need warmth beside the bed or at their desk, rather than an entire room at 21°C. Localized heating + sensible placement + sensible timing = significant electricity savings.

## 2. Product Goals

1. Let users draw their own room (length, width, height, doors, windows, furniture) and place electric heaters within 5 minutes.
2. Use OpenFOAM to compute the room's **3D temperature field and airflow**, with compelling 3D visualization showing where it is warm and cold.
3. Combine user-entered electricity prices and DPE ratings to calculate **daily / monthly / heating-season electricity costs**.
4. Automatically generate **electricity-saving plans** (adjust temperature, schedules, placement, heater type, or tariff) and quantify each saving (€ and kWh).

### Non-goals (Not Included in v1)
- No coupled whole-building, multi-room simulation (consider for v2).
- No heat-pump / gas / wood heating (possible v2 extensions).
- No replacement for official DPE certification; results are for reference only.
- No integration with real-time Linky data.
- No user accounts, login, cloud deployment, shared links, or commercialization.
- No automatic retrieval of electricity prices: all prices are entered manually by the user.
- Weather includes outdoor temperature only (not humidity, wind speed, or solar radiation).

## 3. Target Users and Scenarios

A personal local tool, used by the author (and family or friends running it on their own computers). Typical scenarios:
- A bedroom / Studio with only one convecteur: finding the cheapest placement, power setting, and heating schedule;
- Comparing Base / HP-HC / Tempo (prices copied manually from one's own contract);
- Assessing whether switching to a thermal-inertia heater or adding curtains or door seals is worthwhile;
- Viewing the 3D heat distribution to understand where the heat goes.

## 4. User Stories

- US1 As a user, I can **enter the room's length × width × height** (meters, precision 0.01), or **draw its outline by dragging** on a 2D canvas, with both methods synchronized in real time.
- US2 I can add **furniture cuboids** (bed, desk, wardrobe, sofa, bookcase, custom), drag / resize / rotate them on the canvas (90° increments + arbitrary angles), or directly enter their length, width, height, and position coordinates.
- US3 I can add **doors and windows** (specifying the wall, width, height, height above the floor, and window type: single / double / triple glazing).
- US4 I can add one or more **electric heaters**, choosing type, power, position (wall mounting / height above the floor), orientation, thermostat settings (Confort / Eco / Hors-gel, setpoint temperature), and schedule.
- US5 I can select a **DPE energy rating (A–G)**, or directly enter wall U-values and air changes per hour in advanced mode.
- US6 I can select an **electricity tariff type** and **enter all prices myself** (€/kWh, subscription fee abonnement, HC periods, and Tempo day distribution).
- US7 I can **enter outdoor temperature** (a single design temperature, or a table of monthly averages); optionally, I can retrieve local temperatures from Météo-France data with one click.
- US7b I can select the **floor position** (ground / intermediate / top floor / detached house) and whether the spaces above and below are heated.
- US8 I can define **comfort zones (Zone de confort)**, such as "0.5–1.2 m above the bed" or "the desk-and-chair area", and have the system assess whether the zone reaches its target temperature.
- US9 After clicking "Simulate", I can view a 3D room with **temperature slices, isosurfaces, airflow particles/streamlines, and thermal-camera-style** visualization, rotate and zoom the view, and drag the slice height.
- US10 I can view **electricity-cost results**: hourly power curves, daily / monthly / heating-season costs, and a breakdown by tariff period.
- US11 I can view a **list of electricity-saving recommendations**, each showing "estimated savings in €/year, kWh/year, and comfort impact", and apply a plan with one click to rerun the simulation and compare.
- US12 I can **save projects locally** (browser localStorage + JSON file export/import), and export screenshots / PDF reports.

## 5. Functional Requirements

### 5.1 Room and Furniture Editor (Dual 2D + 3D Views)

| ID | Requirement | Priority |
|---|---|---|
| F1.1 | 2D top-down canvas (grid snapping, default 5 cm grid, can be disabled), with mouse dragging to draw a rectangular room | P0 |
| F1.2 | Right-side properties panel: numeric inputs for length, width, and height, bound bidirectionally to the canvas | P0 |
| F1.3 | v1 supports rectangular rooms only; v1.1 supports L-shaped / polygonal rooms (drawn point by point) | P0 / P1 |
| F1.4 | Furniture library: beds (single 90×190, double 140×190, 160×200), desks, wardrobes, cabinets, sofas, bookcases, custom cuboids; editable preset dimensions | P0 |
| F1.5 | Furniture operations: drag to move, corner resizing, rotation, duplication, deletion, undo/redo | P0 |
| F1.6 | Furniture properties: length/width/height, height above the floor (e.g. wall-mounted cabinets, under-bed space), material (wood / fabric / metal, affecting radiative emissivity and heat capacity) | P1 |
| F1.7 | Doors/windows: snap to walls; configure width, height, height above the floor, glazing type, and curtains/blinds | P0 |
| F1.8 | Collision and validity checks: furniture must stay inside the room and not overlap heaters; warn that space is required in front of a heater | P0 |
| F1.9 | Real-time synchronized 3D preview (the box-based 3D room is visible while editing) | P0 |
| F1.10 | One-click templates: Studio 20 m², bedroom 12 m², living room 25 m² | P1 |
| F1.11 | Upload a floor-plan photo as a tracing background (with scale calibration) | P2 |

### 5.2 Electric Heater Configuration

| Type (French) | Description | Typical Power | Physical Modeling Considerations |
|---|---|---|---|
| Convecteur électrique | Convector ("grille-pain") | 500–2000 W | ~90% convection + 10% radiation; hot air rises directly, prone to stratification |
| Panneau rayonnant | Radiant panel | 500–2000 W | ~50% radiation + 50% convection |
| Radiateur à inertie (fluide / sèche / pierre) | Thermal-inertia heater | 750–2000 W | Heat capacity, smooth output, delayed response; relatively high radiation fraction |
| Radiateur soufflant / soufflant céramique | Fan heater | 1000–2500 W | Forced convection, with outlet air velocity and direction |
| Panneau infrarouge | Infrared panel | 300–1200 W | Primarily radiation, can be ceiling-mounted |
| Sèche-serviettes | Bathroom towel radiator | 300–1000 W | Optional in v1 |

Configurable properties:
- Type, rated power (W, freely entered), dimensions (editable type-dependent presets), position (wall, offset along the wall, height above the floor), and placement under a window.
- Temperature control: thermostat type (mechanical bimétal ±1.5°C / electronic ±0.2°C), setpoint temperature, **fil pilote modes**: Confort (e.g. 19°C), Eco (Confort −3.5°C), Hors-gel (7°C), Arrêt.
- Schedule: a weekly 7×24-hour mode table (drag to paint selections); support preheating during HC periods (thermal-inertia heaters).
- Advanced: manually override convection/radiation fractions, heat capacity (thermal-inertia heaters), and air velocity (fan heaters).

### 5.3 Building Envelope and Energy Rating (DPE)

- Users select a DPE rating **A–G** (based on the post-2021 DPE dual thresholds; energy consumption in kWh_EP/m²/year: A ≤70, B ≤110, C ≤180, D ≤250, E ≤330, F ≤420, G >420).
- The system maps the rating to default envelope parameters (**overridable in advanced mode**):

| DPE | Exterior Wall U (W/m²K) | Window U (W/m²K) | Air Changes ACH (1/h) | Typical Description |
|---|---|---|---|---|
| A | 0.15 | 0.8 | 0.3 | New RE2020 building, triple glazing |
| B | 0.25 | 1.1 | 0.4 | BBC standard |
| C | 0.35 | 1.4 | 0.5 | Recently renovated |
| D | 0.6 | 2.0 | 0.6 | 1990s |
| E | 1.0 | 2.8 | 0.7 | 1970–80s, partial insulation |
| F | 1.5 | 3.5 | 0.9 | Limited insulation, old double glazing |
| G | 2.2 | 5.0 | 1.2 | No insulation, single glazing |

> These are product-default assumptions and must be calibrated during implementation by a building-physics consultant / literature (e.g. the TABULA/EPISCOPE French building typology).

- Each wall can be marked as **exterior / adjacent to a heated neighbor / adjacent to an unheated space (stairwell, garage)**, with different boundary conditions.
- Floor / ceiling: whether the spaces above and below are heated; top/ground floor conditions (e.g. basement, roof).

### 5.4 Electricity Tariff Parameters (All Entered by the User)

The system **neither bundles nor retrieves** electricity prices. It only provides forms for users to fill in from their own electricity contracts / bills. Electricity costs cannot be calculated while required fields are empty (the 3D temperature field remains available).

| Tariff | User-Entered Fields |
|---|---|
| Base | Price in €/kWh; subscription fee in €/month; subscribed capacity in kVA |
| HP/HC | HP price, HC price; HC periods (may be split into two, e.g. 22:00–06:00 or 01:00–07:00 + 12:00–14:00); subscription fee |
| Tempo | Six prices: blue/white/red × HP/HC; number of blue/white/red days per season (entered manually); HC periods; subscription fee |
| Custom | Time-of-use price table for 24 h × 7 days |

- Support multiple locally saved tariff profiles for comparing plans.
- Subscribed-capacity check: warn of a potential breaker trip if all heaters running simultaneously exceed the subscribed kVA.

### 5.5 Outdoor Temperature and Floor Position

**Outdoor temperature (temperature only)**
- Manual input: a single outdoor design temperature (e.g. 5°C, for the 3D steady-state temperature field), and an optional **monthly average temperature table** for the heating season (October–April, for seasonal electricity costs).
- Optional autofill: enter a city / postal code and retrieve temperatures from Météo-France data. Two implementation options (both free):
  - Météo-France's official API portal (portail-api.meteofrance.fr): register for a free API key and enter it in the local `.env`;
  - Open-Meteo (provides Météo-France model data, no key required, free for personal noncommercial use)—the default and simplest option.
- Manual entry remains available offline; no network dependency.
- Humidity, wind speed, and solar radiation are excluded from v1; ventilation (ACH) uses fixed DPE defaults that can be edited manually.

**Floor position and vertical adjacencies**

| Floor Situation | Floor Boundary | Ceiling Boundary | Notes |
|---|---|---|---|
| Ground floor (rez-de-chaussée), above soil / basement / garage (unheated) | Heat transfer to unheated space or ground (U_floor, DPE default) | Approximately adiabatic if the space above is heated | Cold floor and uncomfortable feet; localized heating is particularly valuable |
| Intermediate floor, with heated neighbors above and below | Approximately adiabatic / neighbor temperature (default 19°C) | Same as floor | Lowest heat loss |
| Top floor (dernier étage), below roof / attic | Approximately adiabatic if the space below is heated | Heat transfer to roof / unheated attic (U_roof, DPE default) | Warm air rises and gathers at the ceiling; high top-floor losses |
| Detached house (maison individuelle) | Ground | Roof | Losses on both sides |

- User input: floor number / total floors, or direct selection of ground / intermediate / top floor / detached house; whether the spaces above and below are heated; whether neighbors are absent for extended periods (less heating).

### 5.6 Simulation (See Section 7)

- **Real-time mode (default, milliseconds)**: call a surrogate model trained on offline OpenFOAM data; dragging any parameter slider immediately updates the 3D temperature field and electricity costs.
- **Detailed mode (asynchronous, minutes)**: when a layout falls outside the surrogate's trusted range, or the user explicitly clicks "Detailed simulation", run OpenFOAM in the background, then push and replace the view with high-fidelity results.
- Electricity costs: surrogate output of the power required to maintain the setpoint and comfort-zone temperatures → seasonal RC model → hourly tariff billing.
- Cache results (parameter hash); feed detailed simulation results back into the training dataset.

### 5.7 3D Visualization (A Visually Compelling Frontend)

| ID | Requirement | Priority |
|---|---|---|
| F7.1 | 3D room: translucent walls, furniture boxes (optional material textures), heater models, doors/windows | P0 |
| F7.2 | **Horizontal/vertical temperature slices**, draggable height/position, colorbar (blue→red, optional "thermal camera" / "inferno" palettes) | P0 |
| F7.3 | **Isosurfaces** (e.g. 18°C, 20°C, 22°C), translucent and glowing | P0 |
| F7.4 | **Animated airflow particles** / streamlines (showing hot air rising from a heater, spreading along the ceiling, and cold air descending beside windows) | P1 |
| F7.5 | Temperature fog using volume rendering | P1 |
| F7.6 | Highlighted comfort-zone boxes showing the zone's mean temperature and whether it meets the target (temperature threshold) | P1 |
| F7.7 | Transient playback: drag a timeline to watch warm-up during the first 0–60 min after switching on | P1 |
| F7.8 | Plan comparison: side-by-side / slider comparison of temperature fields for two plans | P1 |
| F7.9 | Hover over any point to show temperature (and air velocity) | P0 |
| F7.10 | One-click screenshot / export of a 10-second rotating animation (saved locally) | P2 |
| F7.11 | First-person walkthrough mode | P2 |

### 5.8 Electricity-Cost Results Panel

- KPI cards: total heating-season cost in €, kWh, mean power, cost per m², comfort-zone compliance (% of time).
- Charts: typical-day 24 h power curve (colored by tariff period), monthly cost bars, breakdown by Tempo day type.
- Comparison with the French average for the same floor area and DPE (reference values, with sources).

### 5.9 Electricity-Saving Planner (Core Selling Point)

Automatically generate candidate plans → batch-simulate with the surrogate + RC model → rank by **savings in €/year**, also showing comfort impact and upfront cost:

| Category | Example Recommendation | Quantification |
|---|---|---|
| Setpoint | Lower room temperature by 1°C (ADEME rule of thumb: ~7% savings) | Model calculation |
| Schedule | Switch to Eco when away / at night; preheat 30 min before waking | Model calculation |
| Tariff | Annual comparison of Base → HP/HC or Tempo; reduce use on Tempo red days | Hourly cost |
| Localized heating | Maintain only the comfort-zone temperature, lower the overall setpoint + aim a low-power infrared panel at the desk | CFD calibration + model |
| Placement | Move the heater under a window / out from behind a sofa / avoid placement behind the bed | CFD comparison |
| Furniture | Do not place wardrobes against exterior walls where they block radiation; do not place cabinets in front of heaters | CFD comparison |
| Equipment | Mechanical-thermostat convecteur → electronic-thermostat inertie | Model + equipment price |
| Minor improvements | Thick curtains, door seals, window film, reflective panels (wall behind the heater) | Modify U/ACH |
| Major improvements | Replace windows, insulate walls; suggest **MaPrimeRénov'** and CEE subsidies (links to official sites) | Payback period |

- Each recommendation: title, one-sentence explanation of the principle, savings in €/year and kWh/year, CO₂ (configurable RTE average grid emission factor), comfort change, cost, payback period, and an "Apply and compare" button.
- **"My electricity-saving plan"**: select and combine recommendations to generate a final plan and PDF report.

### 5.10 Project Saving (No Accounts)

- No login or accounts. Automatically save projects to browser localStorage, with JSON file export / import.
- Save backend results (OpenFOAM cases, field data) in the Docker-mounted local directory `./data/`.
- Interface language: Chinese (default) + optional English; metric units, € currency.

## 6. Information Architecture and Main Pages

1. **Home (localhost:8080)**: recent projects + "New project" + "Open example room".
2. **Wizard**: ① Room → ② Doors/windows → ③ Furniture → ④ Heaters → ⑤ Building and DPE → ⑥ Tariff and climate → ⑦ Comfort zones. Each step can be skipped to use defaults.
3. **Editor (main workspace)**: left toolbar (drawing / furniture library / heater library), central 2D/3D switching or split view, right properties panel.
4. **Results**: 3D visualization above, KPIs + charts + saving recommendations below.
5. **Comparison**: up to 3 plans side by side.
6. **Report**: export screenshots / PDF (local files).

## 7. Technical Design

### 7.1 Architectural Principles: Separate Frontend/Backend + Asynchronous Computation + Compact Results (Local Docker Deployment)

Goal: **show the 3D temperature field and electricity costs within < 100 ms of a parameter change**. OpenFOAM is not on the interactive path:

1. **Offline**: batch-run parameter combinations with OpenFOAM locally to build a dataset (one-time work, can run overnight).
2. **Training**: train a lightweight surrogate on the dataset (lookup-table interpolation → reduced-order models → PINN / neural operators, upgraded progressively).
3. **Online**: the frontend calls the surrogate for millisecond results; layouts outside the training range **asynchronously** trigger a local detailed OpenFOAM run, then receive high-fidelity results that also feed back into the dataset.

```
Browser http://localhost:8080
┌──────────── frontend container (nginx serves the React build) ─────────────┐
│ React + TS + Vite; 2D: react-konva; 3D: three.js + @react-three/fiber + drei │
│ Parameter panels; ECharts; Zustand; onnxruntime-web / JS lookup inference  │
└──────────────┬───────────────────────────────▲─────────────────────────────┘
               │ /api reverse proxy           │ JSON / binary fields, WebSocket progress
┌──────────────▼───────────────────────────────┴─────────────────────────────┐
│ api container: Python + FastAPI (uvicorn)                                  │
│ • Parameter validation (Pydantic), surrogate inference, billing, planning   │
│ • Edit OpenFOAM dictionaries → hand off to worker through the job queue    │
│ • PyVista/VTK reduction: .vtk/.vtu → regular grid → Float16 + gzip           │
│ • Local single-machine job queue: SQLite job records + process pool        │
│   (no Redis required)                                                     │
└──────────────┬─────────────────────────────────────────────────────────────┘
               │ Shared volume ./data (cases, results, datasets, models)
┌──────────────▼─────────────────────────────────────────────────────────────┐
│ worker container: official OpenFOAM v2406 image (opencfd/openfoam-default)  │
│ + Python (runner script): blockMesh → snappyHexMesh →                       │
│   buoyantSimpleFoam (steady) / buoyantPimpleFoam (transient, optional)       │
│   → foamToVTK                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

**Deployment and operation (docker compose)**

| Service | Image / Build | Ports | Notes |
|---|---|---|---|
| frontend | `node` build → `nginx:alpine` | 8080 → host | Static pages + reverse proxy of `/api`, `/ws` to api |
| api | `python:3.11-slim` + FastAPI + PyVista + onnxruntime | Internal 8000 only | Middleware |
| worker | `opencfd/openfoam-default:2406` + Python | None | Runs OpenFOAM; `cpus` / parallel core count configurable in `.env` |
| trainer (optional profile) | `python` + PyTorch/scikit-learn | None | `docker compose --profile train run trainer` generates datasets and trains models |

- One-command startup: `docker compose up --build`, then open `http://localhost:8080` in a browser.
- All data lives in `./data/` (git-ignored); the repository includes a pretrained S1 lookup table, usable on first startup without generating a dataset first.
- Configuration (`.env`): `OPENFOAM_NPROCS`, `MAX_PARALLEL_JOBS`, `WEATHER_PROVIDER=openmeteo|meteofrance|none`, `METEOFRANCE_API_KEY` (optional).
- **Target platform: Windows 10 (x86_64) + Docker Desktop (WSL2 backend)**; Linux is also supported.
  - Prerequisites: keep Windows 10 up to date (Docker Desktop has minimum Win10 version requirements; refer to Docker's official documentation), enable BIOS virtualization, and install WSL2.
  - Resources (**target machine: 8 GB RAM**): set `memory=4GB`, `processors=4` (adjust to the actual core count), and `swap=4GB` in `%UserProfile%\.wslconfig`; worker defaults are `OPENFOAM_NPROCS=2` and `MAX_PARALLEL_JOBS=1`.
  - Memory budget: OpenFOAM approximately 1 GB / 100,000 cells (more with radiation) → default mesh **100,000–300,000 cells** (8 cm background, 3 cm near heaters/windows); api + frontend < 1 GB; browser 3D < 1 GB.
  - Performance: OpenFOAM reads/writes many small files. **Do not put `./data` on a Windows drive (C:\ via a bind mount is very slow)**. Use the default Docker named volume `heater_data`, or clone the repository into WSL2's Linux filesystem (`\\wsl$\Ubuntu\home\...`).
  - Scripts: provide `start.ps1` / `start.bat` (check Docker is running → `docker compose up -d --build` → automatically open http://localhost:8080).
  - Line endings: the repository's `.gitattributes` enforces LF for `*.sh` and OpenFOAM dictionaries, preventing container script / dictionary parse failures caused by CRLF on Windows.
- Use actual image tags published by OpenCFD on Docker Hub; pin the version during implementation.

### 7.2 Frontend (Visualization Layer)

- React + Three.js (`@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`): 3D room models, furniture boxes, heaters, doors/windows.
- Parameter controls: sliders for power, DPE, outdoor temperature, setpoint temperature, electricity prices, etc.; **recalculate in real time as sliders move** (surrogate inference + recoloring, without waiting for the backend).
- Temperature-field visualization: slices (draggable height), isosurfaces (marching cubes in a Web Worker), volume rendering, particle streamlines.
- Display an accuracy label: `Surrogate (instant)` / `OpenFOAM detailed simulation (verified)`.

### 7.3 Middleware (Scheduling and Data Processing Layer)

| Module | Responsibility |
|---|---|
| `api/` | FastAPI routes; Pydantic definitions of the project JSON schema |
| `surrogate/` | Load ONNX / lookup tables; encode input features → temperature field + power/energy |
| `foam_case/` | Use Python (Jinja2 templates or PyFoam `ParsedParameterFile`) to modify dictionaries such as `blockMeshDict`, `snappyHexMeshDict`, `fvOptions`/`fvModels`, `0/T`, `0/U`, `thermophysicalProperties`, and `radiationProperties` |
| `runner/` | Call `blockMesh`, `snappyHexMesh`, `buoyantSimpleFoam`, and `foamToVTK` via `subprocess`; timeouts, log parsing (residuals, convergence assessment), failure retries |
| `postproc/` | Read results with PyVista/VTK → resample to a regular grid (e.g. 64×64×40) → Float16 quantization + gzip; export point clouds / slices / statistics (comfort-zone mean temperature, heat loss per wall) |
| `billing/` | Seasonal RC model + hourly billing with user-entered tariffs (Base/HP-HC/Tempo/custom) |
| `weather/` | Optional: retrieve outdoor temperatures by city (Open-Meteo default / optional Météo-France API key), with local caching |
| `planner/` | Generate candidate electricity-saving plans and rank them using batch surrogate inference |

**Compact-result targets**: a single temperature field < 500 KB (64×64×40 × Float16 ≈ 330 KB, smaller after gzip); initial frontend JSON (KPIs, curves) < 20 KB.

### 7.4 Backend (Physics Engine Layer): OpenFOAM

| Item | Approach |
|---|---|
| Solvers | `buoyantSimpleFoam` (steady buoyancy-driven heat transfer, primary dataset solver); `buoyantPimpleFoam` (transient, warm-up curves / thermostat cycling, limited samples) |
| Computational domain | Room air; furniture as solid obstacles (removed with snappyHexMesh `searchableBox`, no STL required) |
| Mesh | Default (8 GB RAM machine): 8 cm background, 3 cm refinement near heaters/windows, 100,000–300,000 cells; "high accuracy" preset: 500,000 cells (requires ≥ 16 GB) |
| Properties / turbulence | Air: perfectGas or Boussinesq; k-ω SST / realizable k-ε + buoyancy correction |
| Radiation | `fvDOM` or `P1` (required for radiant panels, infrared panels, and thermal-inertia heaters) |
| Heaters | Energy source (fvOptions/fvModels volumetric heat source) for the convective portion + hot radiating surface; fan heaters modeled with supply/return outlets |
| Envelope boundaries | Exterior walls/windows: `externalWallHeatFluxTemperature` (U-value + outdoor temperature, fixed h_out); adjacent heated rooms: adiabatic/fixed temperature; floor/ceiling according to floor position (heat transfer to ground/basement/roof, or adiabatic) |
| Humidity / wind | Not considered (outdoor temperature only); infiltration uses a fixed ACH |
| Infiltration | Door/window gap inlets/outlets based on ACH, or a volumetric-source approximation |
| Computing resources | Local execution: 4–8 cores per case, approximately 5–15 min for steady state; an S1 dataset of 100–200 cases takes approximately 1–2 days on an 8-core computer (overnight runs, resumable) |

**M0 convector modeling supplement**: The solid heater surface is adiabatic. `P_eff` is injected through `fvOptions` as absolute total power into the `heaterAir` cellZone, an air layer approximately 10 cm in front of/above the heater; no heater-surface power boundary is used. ACH remains incorporated into exterior-wall `h_eff`; wall/window U-values already include indoor surface thermal resistance. The CFD coefficient is `h_cfd = 1 / (1/h_eff − 0.13)`, capped at 50 W/(m²·K) to avoid zero/negative thermal resistance and excessively large coefficients. Assess results using `TMean`, `UMean`, and the mean integrated `wallHeatFlux` over the same window, approximately the final 40% of iterations. Energy error is `|mean net heat loss − P_eff| / P_eff`. The default example requires error <10%, mean air temperature within ≤2°C of the setpoint (or insufficient rated power), and reasonable air density; normal process exit or a single instantaneous heat balance does not constitute acceptance.

M0 thermostat-control supplement: The analytic `P_eff` above is only an initial guess / RC estimate. CFD adjusts source power using volume-weighted mean air temperature feedback (not exceeding rated power), continuing from the latest fields. After reaching the setpoint within ±0.5°C or establishing insufficient rated power, perform final averaging and heat-balance assessment at fixed controlled power. M0 excludes radiation; radiative heat transfer will be added in later milestones.

### 7.5 Offline Dataset Design (DoE)

> Note: `DPE=[A, C, G] × power=[1000W, 2000W] × position=[under window, corner]` gives only 3×2×2 = **12 combinations**. To obtain approximately 100+ samples and cover real users, expand the dimensions and use Latin hypercube / Sobol sampling, rather than only a full-factorial grid.

**Physical dimensionality reduction (substantially fewer samples)**: At steady state, the temperature field approximately follows `T(x) ≈ T_out + ΔT_ref · θ(x)`. The dimensionless temperature field θ depends primarily on geometry, heater type/position, and the Biot number (≈ envelope UA relative to convective heat transfer). Therefore:
- **Outdoor temperature does not need to be a sampling dimension** (linear translation + a small correction).
- **Power and DPE can be combined into a few dimensionless parameters** (P/(UA·ΔT), Rayleigh number), with a small number of samples correcting buoyancy nonlinearities.

Suggested parameter space (v1):

| Dimension | Values | Type |
|---|---|---|
| Room length × width | 2.5–6 m × 2.5–5 m (continuous), height 2.4–2.8 m | Continuous |
| DPE (→ wall/window U, ACH) | A–G | Ordered discrete / continuous U |
| Power | 500–2500 W | Continuous |
| Heater type | convecteur / radiant panel / thermal-inertia heater / fan heater / infrared | Categorical |
| Heater position | Under window / exterior wall away from window / interior wall / corner + relative offset along the wall | Categorical + continuous |
| Window | Area ratio, wall | Continuous + categorical |
| Outdoor temperature | −10 – 15°C (dimensionless scaling works in most cases, so dense sampling is unnecessary) | Continuous |
| Floor position | Ground / intermediate / top floor / detached house (→ floor/ceiling boundary U-values) | Categorical |
| Furniture | Encoded as an "occupancy grid" (see 7.6); randomly place 1–5 boxes (bed/desk/cabinet) during training | Structured |

Scale: **Stage 1: approximately 100–200 cases** (3–4 fixed common room templates, covering DPE × power × type × position); **Stage 2: approximately 1000–3000 cases** (random room dimensions and furniture layouts) for generalization.

### 7.6 Surrogate Model Roadmap

| Stage | Model | Inputs | Outputs | Inference Speed | Applicability |
|---|---|---|---|---|---|
| S1 (MVP) | Multidimensional interpolated lookup table (`scipy.interpolate.RegularGridInterpolator` / RBF) + physical scaling | Template ID, DPE, power, type, position | θ field (regular grid), comfort-zone temperatures, heat-loss breakdown | < 10 ms | Template rooms + preset furniture layouts only |
| S2 | Reduced-order POD/PCA + regression (Gaussian process / gradient boosting / small MLP) | Above + room length/width (normalize geometry to a unit cube, then resample) | POD coefficients → reconstructed field | < 20 ms | Arbitrary rectangular dimensions, limited furniture |
| S3 | 3D U-Net / neural operator (FNO) or PINN (data + energy-equation residual constraints) | 3D grids: furniture occupancy, heater position/power, wall U, window masks | 3D temperature field (+ velocity field) | 20–100 ms (WebGPU/server GPU) | Arbitrary user layouts |

Notes and trade-offs:
- **PINNs** alone are expensive to train and difficult to converge for multiple parameters + arbitrary geometry. Prefer them as an S3 regularizer (primarily data-driven, with auxiliary physical residuals), rather than the MVP's first choice.
- **S1/S2 can run directly in the frontend** (JSON lookup tables or ONNX, model < 5 MB); S3 can use a FastAPI server-side GPU or quantized onnxruntime-web/WebGPU inference.
- Energy / electricity costs: the steady-state surrogate gives the mean power required to maintain the setpoint and comfort-zone deviation → seasonal RC model → hourly costs; the full season takes < 50 ms.

### 7.7 Confidence and "Uncertain → Detailed Simulation" Fallback (Critical)

Users can freely draw rooms and furniture, so layouts outside the training dataset are inevitable. Design:
1. The surrogate also outputs **confidence** (distance from inputs to training data / ensemble variance / GP variance).
2. High confidence: display directly, labeled "Instant result".
3. Low confidence: still display the surrogate immediately (labeled "Estimate"), while **asynchronously submitting a detailed OpenFOAM run in the background**. Push progress through WebSocket and smoothly transition to the detailed temperature field when complete.
4. **Feed every detailed result back into the dataset** and periodically retrain (active learning), improving accuracy with use.

### 7.8 Data Formats

- Project JSON (example):

```json
{
  "room": { "length": 4.2, "width": 3.5, "height": 2.5, "shape": "rect" },
  "walls": [{ "id": "N", "type": "exterior" }, { "id": "E", "type": "heated_neighbor" }],
  "openings": [{ "type": "window", "wall": "N", "offset": 1.2, "width": 1.2, "height": 1.35, "sill": 0.9, "glazing": "double_old" }],
  "furniture": [{ "id": "bed1", "kind": "bed", "x": 0.2, "y": 1.5, "z": 0, "l": 1.9, "w": 1.4, "h": 0.55, "rot": 0, "material": "fabric" }],
  "heaters": [{ "id": "h1", "kind": "convecteur", "power_w": 1500, "wall": "N", "offset": 1.2, "z": 0.15,
                "thermostat": "mechanical", "setpoints": { "confort": 19, "eco": 15.5, "horsgel": 7 },
                "schedule": "weekly_24x7_modes" }],
  "envelope": { "dpe": "F", "overrides": { "wall_u": null, "window_u": null, "ach": null } },
  "tariff": { "type": "hphc", "subscription_kva": 6, "subscription_eur_month": null, "prices": { "hp": null, "hc": null }, "hc_slots": ["22:00-06:00"] },
  "climate": { "source": "manual|openmeteo|meteofrance", "city": "Paris", "outdoor_design_temp": 5, "monthly_temp": { "10": 12.5, "11": 8.0, "12": 5.5, "1": 4.9, "2": 5.6, "3": 8.8, "4": 11.5 } },
  "building": { "type": "apartment", "floor_position": "top", "floor": 6, "floors_total": 6, "above_heated": false, "below_heated": true },
  "comfort_zones": [{ "id": "z1", "name": "Desk", "box": [2.5, 0.3, 0.6, 1.2, 0.8, 1.2], "target": 20 }]
}
```

- Field result (compact):

```json
{
  "source": "surrogate|openfoam",
  "confidence": 0.86,
  "grid": { "nx": 64, "ny": 64, "nz": 40, "origin": [0,0,0], "spacing": [0.066, 0.055, 0.0625] },
  "T": { "dtype": "float16", "encoding": "base64+gzip", "min": 12.1, "max": 38.4, "url_or_data": "..." },
  "U": { "optional": true },
  "kpi": { "zone_avg_T": { "z1": 19.6 }, "avg_power_w": 820, "heat_loss_split": { "window": 0.38, "walls": 0.41, "infiltration": 0.21 } }
}
```

### 7.9 API (Draft)

| Method | Path | Description |
|---|---|---|
| POST | /api/predict | Synchronous: surrogate inference, returning field + KPIs + confidence (target P95 < 100 ms) |
| POST | /api/billing | Synchronous: seasonal electricity-cost calculation |
| POST | /api/simulate | Asynchronous: submit a detailed OpenFOAM run, return job_id |
| GET / WS | /api/jobs/{id}, /ws/jobs/{id} | Job status, progress pushes |
| GET | /api/jobs/{id}/result | Detailed results (compact field data) |
| POST | /api/plan | Generate electricity-saving recommendations (batch surrogate inference) |
| GET | /api/weather/temperature?city= | Optional: retrieve outdoor temperatures (monthly averages / current), with local caching |
| GET | /api/surrogate/manifest | Model/lookup-table version and download URL for local frontend inference |
| GET | /api/health | Container health checks (including OpenFOAM worker availability) |

### 7.10 Offline Pipeline (Dataset and Training)

```
DoE sampling (Sobol/LHS) → Case generation (Python dictionary edits) → Batch OpenFOAM (parallel workers)
 → Convergence checks (residuals/energy-balance error < 1%) → PyVista resampling and storage (Parquet/Zarr)
 → Training (S1 lookup / S2 POD+regression / S3 U-Net/FNO/PINN) → Validation (holdout set)
 → Export ONNX/JSON → Versioned release (manifest) → Online sample feedback → Periodic retraining
```

Acceptance: on the holdout set, surrogate **comfort-zone mean temperature MAE < 0.5°C**, **full-field temperature RMSE < 1°C**, and **required-power error < 10%**.

## 8. Nonfunctional Requirements

| Category | Target |
|---|---|
| Performance | Parameter change → 3D field and electricity-cost update P95 < 100 ms (surrogate); full-season costs < 50 ms; local detailed OpenFOAM runs (≤500,000 cells, 4–8 cores) approximately 5–15 min; 3D view ≥ 50 FPS (midrange laptop) |
| Accuracy | Surrogate vs OpenFOAM holdout set: comfort-zone temperature MAE < 0.5°C, full-field RMSE < 1°C, power error < 10%; validate CFD with a classical heated-cavity natural-convection case |
| Deployment | Single-command `docker compose up --build` startup; first build < 15 min; only host port 8080 is used |
| Resources | Idle RAM < 1 GB; configurable CPU cores for detailed simulation without disrupting normal computer use |
| Offline | All features work offline except optional weather retrieval |
| Compatibility | Latest Chrome / Firefox / Edge / Safari, WebGL2 |
| Maintainability | Pin OpenFOAM version in the Docker image; regression-test case templates (fixed inputs → results within tolerance) |
| License | Personal noncommercial use; OpenFOAM is GPL, called as an independent container process |
| Disclaimer | UI states "Estimated results; not a DPE or energy audit" |

## 9. Acceptance Criteria (Personal Edition)

- Run `docker compose up` on one's own computer and use the application at localhost:8080.
- Draw one's own room, furniture, doors/windows, and heaters within 5 minutes.
- Drag power / DPE / outdoor temperature / setpoint sliders and see the 3D temperature field and electricity costs update **instantly**.
- After entering one's own electricity prices, seasonal costs are within ±20% of actual bills (calibration may use last year's actual electricity consumption).
- Provide at least 5 quantified electricity-saving recommendations, applicable with one click for comparison.

## 10. Milestones

| Stage | Estimated Duration | Scope |
|---|---|---|
| M0 Technical validation | 2 weeks | End-to-end three-container docker compose setup; FastAPI uses Python to edit dictionaries and call OpenFOAM: rectangular room + 1 convecteur + 2 furniture items + 1 window, buoyantSimpleFoam converges → PyVista resampling → frontend R3F slice rendering |
| M1 Dataset v1 + S1 | 3 weeks | 3–4 room templates × DPE × power × type × position, approximately 100–200 cases; multidimensional interpolated lookup table; millisecond frontend slider updates |
| M2 MVP | 4 weeks | 2D/3D editor, user-entered tariffs (Base/HP-HC/Tempo/custom), seasonal RC costs, saving recommendations, confidence + asynchronous detailed-simulation fallback |
| M3 S2 Generalization | 4 weeks | Random room dimensions/furniture, approximately 1000+ cases; POD + regression surrogate; real-time prediction for arbitrary rectangular rooms |
| M4 v1.0 | 4 weeks | Particle airflow, comfort zones, plan comparison, PDF reports, Chinese/English UI |
| v2 | — | S3 neural operators / PINN, L-shaped rooms, multiple rooms, transient warm-up playback |

## 11. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Surrogate cannot generalize to user-defined layouts (training data covers few combinations) | Distorted results, loss of trust | Physical nondimensionalization; randomized-layout datasets; confidence assessment + asynchronous OpenFOAM runs at low confidence; active-learning feedback |
| Limited local computing power slows dataset generation | Schedule delays | Bundle a pretrained S1 lookup table; coarse meshes + a few fine-mesh corrections; resumable overnight batches |
| PINN training fails to converge | Schedule delays | MVP does not depend on PINNs; use lookup tables/POD first, with PINNs only as an optional S3 physical regularizer |
| snappyHexMesh fails on arbitrary furniture layouts | Failed jobs | Frontend minimum-clearance checks (≥ 2× mesh size); automatically fall back to blockMesh + topoSet/subsetMesh to remove boxes |
| Solver divergence (buoyant flow) | Failed jobs | Preset relaxation factors; initialize at low Ra before increasing temperature; automatic retries |
| Inaccurate DPE → U mapping | Electricity-cost bias | Let users calibrate with actual annual consumption ("My electricity bill last year was X €") |
| Weather API unavailable | Cannot autofill temperatures | Local caching; manual temperature entry always available |
| Windows 10 + Docker Desktop issues (WSL2 disabled, insufficient memory, slow file IO, CRLF) | Worker cannot run or is very slow | Startup self-checks; named data volume; `.wslconfig` guidance; `.gitattributes` enforces LF |
| 3D effects stutter on low-end devices | Poor experience | Automatic degradation (disable volume rendering, adaptive particle counts) |

## 12. Settled and Open Questions

Settled:
- OpenFOAM: ESI v2406 (openfoam.com, free GPL, official Docker image).
- Deployment: local docker compose, localhost:8080, no accounts, personal noncommercial use.
- Electricity prices: all user-entered, neither bundled nor retrieved.
- Weather: outdoor temperature only (manual entry, optional automatic retrieval).
- Platform: Windows 10 + Docker Desktop (WSL2), 8 GB RAM.

- Surrogate deployment: S1 (lookup tables) / S2 (POD + regression) run in the frontend (JS / onnxruntime-web); S3 (3D U-Net / FNO) runs in the api container.
- Comfort: temperature thresholds only (comfort-zone mean temperature ≥ target, and proportion of time meeting it); no PMV/PPD.
- Heaters are thermostat-controlled: steady-state mean power = min(rated power, UA_total × (setpoint temperature − outdoor temperature)), where UA_total includes walls, windows, and infiltration; CFD uses this equivalent power and reports duty cycle and an "insufficient power" warning.

Open:
1. CPU core count? (Known: Windows 10 x86, 8 GB RAM)—determines dataset-generation time.

## Appendix A: Glossary

| Term | Description |
|---|---|
| DPE | Diagnostic de Performance Énergétique, the French home energy-performance assessment (A–G) |
| TRVE / Tarif Bleu | French regulated electricity tariff (EDF) |
| HP / HC | Heures Pleines / Heures Creuses, peak / off-peak hours |
| Tempo | EDF dynamic tariff, with different prices for blue/white/red days |
| Fil pilote | Standard French electric-heater control wire, switching Confort/Eco/Hors-gel modes |
| ACH | Air changes per hour |
| Rez-de-chaussée / dernier étage | Ground floor / top floor |
| U-value | Thermal transmittance in W/(m²·K); lower values mean better insulation |
| CFD | Computational fluid dynamics |
| ADEME | French Environment and Energy Management Agency |
| MaPrimeRénov' | French government subsidy for energy-efficiency renovations |
