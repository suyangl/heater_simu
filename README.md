# HeatSimu · M0 房间热环境实验室

个人本地使用，无账户。浏览器表单 → FastAPI/SQLite → OpenFOAM v2406 → PyVista → React/R3F 温度切片。估算结果，不构成 DPE 或能源审计。

## 多外墙、门窗与家具

- 最多 15 个家具长方体；床/桌/椅/柜/沙发/书架/自定义提供初始尺寸，可改尺寸、位置及名称。类型和名称不参与物理计算，所有家具仍为绝热实体；悬停显示名称。
- `exterior_walls: ["N", "E"]` 可设置转角房；未选墙面为已供暖邻室（绝热），地板/天花板仍绝热。当前换气模型要求至少一面外墙且外墙不透明总面积非零；ACH 换气损失按此总面积分摊。
- `openings` 最多 24 项：`{type: "window"|"door", wall, offset, width, height, sill, u_value?}`。窗只能在外墙；门的 sill 必须为 0。外门默认 U=1.8 W/(m²·K)，与 DPE 无关，可在 (0, 7] 编辑；这是关闭的保温门假设，不模拟开门气流。内门绝热但保留独立 patch。窗按 DPE 的窗 U 值。所有外边界沿用 Rsi 修正。
- 门窗须在墙内，同墙门窗不能重叠，家具/暖器不能穿墙、互相重叠或遮挡门窗；422 会在页面显示具体原因。过多不同边界坐标导致最小分块数超过 150k 时会明确拒绝，而非无限尝试降分辨率。
- 青色=窗、金色=外门、紫色=内门；精算 KPI 按外墙/窗/外门汇总 wallHeatFlux 散热（并保留逐 patch 数据）。
- 省略新字段仍使用原 `exterior_wall` + `window` 输入。原生成器的 default 和全部 70 个 DoE 项的完整文件 SHA256 fixture（含 project.json）保护逐字节兼容。新字段显式提供后优先于旧字段。S1 按标准化门窗/外墙/家具几何匹配，标签不影响匹配，新增门窗/墙或不匹配家具会要求精算。
- 训练容器是不可变旧镜像，不重建/重启它；其现有数据、表和正在执行的批次不变。未来重建训练器仍受原 physics-source fingerprint 审计保护，不可绕过该检查来混用数据版本。
- 本 VM 15 个非对齐、不同高度箱体的实测：137448 cells，生成 1.05 s，blockMesh 12.37 s，checkMesh `Mesh OK.`，自适应网格间距 0.1021 m。网格仍受 150k 总 cell 上限保护；这不是网格独立性/精度验证。

## Windows 10 启动

1. 安装兼容当前 Windows 10 版本的 Docker Desktop，启用 BIOS 虚拟化、WSL2 与 Docker 的 Linux containers / WSL2 backend。先启动 Docker Desktop，等待引擎就绪。
2. For Windows 10 with an i7 (4 physical cores / 8 logical processors) and 8 GB RAM, create or edit `%UserProfile%\.wslconfig`:
   ```ini
   [wsl2]
   memory=4GB
   processors=4
   swap=2GB
   ```
   After saving, run `wsl --shutdown` in PowerShell, then restart Docker Desktop to apply the limits.
3. 下载或 clone 仓库。在仓库根目录 PowerShell 运行 `powershell -ExecutionPolicy Bypass -File .\start.ps1`；也可手动运行 `docker compose up -d --build`。
4. 打开 **http://localhost:8080**。首次构建需要网络下载镜像与依赖，之后仿真本地运行。等待 API 和 worker 就绪后点击「开始模拟」。

The default interactive profile runs **one case at a time**, using **2 MPI ranks** and approximately **600 MB peak solver memory per case**. Allow **~40–50 minutes** for a detailed OpenFOAM simulation on this hardware; geometry and other system load affect runtime. The 4 GB WSL2 memory cap leaves RAM available for Windows and the browser.

仅发布 localhost:8080；API 不直接暴露。数据保存在 Docker 命名卷 `heater_data`，不通过 Windows 文件系统挂载，以避免大量 OpenFOAM 小文件 IO 变慢。`docker compose down` 保留数据；`docker compose down -v` **永久删除所有任务**。

## 使用

- 输入长宽高、唯一外墙与窗、DPE A–G、室外温度、暖器位置/功率及最多 5 个家具盒子。X 是房间长度、Y 是宽度、Z 向上；N 对应 Y=宽度，E 对应 X=长度。窗与暖器偏移均沿正 X（N/S）或正 Y（E/W）。
- 家具预设是实体盒子（书桌也没有桌下通风空间），添加后需编辑位置；非法重叠由 API 拒绝。
- 编辑时几何实时更新，温度必须提交后重新求解。计算期间锁定输入，避免把旧场叠加到新几何。
- 完成后拖动切片高度、切换竖直中线切片；蓝→红代表当前结果全域温度范围。固体内无数据。
- 默认额定功率 **1500 W**、恒温设定 **19°C**。`min(额定功率, UA_total × max(0, 设定温度 − 室外温度))`（默认 405.3 W）仅为解析/RC 估计及 CFD 初始功率。实际使用 CFD 恒温器迭代控制，输出解析估计、CFD 平均功率、调节次数、占空比及由 CFD 判断的功率不足提示。ACH 按 DPE 为 0.3/0.4/0.5/0.6/0.7/0.9/1.2；渗风等效导热系数 `0.34 × ACH × 房间体积` 合并到不透明外墙的 h，不模拟开口气流。可通过结果页的 `?job=任务ID` 地址重新查看对应房间和结果。

## 模型与资源

- 官方 `opencfd/openfoam-default:2406`（已通过 registry manifest 验证 tag）。空气 perfectGas、Cp=1005、μ=1.8e-5、Pr=0.71，重力 -Z，kEpsilon 稳态 buoyantSimpleFoam，配置参考 comfortHotRoom。**M0 不含辐射**：Rsi=0.13 中的大部分为辐射换热，纯对流 CFD 的耦合较弱，不能把解析功率当成维持均温的真实功率。恒温器只校准当前对流模型，不代表完整建筑能耗；辐射将在后续里程碑加入。不应把正常进程退出视为收敛。
- Python 直接生成 **贴合盒子几何的多块 blockMesh**：在家具、暖器与窗的边缘分割坐标，省略固体块，相邻块共用顶点。无需 STL 或 snappy，固体表面与窗均为精确边界 patch。背景目标 8 cm，大房间自动粗化，背景总数 ≤150k；薄间隙会产生高纵横比单元，不宜用很小间隙。
- 外墙/窗为 `externalWallHeatFluxTemperature` coefficient。先按 U 和 ACH 得到外墙 `h_eff=U+0.34×ACH×V/不透明面积`，窗 `h_eff=U_window`；因 U 已含室内表面热阻 Rsi=0.13 m²K/W，实际 CFD 系数用 `h_cfd=1/max(1/h_eff−0.13, 1/50)`，上限 50 W/(m²·K)，避免零/负热阻，Ta=室外温度。
- 暖器所有表面绝热（zeroGradient T），速度 noSlip。`topoSet` 将前方和上方约 10 cm 空气层并集建立为 `heaterAir` cellZone，排除实体，至少四个单元；`scalarSemiImplicitSource` 在 h 方程以 `volumeMode absolute` 注入受控总功率 Q。默认源区 180 个单元。`limitTemperature` 233–500 K 仅作安全网，不把限温当作收敛措施。
- 单 worker、最多一个任务；容器 CPU 限额 2 核、worker RAM 上限 3 GB。`OPENFOAM_NPROCS` 默认 2，MPI 两进程、Scotch 分区；设为 1 可串行。恒温器首块 1500 次迭代（末 400 次平均），之后每块 700 次（末 300 次平均），以空气单元体积加权均温更新 `Q_new=clamp(Q×(T_set−T_out)/(T_mean−T_out),0,P_rated)`，只改 fvOptions 并从最新场继续，不重置流场。控制均温距设定 ≤0.5°C，或在额定功率仍不足时，固定 Q 再计算最终 600 次平均；最终均温若漂移超差则报错。不需要加热时 Q=0，不提供制冷。最多八块调节，整个控制/最终平均过程限时 1200 秒；重启中断的任务会标记 failed。
- 每块重启 `fieldAverage`；最终结果仅使用固定功率最后 600 次的 TMean、UMean、pMean 和同窗完整 `wallHeatFlux` 样本。PyVista/可视化使用平均场，空气均温按单元体积加权。采样 56×48×32 点、X 最快排列、little-endian Float32 base64，固体/无效位置在二进制中用 NaN 屏蔽，JSON 标量无 NaN。热平衡为 `|平均净热损失−cfd_heater_power_w|/cfd_heater_power_w`；`effective_power_w` 与占空比同样使用 CFD 受控功率，`analytic_effective_power_w` 保留解析估计。缺少均值场、积分样本或最终时间不一致即报错，**不强制把结果归一到功率**。
- M0 不代表经验证的湍流自然对流工程模型；高 Rayleigh 数、极端功率/低 U 值、贴合家具阻塞外墙可能导致高温或求解失败。未达到平衡的结果会在 KPI 中显示误差，e2e 对默认例强制 <10%。生产级 CFD 校准、湍流与网格独立性验证属后续工作。

## 开发与检查

```sh
docker compose up -d --build
docker compose exec -T api python -m pytest -q
bash scripts/e2e.sh
docker stats --no-stream
docker compose logs worker
```

`scripts/e2e.sh` 在 Linux / WSL / Git Bash 执行，自动启动 compose、提交 `/api/example`，等待任务完成，检查室温（恒温器 ±0.5°C）、最高温位置、热平衡和数据大小。pytest 覆盖生成字典、四向外墙、无家具及输入错误。

本机两核默认例已通过 API E2E：CFD 恒温功率 194.54 W（解析初值 405.3 W），7 块调节后最终平均窗 5701–6300，均温 19.10°C、最低/最高 15.39/27.54°C，平均热损失 191.32 W、能量误差 1.65%，78,458 单元，控制/最终平均耗时 1050.5 秒。该记录为平均量验收，不代表瞬时 SIMPLE 残差收敛，也不保证其他硬件或输入的耗时。

API：`GET /api/health`（含 worker 心跳）、`GET /api/example`、`POST /api/simulate`、`GET /api/jobs/{id}`（状态/日志尾）、`GET /api/jobs/{id}/result`。

## M1 · 数据集 v1（本步骤不构建 S1 表或改前端）

`trainer/doe-v1.json` 版本化定义 4 个固定家具/窗户的房间模板 × DPE A/C/E/G × 4 个暖器位置，共 **64 个训练案例**；固定随机种子另取 B/D/F 各 2 个组合，共 **6 个 holdout**。仅 M0 对流暖器、无辐射，室外 5°C、设定 19°C。额定功率**不是采样维度**：2500 W 只是沿用 M0 输入上限的统一求解安全上限；达到上限却不能维持设定的案例拒收，不能把截断功率当作所需功率。S1 的额定功率比较与温差缩放留给下一步骤。

```sh
# 8 GB 机器默认 2 CPU / 3 GB 容器、一次一个案例；后台运行，退出终端不影响
docker compose --profile train up -d --build trainer
# 同一命令可恢复：跳过已有且有效的 accepted 结果，每个案例累计最多两次尝试
docker compose logs -f trainer
docker compose exec -T trainer python -m trainer.dataset --status
# trainer 已退出时也可查询
docker compose --profile train run --rm --no-deps trainer --status
```

在更大机器上可显式增加容器配额，例如 Linux/WSL：`TRAIN_CPUS=6 TRAIN_MEMORY=12g docker compose --profile train up -d --build trainer`。自动并行度取容器 CPU/2 和内存（预留 1 GB、每案例预算 3 GB）的较小值，至少 1；训练容器关闭 MPI 默认 CPU 绑定，避免不同案例争抢相同两个核。每案例始终复用 worker 的两进程求解、恒温器、最终平均与后处理，不修改物理公式，不使用在线任务队列。可用 `docker compose --profile train run --rm --no-deps trainer --workers 1` 指定更低并行度。不要同时运行两个 trainer：数据集文件锁防止同目录重复计算。

数据在命名卷的 `/data/datasets/v1/`：`manifest.json` 保存完整设计、输入和物理源码 SHA256（定义/物理变更需新目录）；`batch.log` 为追加式 JSONL 日志，`status.json` 为最近完成事件的汇总；`--status` 实时读取逐案例元数据。`cases/<id>/metadata.json` 含 split、模板/位置、输入、解析 UA/功率、CFD 所需功率、均温/极值、能量误差、耗时与状态。`result.json` 保留原有平均网格及可视化字段。**只使用 status=accepted 的数据训练**：能量误差 >10%、均温偏离 19°C >0.5°C、功率不足或异常密度均拒收。失败/拒收也重试一次并保留每次元数据、错误及日志；中断的运行计作一次尝试，重试从新网格开始，绝不混用半截平均场。已成功案例删除大体积 OpenFOAM 工作目录，失败的最后一次工作目录保留排错。耗尽重试后不会在恢复时无限重跑。

测试：`docker compose run --rm --no-deps -v "$PWD:/review:ro" -w /review -e PYTHONPATH=/review/api:/review api python -m pytest -q -p no:cacheprovider api/tests trainer`（只读源码挂载不写 pytest 缓存）。

### 数据集恒温器与失败恢复

训练通过同一个 worker 的 opt-in `settled` 控制模式运行；交互任务仍使用原有控制方式及 **1200 s** 默认预算。训练的 `TRAIN_SOLVE_BUDGET` 默认为 **3600 s/次**，可显式调整。不是放宽验收：均温仍须距设定 ≤0.5°C，能量误差须 **<10%**。训练先在固定 Q 下等待相邻平均窗口温度变化 ≤0.15°C 且能量误差 <5%，再更新功率，避免把仍在冷却/升温的状态误当成平衡响应。更新使用受限、0.7 阻尼的正斜率 secant；斜率无效时退回阻尼比例更新，单次变化限制 ±35%。空气 RC 时间常数 >3000 s 时使用较长的 2000/1500 次初始/后续稳定块，其他情况为 1500/1000 次；每块末 800 次测量。达到目标后固定功率再做完整 **2000 次最终平均**；若漂移或不平衡则继续稳定/控制，而不是在第一次穿过设定温度时提前终止。所有温度/热损失均来自同一平均窗口，物理 BC、源区及有限体积字典不变。

每次尝试保存 `attempt-N-thermostat.json`，含各块的 Q、均温、热损失、能量误差与 settle/final 阶段。控制策略升级后，在 trainer **已停止**时执行：

```sh
docker compose stop trainer
docker compose --profile train build trainer
docker compose --profile train run --rm --no-deps trainer --reset-failed
# 本 VM 恢复时保留原来的并行配额
TRAIN_CPUS=6 TRAIN_MEMORY=12g docker compose --profile train up -d trainer
```

`--reset-failed` 只做归档/重置然后退出：完整旧 manifest、失败/拒收/中断目录移动至 `audit/retry-*`，累计尝试次数从 0 开始；有效 accepted 结果及元数据保持原字节不变，并在 manifest migration 中记录保留名单及旧控制器指纹。只适用于明确批准的收敛控制升级；改变房间设计或物理模型仍应使用新版本/目录。

### M1 / S1 即时查表预估

`python -m trainer.build_s1 --root /data/datasets/v1` 只读取 accepted 记录；不会提交求解任务、取得训练锁或修改案例。输出 `s1-v1.json`，包含 24×20×12 单位房间中心网格、uint16/base64 θ（65535 为固体/缺测掩码）、每例比例/偏移、k、形状统计、64 个训练组合的明确 availability 和四种完整预设。θ=(T−T_out)/(CFD 空气均温−T_out)，k=Q_required/[UA_analytic·(T_set−T_out)]；保留 averaged CFD 的空间形状。B/D/F holdout 不进入查表。

运行中的 trainer 不需要重建或停止。可从 API 容器读取当前数据生成快照，然后复制到前端：

```sh
docker compose run --rm --no-deps -v "$PWD:/review:ro" -w /review -e PYTHONPATH=/review/api:/review api python -m trainer.build_s1
docker compose cp api:/data/datasets/v1/s1-v1.json frontend/public/surrogate/s1-v1.json
docker compose up -d --build --no-deps api frontend
```

浏览器优先读取 `/api/surrogate/artifact`（named volume 当前快照），回退到构建时的 `/surrogate/s1-v1.json`；`GET /api/surrogate/manifest` 返回快照时间、availability、轴与验证结果。新案例不会自动进入已有快照，批次完成后重新构建/验证。房间/家具/窗户/暖器几何须在 **2 cm** 内匹配同一模板与位置；DPE 只按墙 U 在可用训练节点间线性插值 k 与 θ。区间内或已知精确节点为高置信度，超区间使用最近邻并标中，自定义/缺失分类组合则低置信度、不显示假预估。置信度表示插值覆盖条件，不是经过验证的误差保证。额定功率不影响 θ 或 k，只用于容量判定；功率不足时目标温度场不代表可达到的实际温度。M0 不含制冷，不对 T_set≤T_out 的工况生成供热预估。

前端移植与 `models.py` 相同的 UA（含窗与 ACH）；T=T_out+(T_set−T_out)θ，Q_required=k·UA_user·(T_set−T_out)。每次输入修改都取消旧精算视图并重算预估；不会自动提交精算。表面、流线和等温面仅显示在 OpenFOAM 结果中。

验证：`python -m trainer.validate_s1 --root /data/datasets/v1`。训练记录严格留一法，holdout 始终对只含训练记录的表验证；无同分类邻居会标记 unscored，不作为零误差。报告 θ 场误差乘基准 ΔT 的 RMSE（°C）、原始 CFD 温度场 RMSE、空气均温 MAE、功率 MAPE/最大相对误差及覆盖情况。当前仅有少量 accepted 节点，不能宣称达到完整数据集精度；批次完成后须重跑。测试：上述 pytest 命令以及 `cd frontend && npm ci && npm test && npm run build`（Node ≥22.12）。

### 交互精算的稳定恒温控制与预算

`/api/simulate` 使用数据集已验证的 settled 恒温器：同功率相邻平均温度漂移 ≤0.15°C、热平衡误差 <5% 后才更新功率；0.7 阻尼的有界割线更新；最后用 2000 步平均验证 ±0.5°C 和 <10% 热平衡。低 UA 房间使用更长的稳定块。额定功率不足仍以最终平均温度判断。辐射仍未包含。

交互默认求解预算 **2700 秒（45 分钟，2 进程）**，按已测小房间 20–30 分钟再留 50% 余量选择。可用 `INTERACTIVE_SOLVE_BUDGET=3600 docker compose up -d --no-deps worker` 调整（会重建 worker 容器；不要在精算中执行）。网格/后处理时间另计。界面显示实时已用时间、初始总耗时估计和求解预算；估计是 78,458 网格约 30 分钟的按网格量/进程数缩放，并非完成时间保证，机器负载和收敛都会影响它。

预算用尽不等于收敛：返回已完成测量中评分最佳的同步平均场，`kpi.not_settled=true`，UI 显著警告并将供暖能力标为“尚未确认”。评分为温度偏差/0.5、能量误差/0.1、同功率相邻温漂/0.15 之和（无同功率前点时漂移惩罚取 1°C）；功率封顶或无供暖需求不以目标温差评分。保存/恢复完整 TMean/UMean/pMean 时间目录、对应源功率及热通量平均窗口，不使用中断中的字段。超时先停止 launcher 并终止整个独立 session（MPI ranks 有独立进程组），避免孤儿求解器继续写入恢复后的 case。若预算在首个完整平均场产生之前耗尽，任务完成但 `field_available=false`，明确提示没有有效 CFD 温度场，不伪造温度。求解发散、缺失/无效字段仍返回错误，不伪装成预算不足。

trainer 调用与 settled 算法、阈值、DoE 均未改变；正在运行的 trainer 镜像/容器和数据不修改。由于共享 `runner.py` 的交互调度/恢复代码变化，**新镜像的源文件 fingerprint 会变化**。不要用新镜像无审计续写现有 v1；现有容器继续原批次，新启动训练须使用版本化目录或按已有显式迁移策略处理。`scripts/e2e.sh` 仅重建 api/frontend/worker，不触碰 trainer，默认验收要求 `not_settled=false`。

### ParaView 风格平均场

结果视图使用石板灰背景、温度着色边界、速度着色流线与半透明暖羽流等温面，配有白色虚线包围框、XYZ 方向器和带细刻度的温度/风速色标。墙面保持透明，可分别切换墙面、表面着色、流线、等温面和温度切片。旧结果缺少新字段时仍可显示几何与原有温度切片；不可用图层会禁用。

`result.json` 保留原有 T 网格，并增加同网格 `U`（此处为速度模，`quantity=speed_m_s`、`components=1`）。无效/实体点沿用 T 的 NaN 掩码。`surfaces` 按边界 patch 导出三角网格，`isosurface` 默认取空气均温加 0.6 倍最大温升；两者含 `positions`、`indices`、逐顶点 `T`（°C）与 `speed`（m/s）。`streamlines` 从暖器空气层及稀疏室内种子沿平均速度积分，含相同逐点字段以及 `indices`/`offsets` 多段线连接表。坐标保持 OpenFOAM XYZ（Z 向上），前端转换到 Three.js 坐标。所有二进制数组均为 little-endian Float32/base64，连接表为 Uint32/base64。

表面按 patch 简化、等温面限制约 4000 个三角形，流线最多 180 条、每条最多 96 点；整体 JSON 限制 3 MB。静止或等温场可没有流线/等温面。流线为平均场中的空间积分线，不代表瞬态粒子轨迹。

目录：`api/app` 模型、网格/字典生成、队列与路由；`worker` OpenFOAM 运行与重采样；`frontend` 中文 3D 编辑器；`scripts/e2e.sh` 端到端验收。设计依据见 [PRD](docs/PRD.md)。

### Seasonal electricity estimate (M2 part 1)

Below the temperature results, open **Electricity cost / 电费**. Add, name and compare Base, HP/HC, Tempo or custom 24×7 profiles. Enter every energy rate and the monthly subscription yourself (including an explicit 0 for a free subscription); missing prices leave costs unavailable without disabling temperature or energy results. HC boundaries use whole hours, may cross midnight and allow up to two periods. Custom rates have an explicit user-entered bulk-fill action. Profiles, active selection and climate/schedule assumptions persist in browser localStorage (`heatsimu.billing.v1`); there is currently no project JSON export/import UI.

The client-only one-node RC model uses displayed CFD heat loss first, otherwise displayed S1 heat loss, divided by the project's design temperature difference; without a valid result it uses the existing analytic envelope UA. No endpoint, price fetch or weather fetch is used. Effective capacities are **80 / 165 / 260 kJ/(m² floor·K)** for light / medium / heavy inertia, with an editable override. The exact hourly RC solution limits heater power to its rating; comfort counts hour ends reaching comfort minus 0.5°C. This is not a transient CFD field or a validated utility-bill forecast.

Editable Paris-like outdoor assumptions for Oct–Apr are **12.5, 8, 5.5, 4.9, 5.6, 8.8, 11.5°C**, with a **±4°C** daily cycle (minimum 06:00, maximum 15:00). The reference season is **2021-10-01 through 2022-04-30**, with UTC weekdays and no DST. Comfort follows the current project by default; eco is **16°C**. Weekday comfort hours are **07–09 and 17–23**; weekends **08–23**.

Tempo defaults to requested **147 blue / 43 white / 22 red** season days, not an official calendar. Red uses the coldest Nov–Mar weekdays, white the next coldest days, and blue the remainder; the panel reports actual counts and any clamping/blue-count mismatch. Monthly € includes the whole contract subscription, not a room allocation. The kVA warning considers the heater alone and explicitly ignores other appliances. The typical-day curve averages all season days and colours each hour by its most frequent tariff period. Comparing profiles reuses the same hourly consumption.

### Saving planner (M2 part 2)

The **Saving planner / 省电规划** below billing ranks lower comfort/eco targets, shorter schedules, saved tariffs, small retrofits, better DPE envelopes and available S1 heater positions. Each measure is evaluated with the RC model; tariff-only switches reuse identical hourly consumption. Tick compatible measures for a combined re-simulation, not a sum of percentages. Alternative setpoints, window treatments, DPE targets, tariffs and positions are mutually exclusive. Apply changes to update the project/billing baseline; project changes refresh S1 and can recalibrate UA, so the applied bill can differ from the preview.

Editable illustrative assumptions: **0.079 kgCO₂e/kWh** for French electric heating (ADEME Base Carbone/DPE convention), window-U multipliers **0.85** for heavy curtains or **0.90** for film, and ACH multiplier **0.80** for draught-proofing. Retrofits scale calibrated UA using the existing analytic formula and are **seasonal RC only**: they do not alter CFD boundary conditions or the 3D temperature field. Applied retrofit factors persist in billing and can be reset. DPE upgrades are envelope proxies, not renovation quotes; official MaPrimeRénov’ and CEE links are provided without fetching amounts. Furniture effects and convector-to-inertia replacement remain unquantified tips.

Selections, investments and assumptions persist under `heatsimu.planner.v1`. Empty investment means no payback; combined payback requires every selected investment and positive euro savings. Incomplete tariffs rank by kWh with no euro savings. Comfort changes use each scenario's own target/schedule, not occupied-zone comfort, and reductions are flagged. No printable/PDF view is included.