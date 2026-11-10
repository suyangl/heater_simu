# HeatSimu · M0 房间热环境实验室

个人本地使用，无账户。浏览器表单 → FastAPI/SQLite → OpenFOAM v2406 → PyVista → React/R3F 温度切片。估算结果，不构成 DPE 或能源审计。

## Windows 10 启动

1. 安装兼容当前 Windows 10 版本的 Docker Desktop，启用 BIOS 虚拟化、WSL2 与 Docker 的 Linux containers / WSL2 backend。先启动 Docker Desktop，等待引擎就绪。
2. 8 GB 内存机器建议在 `%UserProfile%\.wslconfig` 写入：
   ```ini
   [wsl2]
   memory=4GB
   processors=4
   swap=4GB
   ```
   保存后在 PowerShell 运行 `wsl --shutdown`，再重启 Docker Desktop。
3. 下载或 clone 仓库。在仓库根目录 PowerShell 运行 `powershell -ExecutionPolicy Bypass -File .\start.ps1`；也可手动运行 `docker compose up -d --build`。
4. 打开 **http://localhost:8080**。首次构建需要网络下载镜像与依赖，之后仿真本地运行。等待 API 和 worker 就绪后点击「开始模拟」。

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

目录：`api/app` 模型、网格/字典生成、队列与路由；`worker` OpenFOAM 运行与重采样；`frontend` 中文 3D 编辑器；`scripts/e2e.sh` 端到端验收。设计依据见 [PRD](docs/PRD.md)。