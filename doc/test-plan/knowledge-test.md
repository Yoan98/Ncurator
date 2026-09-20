# NCurator-Desktop 知识库测试计划

## 1. 总体目标

- 本计划定义知识库专项回归，对标 `ai-test`，全部是 backend。
- 通用测试、runner 与断言规则遵循 `doc/test.md`。
- 正式 case 放在 `tests/case/knowledge/<suite>/**`。

本计划覆盖两类：

1. `foundation`：知识库功能（扫描、建索引、job、索引中拦截检索、索引速度线程预算、多地址顺序更新）。
2. `optimization`：召回率、检索与索引效果。当前无 case，后续做优化时再设计。

边界：

- 不替代 Settings「更新索引」产品 E2E。E2E 在真实 Electron 里切换档位并跑更新索引，断言嵌入 `utilityProcess` 进程名中的 intraOp 随档位变化；本计划用同一套档位走生产 `indexLocalFile`，断言索引时 applied session 随慢/高速变化。
- 不替代 `ai-test` 中的 kb tool / live。
- 不登记 unit。函数级补足仍在 `tests/case/unit/knowledge/**`。

## 2. Suite 设计

### 2.1 `foundation`

- 目标：守住知识库可回归的功能主链。
- 约束：走生产 store / job / 扫描 / worker / 嵌入 executor；禁止假 executor 或假 `assertKbSearchAvailable`。索引速度 case 必须真实调用更新索引，断言当时档位落到 embedding session，不测 UI、不测真实 CPU / 耗时。
- 目录：`tests/case/knowledge/foundation/<case>.test.ts`

### 2.2 `optimization`

- 目标：召回率、检索与索引效果评测。
- 当前无登记 case。

## 3. 领域规则

- 全部是 backend，禁止导入 Renderer。
- 线程预算以逻辑核 `N` 为准（Mac / Windows 相同）：
  - 慢速：`max(1, floor(N/2))`，关闭 spinning
  - 高速：`max(2, N - reserve)`，`reserve = N≤8 ? 1 : 2`
- 多文件地址更新索引必须顺序 kickoff，且 `workspacePrepare` IPC 等到该地址 job 终态。
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
- What：`workspace_index_job` 支持创建、active 查询、阶段进度更新和失败收敛。
- Why：更新索引的进度恢复与中断收敛依赖 job store。
- How：真实 job store 写入 running/failed 记录并查询 active、进度与批量失败。
- Oracle：active 取最新 running；进度可持久化读取；running job 可批量失败，对齐 `SET-WORKSPACE-004-AC3`、`SET-WORKSPACE-004-AC4`、`SET-WORKSPACE-004-AC5`。

#### `workspace-index-worker-contract`

- 测试类型：`backend`
- What：文件索引 worker 协议与 embedding batch 限制保持稳定。
- Why：worker 输入输出或切批失真会让更新索引静默丢文件或打爆嵌入。
- How：真实 worker 协议与切批函数覆盖支持文件与超限文本。
- Oracle：协议可执行；batch 遵守条数与字符上限。

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
- How：隔离 sqlite 写入 running prepare job，再走生产 `createAiRunContext` 调用两个工具，并检查 model-facing 投递文案。
- Oracle：两工具抛出正在更新知识库错误；模型侧结果为 `Error: 正在更新知识库索引，请完成后再检索。`，对齐 `SET-WORKSPACE-004-AC9`、`SET-WEB-004-AC8`。

#### `index-speed-thread-budget`

- 测试类型：`backend`
- What：慢速/高速按逻辑核数映射不同的 ORT `session_options`；真实更新索引调用必须带上当时档位。
- Why：档位是否有效，看的是索引链路里 embedding session 是否换档，不是单独探测线程公式。
- How：对 4/8/16 核分别计算慢速与高速预算；保存慢速后对真实 txt 走生产 `indexLocalFile`，再保存高速并对另一份 txt 再索引一次。Electron `utilityProcess` 的闭环在 Settings `workspace-prepare-refresh`。
- Oracle：慢速 2/4/8 且关闭 spinning；高速 3/7/14 且开启 spinning；两次索引都写出 chunk 且未走向量缓存；慢速索引时 applied session 为慢速 intraOp 并关闭 spinning，高速索引时为高速 intraOp 并开启 spinning。

#### `prepare-workspaces-sequentially`

- 测试类型：`backend`
- What：多地址更新索引按顺序等待前一个完成再启动下一个。
- Why：并行 kickoff 会叠满嵌入线程，和慢/高速档位冲突。
- How：三个真实工作目录各写一个 txt，用生产 `prepareWorkspacesSequentially` 依次调用 `WorkspaceKnowledgePrepareService.indexLocalFile`（切分走生产 `prepareWorkspaceSource`，嵌入走生产 embedding），记录 start/end。
- Oracle：事件顺序为每个地址 start→end 后再开始下一个，对齐 `SET-WORKSPACE-004-AC11`。

### 4.2 `optimization`

无。
