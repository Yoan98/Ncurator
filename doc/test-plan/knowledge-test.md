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
- 普通文件／网页 running prepare job 的检索及列表门禁保持不变；模型后台迁移不进入该门禁。关键词检索和资料列表不依赖嵌入就绪，向量／混合策略才要求当前模型可用，失败不 fallback。后台迁移恢复、暂停及重试单独验证，不套用普通索引中断收敛为失败的规则。
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
- Oracle：两工具抛出正在更新知识库错误；模型侧结果包含正在更新知识库原因及当前状态下停止调用 KB 的指引，对齐 `SET-WORKSPACE-004-AC9`、`SET-WEB-004-AC8`。

#### `kb-availability-contract`

- 测试类型：`backend`
- What：按查询策略检查当前嵌入模型，关键词／列表不要求模型就绪；空库与空范围正常返回空结果，索引不隐式下载。
- Why：本地模型缺失或远程失败不能阻断已有正文的关键词检索和列表；向量查询则不能悄悄使用其他模型。
- How：独立模型目录中用真实 ModelService、EmbeddingService / executor、store 和 createAiRunContext，验证模型缺失、不完整、损坏、删除恢复及远程选择；既有正文与空库分别调用关键词、向量、混合及列表。保留真实文件／网页索引入口和普通 prepare job 门禁检查，远程真实服务验证与 Unit 模拟端点严格区分。
- Oracle：关键词／列表不触发模型初始化或下载；向量／混合及新索引依赖当前模型并明确返回错误，远程模式不要求本地安装且无 fallback；健康模型下空库／空范围的 items 为空且 total 为 0，有效正文可检索。普通更新仍阻断两个 KB 工具，后台模型迁移不阻断。
- 覆盖状态：case 已按策略分别验证模型门禁，关键词／列表在缺失、损坏或删除本地模型后仍可访问既有正文；真实本地模型、空库、空范围及恢复路径已通过定向 backend 回归。远程真实服务与迁移期间工具提示仍需独立证据。

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

## 5. 覆盖边界

- foundation 登记功能场景，不评价召回优劣；Settings E2E 与本域 backend 分别提供 UI 闭环和底层线程证据。
- optimization 当前无登记 case，尚无召回率、检索与索引效果的自动化覆盖。
- Unit `tests/case/unit/knowledge/vector/embedding-service.test.ts` 已覆盖远程响应、有限重试、身份与切换竞态、密钥投影；`tests/case/unit/storage/sqlite-storage.test.ts` 使用真实 SQLite／LanceDB 覆盖多维度隔离、正文保留、重嵌提交、错误清除、关闭取消和恢复。普通文件／网页索引在真实写块后取消的回归验证原文档状态、哈希及错误恢复，待迁移队列重新包含资料且可提交重嵌；另覆盖激活后不回滚、并发版本变化和删除不覆盖、恢复错误不伪装取消。远程请求为模拟 HTTP，不计为 live。涉及真实远程模型和迁移中工具结果的缺口见下表，UI 见 [Settings 测试计划](settings-test.md)。
- 输入上限的本地契约由 Unit 覆盖：`embedding-service` 验证默认 512、显式上限、自动预留、Unicode 保守估算与完整切分、超长查询发送前报错；`workspace-index-worker-contract` 覆盖文件／网页新索引全文、页码与向量对应以及基础缓存不受预算污染；`sqlite-storage` 使用真实存储和模拟 HTTP 覆盖已有长正文重切分、新 generation 完整写入后 CAS 激活、失败保留旧正文、迁移期间短关键词可用及 purge 与在途写入互斥。长正文完整性由读回拼接与真实行数验证，不能把短关键词命中当作长文本召回率证明。实际远程分词器与服务限制仍需 live 证据，短文本连接测试不代表真实长资料迁移已通过。

| What                            | Why                                      | How / 计划验证层                                                                                                               | Oracle                                                                                                      |
| ------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 模型身份、立即切换与无 fallback | 防止旧向量与新查询混用                   | Unit embedding-service 覆盖远程响应边界、端点／模型名变更、Key-only 刷新和在途切换；真实服务行为待补 backend／live             | 后续请求立即使用新配置，旧结果不能提交；Key-only 不重嵌，错误不换模型                                       |
| 动态表与设置持久化              | 维度隔离、密钥投影和进度依赖同一存储契约 | Unit sqlite-storage 覆盖当前 schema、单例 JSON、不同身份及维度表、有效 generation 过滤；配置投影由 embedding-service 补充      | document 身份／维度／错误字段正确，完整正文表隔离，读取响应无 Key；表族删除与清理不留可查询孤儿             |
| 从既有 chunk 重嵌               | 旧模型失效时仍须可迁移，且不能扩大范围   | 用真实 store 和生产嵌入服务准备文件／网页，再移除旧模型；记录迁移前后文档集合、内容哈希和 chunk 顺序                           | 不重新扫描或抓取、不新增资料；完整目标写入后才切换标记；失败时旧正文仍可读及 FTS 命中                       |
| 暂停、继续、重试与退出恢复      | 避免已完成丢失、重复及过期提交           | 存储层验证幂等与提交条件；服务／进程层补运行中切换、暂停、失败重试及同用户目录重启                                             | 已完成保持；未暂停剩余任务恢复、暂停保持、失败可重试；过期 generation／任务不提交                           |
| 迁移中的工具结果与范围          | 部分语义覆盖不能解释成全库无匹配         | backend／live 拟补迁移中 keyword、semantic、auto、list 和读取，分别限定文档／工作地址／来源类型，并与普通 running prepare 对照 | 当前模型独占向量结果，待迁移正文参与 FTS；覆盖提示对应查询范围；keyword/list 无嵌入门禁，普通更新门禁仍生效 |
