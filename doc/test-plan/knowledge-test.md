# NCurator-Desktop 知识库测试计划

## 1. 总体目标

- 本计划定义知识库专项回归：嵌入运行时、索引调度、向量存储与检索基建。
- 通用测试、runner 与断言规则遵循 `doc/test.md`。
- 本计划对标 `ai-test`：覆盖知识库基础设施，而不是 Settings「更新索引」产品效果，也不是 AI 工具如何被模型调用。

边界：

- `ai-test` 中的 kb tool / live（`kb_search`、`kb_list_documents` 契约与 human live）不搬迁、不改写。
- `settings-test` / Workbench 中真实「更新索引」E2E 仍验证产品终态。
- 本计划的 unit 放在 `tests/case/unit/knowledge/**`。

## 2. Suite 设计

1. `runtime`：索引速度档位到 ORT 线程预算的映射、嵌入 runtime 串行推理。
2. `indexing`：扫描/prepare job、中断恢复、多地址顺序更新索引。
3. `embedding`：模型下载契约、嵌入错误、EmbeddingService。
4. `retrieval`：更新索引期间拦截检索等检索基建（不是召回评测本身）。
5. `storage`：后续扩展 generation、写入批次、召回/RRF 评测基建。

后续音视频、图片索引与召回率评测也归入本计划对应 suite。

## 3. 领域规则

- Unit 只测 backend 函数与契约，不导入 Renderer。
- 线程预算公式以逻辑核 `N` 为准（Mac / Windows 相同）：
  - 慢速：`max(1, floor(N/2))`，关闭 spinning
  - 高速：`max(2, N - reserve)`，`reserve = N≤8 ? 1 : 2`
- 多文件地址「更新索引」必须顺序 kickoff，禁止并行启动。
- 不在本计划比较召回优劣；召回评测基建落地后再增 case。

## 4. 回归清单

### 4.1 `runtime`

#### `index-speed-thread-budget`

- 测试类型：`unit`
- 路径：`tests/case/unit/knowledge/runtime/index-speed-thread-budget.test.ts`
- What：慢速/高速按逻辑核数映射 `intraOpNumThreads` 与 spinning。
- Oracle：4/8/16 核分别为慢速 2/4/8、高速 3/7/14；慢速 `allowSpinning=false`。

#### `embedding-runtime-contract`

- 测试类型：`unit`
- 路径：`tests/case/unit/knowledge/vector/embedding-runtime-contract.test.ts`
- What：嵌入 runtime 严格串行推理。

### 4.2 `indexing`

#### `prepare-workspaces-sequentially`

- 测试类型：`unit`
- 路径：`tests/case/unit/knowledge/indexing/prepare-workspaces-sequentially.test.ts`
- What：多地址更新索引按顺序等待前一个完成。
- Oracle：对齐 `SET-WORKSPACE-004-AC11`。

#### 既有迁入

- `tests/case/unit/knowledge/indexing/workspace-scan-contract.test.ts`
- `tests/case/unit/knowledge/indexing/workspace-index-job-store-contract.test.ts`
- `tests/case/unit/knowledge/indexing/workspace-index-worker-contract.test.ts`
- `tests/case/unit/knowledge/indexing/workspace-interrupted-job-recovery-contract.test.ts`
- `tests/case/unit/knowledge/workspace-knowledge-cache.test.ts`

### 4.3 `embedding`

- `tests/case/unit/knowledge/vector/embedding-service.test.ts`
- `tests/case/unit/knowledge/vector/embedding-error.test.ts`
- `tests/case/unit/knowledge/vector/model-download-source-contract.test.ts`
- `tests/case/unit/knowledge/vector/vector-download-service-contract.test.ts`

### 4.4 `retrieval`

- `tests/case/unit/knowledge/retrieval/kb-indexing-blocks-search.test.ts`：更新索引期间拦截 `kb_search` / `kb_list_documents`，对齐 `SET-WORKSPACE-004-AC9`、`SET-WEB-004-AC8`。
