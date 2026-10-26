# NCurator-Desktop 知识库测试计划

## 1. 总体目标

- 本计划定义知识库专项回归，对标 `ai-test`，全部是 backend。
- 通用测试、runner 与断言规则遵循 `doc/test.md`。
- 正式 case 放在 `tests/case/knowledge/<suite>/**`。

本计划覆盖两类：

1. `foundation`：知识库功能（扫描、建索引、job、索引中拦截检索、用户取消更新索引、索引速度线程预算、多地址顺序更新）。
2. `optimization`：召回率、检索与索引效果。

边界：

- 不替代 Settings「更新索引」产品 E2E。E2E 在真实 Electron 里对独立小目录各做一次慢/高速更新索引，断言同一嵌入进程的操作系统线程增量；本计划在干净 Node 子进程里用生产 `session_options` 建真实 embedding session，断言线程增量随档位变化。
- 不替代 `ai-test` 中的 kb tool / live。
- 函数级补足放在 `tests/case/unit/**`，本计划只引用证据，不另登记 Unit。

## 2. Suite 设计

### 2.1 `foundation`

- 目标：守住知识库可回归的功能主链。
- 约束：走生产 store / job / 扫描 / worker / 嵌入 executor；禁止假 executor 或假 `assertKbAvailable`。索引速度 case 必须在独立 Node 进程里建真实 embedding session，并用操作系统线程数证明档位生效，不测 UI、不测墙钟 / CPU%。
- 目录：`tests/case/knowledge/foundation/<case>.test.ts`

### 2.2 `optimization`

- 目标：召回率、检索与索引效果评测。

## 3. 领域规则

- 全部是 backend，禁止导入 Renderer。
- 线程预算以逻辑核 `N` 为准（Mac / Windows 相同）：
  - 慢速：`max(1, floor(N/2))`，关闭 spinning
  - 高速：`max(2, N - reserve)`，`reserve = N≤8 ? 1 : 2`
  - 操作系统线程增量：Mac 期望 `delta >= intraOp`；Windows 上 ORT/Eigen 把调用线程算进池，`Get-Process.Threads.Count` 增量通常是 `intraOp - 1`，断言下限为 `intraOp - 1`。两档增量之差仍须等于 intraOp 之差。
- 多文件地址更新索引必须顺序 kickoff，且 `workspacePrepare` IPC 等到该地址 job 终态。
- 用户取消更新索引后，已完成保留，未完成回退为可索引或原来的失败，不得标成取消失败；后续地址不得 kickoff；`cancelled` 不拦截检索。程序关闭中断仍收敛为失败，与用户取消区分。
- 普通文件／网页 running prepare job 与模型不匹配均阻断全部 KB 搜索策略和资料列表；只检查更新不阻断。切换、启动和退出恢复不自动重嵌；按现有任务由用户手动重建，失败不 fallback。
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
- How：在隔离 workspace 中经生产 worker handler（Node in-process）处理真实 Markdown/TXT/DOCX/DOC/PDF/XLSX；旧版 DOC 使用政府网站发布的中文原件 `长江干线（江苏段）大型船舶通航安全风险分级管控办法（初稿）.doc`。缓存来自真实加载器，比较复用结果。纯切批、手写缓存接入和故障 worker 恢复归 `tests/case/unit/workspace/files/workspace-index-worker-contract.test.ts`。
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
- Oracle：两工具抛出预设英文索引更新错误；模型侧结果保留同一原因及当前状态下停止调用 KB 的英文指引，对齐 `SET-WORKSPACE-004-AC9`、`SET-WEB-004-AC8`。

#### `kb-availability-contract`

- 测试类型：`backend`
- What：全部 KB 搜索与列表统一检查模型可用性和索引身份；健康模型下空库与空范围返回空结果，不隐式下载或重建。
- Why：模型或索引不可用时必须明确报错，避免通过关键词或列表绕过失效状态，且不能悄悄使用其他模型。
- How：独立模型目录中用真实 ModelService、EmbeddingService / executor、store 和 createAiRunContext，验证模型缺失、不完整、损坏、删除恢复及远程选择；既有正文与空库分别调用关键词、向量、混合及列表。保留真实文件／网页索引入口和普通 prepare job 门禁检查，远程真实服务验证与 Unit 模拟端点严格区分。
- Oracle：全部 KB 搜索及列表统一校验模型和全局索引身份；缺失、损坏、运行任务及身份不匹配时明确报错，不返回部分结果或关键词回退。选择和启动不重建，切回完整匹配模型恢复。健康模型下空库／空范围 items 为空且 total 为 0；不隐式下载。
- 覆盖状态：本用例覆盖真实本地模型及全策略门禁、远程配置切换后失效与切回恢复；真实远程手动重建仍需独立 live 证据。

#### `index-speed-thread-budget`

- 测试类型：`backend`
- What：慢速/高速按逻辑核数映射不同的 ORT `session_options`；独立进程里真实 embedding session 的操作系统线程数随 `intraOpNumThreads` 增加。
- Why：档位是否有效，看的是建 session 前后的操作系统线程增量，不是只读配置。
- How：对 4/8/16 核分别计算慢速与高速预算；用生产 `toOrtSessionOptions(resolveOrtThreadBudget)` 在两个新 Node 进程里各建一次真实 embedding session 并 embed；Mac 用 `ps -M`、Windows 用 `Get-Process.Threads.Count` 比较建 session 前后的线程数。Electron `utilityProcess` 的闭环在 Settings `workspace-index-speed`。
- Oracle：慢速 2/4/8 且关闭 spinning；高速 3/7/14 且开启 spinning；正常取证时每个子进程 `after - before` 在 Mac 上不少于该档 intraOp，在 Windows 上不少于 `intraOp - 1`（ORT/Eigen 把调用线程算进池）；高速 `after` 大于慢速，且两档增量之差等于 intraOp 之差。仅当 Windows 两档增量均为 0 时，允许以两档 ready 稳态线程数之差验证，差值须为正且与 intraOp 档位差的偏差不超过 1；其他情况不得使用此分支。

#### `prepare-workspaces-sequentially`

- 测试类型：`backend`
- What：多地址真实索引按顺序等待前一个完成再启动下一个。
- Why：避免多个地址并行占用嵌入线程，验证顺序编排与真实索引服务能够协作。
- How：三个真实工作目录各写一个 txt，用生产 `prepareWorkspacesSequentially` 依次调用 `WorkspaceKnowledgePrepareService.indexLocalFile`（切分走生产 `prepareWorkspaceSource`，嵌入走生产 embedding），记录 start/end。
- Oracle：各地址完成真实索引，事件顺序为每个地址 start→end 后再开始下一个，对齐 `SET-WORKSPACE-004-AC11`。首个结果 cancelled 后停止调用的函数契约由 `tests/case/unit/workspace/files/workspace-index-worker-contract.test.ts` 补充 `SET-WORKSPACE-004-AC15`，不作为本 backend 的真实取消链路证据。

#### `workspace-index-cancel-contract`

- 测试类型：`backend`
- What：生产取消控制器与真实 Store 协作，保留已完成文件 / 网页，将执行中条目回退为进入本轮前的可索引或失败状态。
- Why：用户取消不是故障，剩余资料必须还能再次更新索引，也不能继续占用嵌入或拦截检索。
- How：向真实 Store 准备已完成、执行中、待处理和旧失败条目；控制器记住各条目原状态后接收取消，检查取消标志、AbortSignal 与真实回退结果。另以预置 cancelled job 调用生产 KB 工具检查不触发索引拦截，不将它视作完整索引取消过程。
- Oracle：取消标志与 signal 生效；已完成保持 `indexed`，未完成回到 `needs_index` 或原 `failed` 并保留原错误，对齐 `SET-WORKSPACE-004-AC14` 及 `SET-WORKSPACE-004-AC16` 的条目回退部分；网页回到原 `needs_index / index_failed`，已完成保留，补充 `SET-WEB-004-AC12/AC13`；预置 cancelled job 不是 running，查询不触发索引拦截，补充 `SET-WORKSPACE-004-AC9`、`SET-WEB-004-AC8`。当前批后停止及顺序 helper 的取消契约由 `tests/case/unit/workspace/files/workspace-index-worker-contract.test.ts` 补充 `SET-WORKSPACE-004-AC15/AC16`；成功 / 失败终态不改为取消的纯函数契约由 `tests/case/unit/workspace/files/workspace-index-job-progress.test.ts` 补充 `SET-WORKSPACE-004-AC17`。这些 Unit 不能代替完整索引取消、任务收口和 UI 确认竞态。

#### `workspace-knowledge-cache-reuse`

- 测试类型：backend；suite `foundation`。
- What：真实解析和嵌入缓存跨隔离工作区复用；修改一份资料只重算必要内容，重命名更新锚点。
- Why：避免无关代码或临时路径变化引起重复资料向量化，同时守住索引内容与当前输入一致。
- How：生产解析器、嵌入 executor、缓存与真实 store；先冷跑小目录，再在新工作区复用；修改一份文件并更改文件名后重新索引。通过真实 index result 与日志核对命中和重算，不模拟 executor。
- Oracle：第二次解析和向量全部命中；仅内容/名称变化的条目发生必要 miss；返回当前 workspace/document 绑定与名称，无过期源路径；源文件保护。Unit 补充依赖指纹、并发/取消与死亡进程锁回收、损坏缓存及安装包身份；索引 UI 用例可用 `--fresh-knowledge-cache` 验证冷跑。

## 5. 覆盖边界

- foundation 登记功能场景，不评价召回优劣；Settings E2E 与本域 backend 分别提供 UI 闭环和底层线程证据。
- optimization 当前无登记 case，尚无召回率、检索与索引效果的自动化覆盖。
- Unit `embedding-service` 与真实 SQLite／LanceDB 的 `sqlite-storage` 覆盖：切换和启动零自动嵌入、模型身份判定、完整切回、部分重建失效、运行中配置保护、按当前预算手动重建及取消一致性。模拟 HTTP 不作为真实服务证据。
- `kb-availability-contract` 用生产模型配置及真实索引验证切换、初始化不重建和切回恢复；全策略及空范围遵循全局门禁，覆盖 `SET-VECTOR-006-AC1/AC2`、`SET-VECTOR-007-AC1/AC2`。文件／网页手动重建、取消及部分完成的底层证据由 Unit `sqlite-storage` 补充，不能当作真实远程或 UI 证据。
- `workspace-knowledge-cache-reuse` 与 Unit `workspace-index-worker-contract` 补充模型身份变化即使正文 hash 不变也需生成新向量，解析缓存保持模型无关；当前模型输入预算不污染基础解析缓存。
- 真实远程手动重建尚未登记为长期 live case；独立调试 smoke 与短连接测试不能替代长期自动化覆盖。网络故障和跨应用重启 UI 仍有覆盖缺口，Settings 的按钮、导航和状态反馈见其测试计划。
