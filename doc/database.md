# NCurator-Desktop 数据库架构

本文说明项目的本地存储边界、SQLite 与 LanceDB 的职责关系，以及索引一致性规则。具体表字段和查询细节以 migration、Store 和测试为准。

## 总体原则

- SQLite 是业务真相，文件位于 `userData/app.sqlite`。
- LanceDB 是可重建索引，目录位于 `userData/lancedb`，只保存 `vector_chunk`。
- SQLite schema 通过 migration 向前演进；LanceDB 索引按 SQLite 中的 document generation 重建。
- 同一业务状态不能同时以 SQLite 和 LanceDB 为真相。

## SQLite

SQLite 使用 `better-sqlite3`。启动时 `SqliteCore` 负责：

- 打开 `app.sqlite`。
- 设置 `PRAGMA foreign_keys = ON`。
- 设置 `PRAGMA journal_mode = WAL`。
- 设置 `PRAGMA busy_timeout = 5000`。
- 执行未执行的 migration。

SQLite 保存以下业务数据：

- 会话、消息、conversation memory 和恢复快照。
- AI run、事件、审批和文件修改记录。
- 工作区、文件索引任务、文档元数据和网页源。
- LLM 配置、AI runtime 设置和模型输出策略偏好。
- 文件内容和预览 artifact 的 SHA-256 对象引用；实际对象保存在工作区 `.ncurator/objects/sha256`，相同内容只存一份。

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

`better-sqlite3` 是 native 模块，Node backend 测试和 Electron e2e 使用不同 ABI。项目通过独立缓存保存两套 binding，不覆盖 `node_modules` 中的同一个 `.node` 文件。

- `pnpm native:prepare`：准备当前平台的 Node 与 Electron binding。
- `pnpm native:node`：只准备 Node binding。
- `pnpm native:electron`：只准备 Electron binding。
- `pnpm native:status`：查看缓存和资源状态。
- `scripts/test/workflow.mjs` 会按测试类型自动准备并注入正确 binding，正常回归不需要手动 rebuild。
- 打包流程会准备 Electron binding 并导出到 `resources/native/better-sqlite3/**`。

`001_initial_schema` 已发布并冻结。任何 schema 或数据变更都必须新增更高版本 migration，不能修改、重排或复用已发布 migration。开发环境重建数据库时也必须验证从已发布 schema 向前迁移的路径。

## LanceDB

LanceDB 只创建和使用 `vector_chunk` 表。

`vector_chunk` 保存 chunk、document、workspace、source type、generation、顺序、正文、文档名、metadata、创建时间和 embedding vector。

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

因此索引构建失败时，已有检索结果仍然可用。

## Fragment 和 Optimize

LanceDB fragment 是一次或多次写入形成的数据片段，不等于一行数据。

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
