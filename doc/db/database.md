# NCurator-Desktop 数据库设计

## 存储边界

- SQLite 是业务真相，文件路径为 `userData/app.sqlite`。
- LanceDB 是可重建的向量索引，文件目录为 `userData/lancedb`。
- LanceDB 只保存 `vector_chunk`，不再保存会话、消息、run、文档元数据、网页源、工作区状态或配置。
- 本次重构不兼容旧 LanceDB 业务表，也不迁移旧数据。

## SQLite

SQLite 使用 `better-sqlite3`。启动时 `SqliteCore` 会：

- 打开 `app.sqlite`
- 设置 `PRAGMA foreign_keys = ON`
- 设置 `PRAGMA journal_mode = WAL`
- 设置 `PRAGMA busy_timeout = 5000`
- 执行未执行的 migration

### Native 依赖

`better-sqlite3` 是 native 模块，Node backend 测试和 Electron e2e 使用的 ABI 不同。

规则：

- 跑 backend / unit 测试前，如遇到 `NODE_MODULE_VERSION` 不匹配，执行 `pnpm rebuild better-sqlite3`，让模块匹配当前 Node。
- 跑 Electron e2e 或打包前，执行 `NCURATOR_REBUILD_NATIVE=1 node scripts/postinstall.mjs`，让模块匹配 Electron。
- 两个 rebuild 会覆盖同一个 `.node` 文件，所以不能假设一次 rebuild 同时满足 Node 和 Electron。
- CI 或本地完整回归应按“Node backend rebuild -> backend 测试 -> Electron rebuild -> e2e 测试”的顺序执行。

### Migration 规则

- migration 记录在 `schema_migrations(version, name, applied_at)`。
- migration 按版本递增执行，每个 migration 都在 SQLite transaction 中执行。
- migration 失败会阻止启动，并抛出明确错误。
- 上线后只允许向前迁移，不做自动降级。
- 新字段用 `ALTER TABLE ADD COLUMN`。
- 改名或删除字段时，建新表、复制数据、删旧表、rename。
- 大数据变更需要 migration progress 表或分批 migration，不能在启动时长时间阻塞。

### 业务表

初始 schema 在 `src/main/services/storage/sqlite/migrations/001_initial_schema.ts`。

核心表：

- `chat_session`
- `chat_message`
- `chat_conversation_memory`
- `chat_session_resume_snapshot`
- `ai_run`
- `ai_run_event`
- `ai_file_change`
- `docx_apply`
- `workspace_source`
- `workspace_file_index`
- `workspace_index_job`
- `document`
- `web_source`
- `llm_config`
- `ai_runtime_settings`

关键设计：

- `chat_message` 使用会话内 `seq` 做稳定顺序，切换会话默认只取最近 50 条。
- `ai_run_event` 使用 `run_id + seq` 保证同一个 run 内事件顺序唯一。
- `ai_run.pending_approval_json` 是待审批卡片的真相来源。
- 审批同意时，SQLite transaction 会同时插入 decision event、清空 pending approval、把 run 改回 `running`。
- `document.active_generation_id` 是当前有效索引版本。

## LanceDB

LanceDB 只创建和使用 `vector_chunk`。

字段：

- `id`
- `document_id`
- `workspace_id`
- `source_type`
- `generation_id`
- `chunk_index`
- `text`
- `document_name`
- `metadata`
- `created_at`
- `vector`

允许操作：

- batch add chunks
- search chunks
- 按 `document_id / workspace_id / generation_id` 删除 chunks
- optimize vector table

不允许操作：

- 高频业务 update
- 业务状态 mergeInsert
- 用 LanceDB 保存会话、消息、run、网页源、工作区状态或配置

## Generation 机制

文件和网页索引都用 `generation_id` 保证一致性：

1. SQLite 标记 `document.import_status = indexing`。
2. 生成新的 `generation_id`。
3. LanceDB 批量写入新 generation 的 chunks。
4. 写入成功后，SQLite transaction 切换 `document.active_generation_id`，并标记 indexed。
5. 后台删除旧 generation chunks。
6. 如果失败，不切换 `active_generation_id`，旧索引继续可用。

搜索时先从 SQLite 找当前有效 `active_generation_id`，再让 LanceDB 过滤 `workspace_id + source_type + generation_id`。

## 性能约束

- `chatSessionOpen` 首屏只查 session、最近 50 条消息、当前 active runs。
- 完整 run/event replay、context usage、file change detail 不进入切换首屏关键路径。
- chunk 写入默认 `128 chunks / batch`，同时限制单批文本总量约 4MB。
- 优先靠数据库结构和查询路径优化，不把缓存作为主要解法。
