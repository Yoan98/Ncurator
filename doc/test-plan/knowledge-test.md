# NCurator-Desktop 知识库测试计划

## 1. 总体目标

- 本计划定义知识库专项回归，对标 `ai-test`，全部是 backend。
- 通用测试、runner 与断言规则遵循 `doc/test.md`。
- 正式 case 放在 `tests/case/knowledge/<suite>/**`。

本计划覆盖两类：

1. `foundation`：知识库功能（扫描、建索引、job、索引中拦截检索、用户取消更新索引、索引速度线程预算、多地址顺序更新）。
2. `optimization`：召回率、检索与索引效果。当前无 case，后续做优化时再设计。

边界：

- 不替代 Settings「更新索引」产品 E2E。E2E 在真实 Electron 里对独立小目录各做一次慢/高速更新索引，断言同一嵌入进程的操作系统线程增量；本计划在干净 Node 子进程里用生产 `session_options` 建真实 embedding session，断言线程增量随档位变化。
- 不替代 `ai-test` 中的 kb tool / live。
- 不登记 unit。函数级补足仍在 `tests/case/unit/knowledge/**`。

## 2. Suite 设计

### 2.1 `foundation`

- 目标：守住知识库可回归的功能主链。
- 约束：走生产 store / job / 扫描 / worker / 嵌入 executor；禁止假 executor 或假 `assertKbAvailable`。索引速度 case 必须在独立 Node 进程里建真实 embedding session，并用操作系统线程数证明档位生效，不测 UI、不测墙钟 / CPU%。
- 目录：`tests/case/knowledge/foundation/<case>.test.ts`

### 2.2 `optimization`

- 目标：召回率、检索与索引效果评测。
- 当前无登记 case。

## 3. 领域规则

- 全部是 backend，禁止导入 Renderer。
- 线程预算以逻辑核 `N` 为准（Mac / Windows 相同）：
  - 慢速：`max(1, floor(N/2))`，关闭 spinning
  - 高速：`max(2, N - reserve)`，`reserve = N≤8 ? 1 : 2`
  - 操作系统线程增量：Mac 期望 `delta >= intraOp`；Windows 上 ORT/Eigen 把调用线程算进池，`Get-Process.Threads.Count` 增量通常是 `intraOp - 1`，断言下限为 `intraOp - 1`。两档增量之差仍须等于 intraOp 之差。
- 多文件地址更新索引必须顺序 kickoff，且 `workspacePrepare` IPC 等到该地址 job 终态。
- 用户取消更新索引后，已完成保留，未完成回退为可索引或原来的失败，不得标成取消失败；后续地址不得 kickoff；`cancelled` 不拦截检索。程序关闭中断仍收敛为失败，与用户取消区分。
- 不在 `foundation` 比较召回优劣。

## 4. 回归清单

### 4.1 `foundation`

#### `workspace-scan-contract`

- 测试类型：`backend`
- What：扫描真实目录后生成文件索引记录，并由派生摘要支撑刷新。
- Why：检查更新的 backend 主链；漏扫或摘要错会导致页面可索引数失真。
- How：隔离 workspace fixture，写入可见/隐藏目录后调用扫描服务并读取索引记录与摘要。
- Oracle：支持文件进入索引记录；忽略目录不入库；摘要与扫描进度可支撑页面刷新。

#### `workspace-index-job-store-contract`

- 测试类型：`backend`
- What：`workspace_index_job` 支持创建、active 查询、阶段进度更新、失败收敛和 cancelled 终态。
- Why：更新索引的进度恢复、中断收敛与用户取消都依赖 job store。
- How：真实 job store 写入 running/failed/cancelled 记录并查询 active、进度与批量失败。
- Oracle：active 取最新 running，cancelled 不是 active；进度可持久化读取；running job 可批量失败；cancelled 后 `hasRunningPrepareJob` 为 false，对齐 `SET-WORKSPACE-004-AC3`、`SET-WORKSPACE-004-AC4`、`SET-WORKSPACE-004-AC5`、`SET-WORKSPACE-004-AC14`。

#### `workspace-index-worker-contract`

- 测试类型：`backend`
- What：真实文档加载、worker 请求与缓存复用返回可检索内容。
- Why：worker 输入输出或切批失真会让更新索引静默丢文件或打爆嵌入。
- How：在隔离 workspace 中经生产 worker handler（Node in-process）处理真实 Markdown/TXT/DOCX/DOC/PDF/XLSX；缓存来自真实加载器，比较复用结果。纯切批、手写缓存接入和故障 worker 恢复归 `tests/case/unit/workspace/files/workspace-index-worker-contract.test.ts`。
- Oracle：真实正文包含输入标记，空文本保留文件名锚点，DOC/PDF 可检索正文，XLSX 仅有元数据且无单元格内容；缓存复用与真实解析相等，不支持类型返回文件级错误。

#### `workspace-interrupted-job-recovery-contract`

- 测试类型：`backend`
- What：启动恢复把遗留 running job 和条目级执行中状态收敛为失败。
- Why：进程被杀后必须能退出“执行中”，否则无法再次更新索引。
- How：写入遗留 running job 与执行中文件状态后走启动恢复。
- Oracle：job 与条目收敛为失败，对齐 `SET-WORKSPACE-004-AC5`。

#### `kb-indexing-blocks-search`

- 测试类型：`backend`
- What：prepare 索引进行中时 `kb_search` / `kb_list_documents` 失败，并投递模型可读错误。
- Why：更新索引期间检索必须明确失败，避免半库结果。
- How：隔离 sqlite 写入文件 / 网页 running prepare job，再走生产 `createAiRunContext` 调用两个工具并检查投递文案；显式准备真实模型后，验证 running scan 与 prepare 的 succeeded / failed / cancelled 终态不拦截空库查询。
- Oracle：两工具抛出正在更新知识库错误；模型侧结果包含正在更新知识库原因及当前状态下停止调用 KB 的指引，对齐 `SET-WORKSPACE-004-AC9`、`SET-WEB-004-AC8`。
- 最新验证：2026-10-09 本轮通过；原始日志：`tests/logs/knowledge/foundation/kb-indexing-blocks-search/20261009-104411-354-11c9b53e`。

#### `kb-availability-contract`

- 测试类型：`backend`
- What：所有 KB 工具统一检查模型安装 / 初始化，空库和空范围正常返回空结果；索引入口同样不隐式下载。
- Why：模型缺失不能被关键词或列表绕过；空库不能误判为知识库故障。
- How：独立模型目录中用真实 ModelService、EmbeddingService / Transformers executor、store 和 createAiRunContext；分别准备空目录、不完整下载目录、文件齐全但内容损坏的模型目录，调用两个 KB 工具与文件 / 网页索引入口。健康模型显式准备后验证空库、限定空范围、无文件地址的全局网页、删除与恢复。不替换执行器和就绪检查；Node 使用同一生产 executor in-process，Electron utilityProcess 由 Workbench E2E 验证。
- Oracle：缺失 / 不完整模型在所有 strategy 和列表中返回错误且目录不变；损坏模型初始化错误；索引入口缺失模型失败且无资料写入；健康模型空库 / 空范围返回 items=[]、total=0；全局网页能检索；模型删除后下一次 KB 失败，恢复后可用；Unit embedding-service 补充关闭后不可重新打开的 executor 生命周期，验证删除使用可重新加载的 reset，而非终态 close。
- 最新验证：2026-10-09 本轮通过；原始日志：`tests/logs/knowledge/foundation/kb-availability-contract/20261009-105205-164-3693677b`。

#### `index-speed-thread-budget`

- 测试类型：`backend`
- What：慢速/高速按逻辑核数映射不同的 ORT `session_options`；独立进程里真实 embedding session 的操作系统线程数随 `intraOpNumThreads` 增加。
- Why：档位是否有效，看的是建 session 前后的操作系统线程增量，不是只读配置。
- How：对 4/8/16 核分别计算慢速与高速预算；用生产 `toOrtSessionOptions(resolveOrtThreadBudget)` 在两个新 Node 进程里各建一次真实 embedding session 并 embed；Mac 用 `ps -M`、Windows 用 `Get-Process.Threads.Count` 比较建 session 前后的线程数。Electron `utilityProcess` 的闭环在 Settings `workspace-index-speed`。
- Oracle：慢速 2/4/8 且关闭 spinning；高速 3/7/14 且开启 spinning；每个子进程 `after - before` 在 Mac 上不少于该档 intraOp，在 Windows 上不少于 `intraOp - 1`（ORT/Eigen 把调用线程算进池，OS 线程增量通常是 `intraOp - 1`）；高速增量大于慢速，且两档增量之差等于 intraOp 之差。

#### `prepare-workspaces-sequentially`

- 测试类型：`backend`
- What：多地址更新索引按顺序等待前一个完成再启动下一个；首个结果 cancelled 时不再启动后续地址。
- Why：并行 kickoff 会叠满嵌入线程，和慢/高速档位冲突；取消必须拦住还没开始的地址。
- How：三个真实工作目录各写一个 txt，用生产 `prepareWorkspacesSequentially` 依次调用 `WorkspaceKnowledgePrepareService.indexLocalFile`（切分走生产 `prepareWorkspaceSource`，嵌入走生产 embedding），记录 start/end。另用 `shouldContinue` 在首个结果 cancelled 时停止，确认后续 prepare 不被调用。
- Oracle：事件顺序为每个地址 start→end 后再开始下一个，对齐 `SET-WORKSPACE-004-AC11`；cancelled 后不再 kickoff 后续地址，对齐 `SET-WORKSPACE-004-AC15`。

#### `workspace-index-cancel-contract`

- 测试类型：`backend`
- What：取消 prepare 后 job 为 cancelled；已完成保留；未完成回退且不失败；后续地址不启动；检索恢复。网页 crawling/indexing 同样回退。
- Why：用户取消不是故障，剩余资料必须还能再次更新索引，也不能继续占用嵌入或拦截检索。
- How：生产 store + 取消控制器；多文件/多地址用可闸门的索引函数在第二份未写库时取消；网页写执行中条目后调同一回退。另用可闸门的多批 `buildWorkspaceKnowledgeVectors` 验证取消后不再送后续批次。另写入已成功 job 后再走取消收口，确认不改写终态。
- Oracle：job 为 cancelled；已索引保留；未完成回到 `needs_index` 或原 `failed`，不出现成批失败，对齐 `SET-WORKSPACE-004-AC14`、`SET-WORKSPACE-004-AC16`；后续地址不启动，对齐 `SET-WORKSPACE-004-AC15`；取消后 `hasRunningPrepareJob` 为 false，检索不再拦截，对齐 `SET-WORKSPACE-004-AC9`、`SET-WEB-004-AC8`；网页执行中条目回到进入本轮前状态，对齐 `SET-WEB-004-AC12`、`SET-WEB-004-AC13`。当前文件多批嵌入时，取消后只完成当前批、后续批不得调用，对齐 `SET-WORKSPACE-004-AC16`。已是 succeeded 后再取消，状态仍为 succeeded，对齐 `SET-WORKSPACE-004-AC17`。不测弹框。

### 4.2 `optimization`

无。
