# LanceDB 最优使用手册

本文档记录本项目使用 LanceDB 的约定。目标是避免把 LanceDB 当成普通 JSON 对象库低效使用。

## 基本原则

- Table 要长生命周期复用。不要在热路径里反复 `tableNames()` 和 `openTable()`。
- 查询必须按需 `.select()`。默认返回全列会读出大 JSON 字段，历史会话切换会变慢。
- 过滤列要建 scalar index。常见列包括 `id`、`session_id`、`run_id`、`status`、`created_at`、`timestamp`。
- 高频更新不要使用 `delete + add`。优先用 `mergeInsert(...).whenMatchedUpdateAll().whenNotMatchedInsertAll()`。
- 不要把 token 流当历史事件长期入库。`answer_token`、`llm_stream_delta` 只用于实时 UI。
- 长列表默认分页。聊天页默认取最近 50 条，向上滚动再取更早消息。
- 频繁写入、删除、更新后要运行 `optimize()`。LanceDB 文档建议在大量修改或多次修改后优化。
- 不允许启动时自动删表重建。schema 不一致时直接报错，由开发者手动删除本地数据库后重建。

## 聊天数据约定

- `chat_message` 存消息主体，按 `session_id + timestamp` 查询。
- `ai_run` 存运行状态和过程摘要：
  - `process_events_json`
  - `event_count`
  - `visible_event_count`
  - `last_event_at`
- `ai_run_event` 只存可回放的关键事件，例如工具调用、审批、文件产物、完成、失败。
- 历史会话默认用 `ai_run.process_events_json` 恢复过程卡片，不读取完整事件表。
- 用户展开运行详情时，才读取 `ai_run_event`。

## 查询规则

聊天消息查询示例：

```ts
await table
  .query()
  .where(`session_id = '${safeSessionId}'`)
  .select([
    'id',
    'session_id',
    'role',
    'content',
    'timestamp',
    'content_nodes_json',
    'selected_references_json',
    'artifacts_json',
    'error'
  ])
  .toArray()
```

运行摘要查询示例：

```ts
await table
  .query()
  .where(`session_id = '${safeSessionId}'`)
  .select([
    'id',
    'session_id',
    'assistant_message_id',
    'status',
    'partial_answer',
    'final_answer',
    'pending_approval_json',
    'artifacts_json',
    'process_events_json',
    'event_count',
    'visible_event_count',
    'last_event_at',
    'created_at',
    'updated_at'
  ])
  .toArray()
```

## 字段变更规则

当前产品仍在试验阶段，暂时不启用自动 migration：

- 表结构变更后，本地开发环境手动删除 LanceDB 数据库再启动。
- 代码只负责发现 schema 不一致并报错，不自动 `dropTable()`。
- 不保留 `recreateIfSchemaChanged` 这类自动删表开关，避免未来上线后误删用户数据。
- 索引变更可以自动补建，因为这不删除数据。

上线后再启用版本化 migration，放开前必须满足这些规则：

- 增加 `db_schema_version` 或等价版本表，启动时按版本顺序执行 migration。
- 新增字段使用 `addColumns`，并提供默认值或兼容读取逻辑。
- 删除字段分阶段完成：先停止读写旧字段，再 `dropColumns`，最后 `optimize()` 清理历史文件。
- 字段改名不能原地改：新增新字段、迁移旧数据、代码切到新字段、最后删除旧字段。
- 字段类型变化不能原地硬改：新增目标类型字段，转换数据后切读写。
- 索引变化只允许补建或删除索引，不允许借索引变更删表。
- 破坏性迁移必须先备份，或者保留旧表一段版本窗口。

## 排查慢查询

- 对超过 300ms 的查询记录耗时、返回行数、表名、where 条件。
- 必要时调用 `analyzePlan()`，确认是否扫描了过多列或过多行。
- 如果查询返回少量数据但耗时高，优先检查：
  - 是否缺少 scalar index。
  - 是否没有 `.select()`。
  - 是否在切换会话时读取了完整 run events。
  - 是否存在大量 token 级历史事件。
  - 是否需要 `optimize()`。

