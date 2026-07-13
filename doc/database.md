# NCurator-Desktop 数据库架构

本文说明项目的本地存储边界、SQLite 与 LanceDB 的职责关系，以及索引一致性规则。具体表字段和查询细节以 migration、Store 和测试为准。

## 总体原则

- SQLite 是业务真相，文件路径为 `userData/app.sqlite`。
- LanceDB 是可重建索引，目录为 `userData/lancedb`。
- LanceDB 只保存 `vector_chunk`，不保存业务状态。
- 业务状态不能在 SQLite 和 LanceDB 中形成两个真相。
- SQLite schema 通过 migration 向前演进。
- LanceDB 索引可按 SQLite 中的 document generation 重建。

## SQLite

SQLite 使用 `better-sqlite3`。启动时 `SqliteCore` 负责：

- 打开 `app.sqlite`。
- 设置 `PRAGMA foreign_keys = ON`。
- 设置 `PRAGMA journal_mode = WAL`。
- 设置 `PRAGMA busy_timeout = 5000`。
- 执行未执行的 migration。

SQLite 保存主要业务数据：

- 会话和消息。
- conversation memory 和恢复快照。
- AI run、run event 和审批状态。
- AI 文件修改记录。
- Docx apply 记录。
- 工作区源、文件索引任务和文档元数据。
- 网页源。
- LLM 配置和 AI runtime 设置。
- 按模型记录的结构化输出策略偏好。

关键规则：

- `chat_message` 使用会话内 `seq` 保证稳定顺序。
- `ai_run_event` 使用 `run_id + seq` 保证同一 run 内事件顺序。
- 待审批状态以 SQLite 中的 run 记录为准。
- `document.active_generation_id` 是当前有效索引版本。

## SQLite Migration

- migration 记录在 `schema_migrations`。
- migration 按版本递增执行。
- 每个 migration 都在 SQLite transaction 中执行。
- migration 失败会阻止启动，并抛出明确错误。
- 上线后只允许向前迁移，不做自动降级。
- 新字段优先用 `ALTER TABLE ADD COLUMN`。
- 改名或删除字段时，使用建新表、复制数据、删旧表、rename 的方式。
- 大数据变更需要分批处理，不能在启动时长时间阻塞。

## Native 依赖

`better-sqlite3` 是 native 模块，Node backend 测试和 Electron e2e 使用的 ABI 不同。项目通过独立缓存保存两套 native binding，不再反复覆盖 `node_modules` 中的同一个 `.node` 文件。

- `pnpm native:prepare`：准备当前平台的 Node 与 Electron binding。
- `pnpm native:node`：只准备 Node binding。
- `pnpm native:electron`：只准备 Electron binding。
- `pnpm native:status`：查看缓存和资源状态。
- `scripts/test-workflow.mjs` 会按 backend / e2e 类型自动准备并注入正确 binding，正常执行回归时不需要手动 rebuild。
- 打包流程会准备 Electron binding 并导出到 `resources/native/better-sqlite3/**`。

当前项目尚未发布，开发和测试环境允许删除本地数据库并重新创建，因此发布前可以直接整理 `001_initial_schema`。首次正式发布后必须冻结已经发布的 migration；届时新增表或字段必须增加更高版本 migration，不能只修改已执行的旧 migration。

## LanceDB

LanceDB 只创建和使用 `vector_chunk` 表。

`vector_chunk` 保存内容：

- chunk id。
- document id。
- workspace id。
- source type。
- generation id。
- chunk index。
- chunk text。
- document name。
- metadata。
- created time。
- embedding vector。

允许操作：

- 批量写入 chunks。
- 向量搜索和全文搜索 chunks。
- 按 `document_id / workspace_id / generation_id` 删除 chunks。
- 对向量表执行 optimize。

禁止操作：

- 高频业务 update。
- 业务状态 mergeInsert。
- 用 LanceDB 保存会话、消息、run、审批、网页源、工作区状态或配置。

## SQLite 与 LanceDB 的关系

SQLite 决定什么数据有效，LanceDB 只负责在有效范围内检索内容。

搜索流程：

1. 从 SQLite 读取当前 workspace 和 document 元数据。
2. 确认当前有效的 `active_generation_id`。
3. 到 LanceDB 搜索 `workspace_id + source_type + generation_id`。
4. 返回命中的 chunk 和来源信息。

搜索结果不能返回非 active generation 的 chunks。

## Generation 机制

文件和网页索引都用 `generation_id` 保证一致性。

1. SQLite 标记 `document.import_status = indexing`。
2. 生成新的 `generation_id`。
3. LanceDB 批量写入新 generation 的 chunks。
4. 写入成功后，SQLite transaction 切换 `document.active_generation_id`，并标记 indexed。
5. 后台删除旧 generation chunks。
6. 如果失败，不切换 `active_generation_id`，旧索引继续可用。

这个机制保证索引构建失败时不会破坏已有可用检索结果。

## Fragment 和 Optimize

LanceDB 的 fragment 可以理解为一次或多次写入形成的数据片段，不等于一行数据。

维护规则：

- chunk 必须批量写入。
- 避免大量小 batch 写入。
- 大量写入或删除后可以执行 optimize。
- optimize 只用于整理向量索引文件，不承担业务 migration。
- 不允许启动时自动删表重建。

## 性能约束

- 会话首屏只读取必要数据，不回放完整 run/event。
- 完整 run/event replay、context usage、file change detail 不进入切换首屏关键路径。
- chunk 写入必须批量进行。
- 慢查询优先检查 generation 过滤、workspace 过滤、source type 过滤和 fragment 数量。
- 不用缓存掩盖错误的数据边界。
