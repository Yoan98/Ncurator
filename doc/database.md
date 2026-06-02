# NCurator-Desktop 数据库设计

## 存储与检索

- 存储引擎: LanceDB v0.23
- 全文检索: FTS 基于 `text` 列，Tokenizer 使用 ngram (min:2, max:3)
- 数据库存储路径: Electron `app.getPath('userData')/lancedb`（见 `src/main/utils/paths.ts` 的 `LANCE_DB_PATH`）

## 代码封装与表操作入口

本项目的数据库访问已做分层封装，避免业务代码直接依赖 LanceDB 连接/表细节。

### 分层结构（Main Process）

- **连接与表初始化（Core）**: `src/main/services/storage/core/LanceDbCore.ts`
  - 负责连接创建、建表、索引创建、表打开、SQL 字符串转义、常用 where 拼装
  - 表名常量：`LANCE_TABLES`
  - 表结构与索引“代码层真相来源”：`getTableConfigs()`
- **领域表操作（Domains）**: `src/main/services/storage/domains/*Store.ts`
  - `DocumentsStore`：`document` / `chunk`（导入、分页、混合检索、删除）
  - `WebSourceStore`：`web_source`（网页资料来源 identity、抓取状态与来源级元数据）
  - `WorkspaceStore`：`workspace_source` / `workspace_file_index`（工作空间、文件索引状态、摘要统计）
  - `ChatStore`：`chat_session` / `chat_message`（会话与消息 CRUD）
  - `DocxApplyStore`：`docx_apply`（docx 直接写回记录、checkpoint 与回退状态）
  - `LlmConfigStore`：`llm_config`（配置 CRUD 与激活态切换）
- **组合根（Facade）**: `src/main/services/storage/StorageService.ts`
  - 统一持有 `core` 与各 domain store
  - 应用启动时在 `src/main/index.ts` 调用 `await storageService.initialize()`
  - 初始化阶段会执行一次旧本地导入清理迁移：清理未绑定当前工作空间文件索引记录的历史本地 file documents

### 约束与最佳实践

- **不要在业务逻辑里直接 `lancedb.connect/openTable/createIndex`**；新增/修改数据库行为优先在 `LanceDbCore` 或对应 `*Store` 内完成。
- **where 条件中拼接外部输入时必须转义**：使用 `LanceDbCore.escapeSqlString()`；`IN` 条件优先用 `buildInClause()`。
- **query 搜索条件优先复用**：`LanceDbCore.buildWhereFromQuery(query, fields)`。
  - 该方法会在检测到“像 SQL 的输入”时直接返回原字符串，用于内部高级筛选；不要把不可信输入当作 SQL 传入。
- **新增表/索引的入口**：
  1. 在 `LanceDbCore.ts` 的 `LANCE_TABLES` 与 `getTableConfigs()` 增加配置
  2. 在 `domains/` 新增或扩展 store，对外提供领域方法

## 表定义

### 表: chunk（文档切片表）

存储文档被切分后的片段及其向量表示。

| 字段名        | 类型                         | 描述                          |
| :------------ | :--------------------------- | :---------------------------- |
| vector        | FixedSizeList (768, Float32) | 文本向量 (Embedding)          |
| text          | Utf8                         | 切片文本内容（建立 FTS 索引） |
| id            | Utf8                         | 切片唯一标识                  |
| document_id   | Utf8                         | 关联的文档 ID                 |
| workspace_id  | Utf8                         | 关联的工作区 ID               |
| document_name | Utf8                         | 文档名称快照                  |
| source_type   | Utf8                         | 来源类型（如 'file', 'web'）  |
| metadata      | Struct                       | 元数据（如页码等）            |
| created_at    | Int64                        | 创建时间戳                    |

索引配置:

- FTS: 列 `text`，Tokenizer: ngram，min:2，max:3

### 表: document（文档元数据表）

存储原始文档的信息。

| 字段名        | 类型             | 描述                                         |
| :------------ | :--------------- | :------------------------------------------- |
| id            | Utf8             | 文档唯一标识                                 |
| name          | Utf8             | 文件名                                       |
| source_type   | Utf8             | 来源类型（如 'file', 'web'）                 |
| workspace_id  | Utf8（Nullable） | 所属工作区 ID                                |
| file_path     | Utf8（Nullable） | 原始文件路径                                 |
| created_at    | Int64            | 创建时间戳                                   |
| import_status | Int32            | 导入状态（1 导入中，2 导入成功，3 导入失败） |

导入状态取值:

- 1: 导入中
- 2: 导入成功
- 3: 导入失败

说明：
- `source_type='file'` 的 document 仅表示“已准备的本地文件索引文档”，其真相来源必须可由 `workspace_file_index.document_id` 反向找到。
- `source_type='web'` 的 document 由 `web_source.document_id` 绑定到网页资料来源。
- 当前实现要求本地文档与网页文档都归属于某个工作区，KB 默认检索直接按 `workspace_id` 收口。

### 表: web_source（网页资料来源表）

存储网页资料的来源 identity、抓取状态和范围选择元数据。

| 字段名                 | 类型             | 描述                                      |
| :--------------------- | :--------------- | :---------------------------------------- |
| id                     | Utf8             | 网页来源唯一标识                          |
| workspace_id           | Utf8             | 所属工作区 ID                              |
| identity_kind          | Utf8             | 当前固定为 `normalized_url`               |
| normalized_url         | Utf8             | URL 规范化后的 identity                   |
| url                    | Utf8             | 原始/最新 URL                             |
| title                  | Utf8（Nullable） | 最近一次抓取到的标题                      |
| document_id            | Utf8（Nullable） | 关联的已准备 document                     |
| import_status          | Int32            | 抓取状态（1 导入中，2 成功，3 失败）      |
| include_selectors_json | Utf8（Nullable） | 抓取 include selectors 的 JSON 字符串     |
| exclude_selectors_json | Utf8（Nullable） | 抓取 exclude selectors 的 JSON 字符串     |
| fetched_at             | Int64（Nullable）| 最近抓取完成时间                          |
| last_error             | Utf8（Nullable） | 最近一次抓取错误                          |
| created_at             | Int64            | 创建时间戳                                |
| updated_at             | Int64            | 更新时间戳                                |

说明：
- `web_source` 不再是全局资源，而是工作区内资源。
- 同一 `normalized_url` 允许在不同工作区分别存在，各自维护抓取状态与 `document_id` 绑定。

### 表: workspace_source（工作空间来源表）

存储用户配置的本地工作空间及其最近检查/索引状态与资料摘要。

| 字段名          | 类型             | 描述                                   |
| :-------------- | :--------------- | :------------------------------------- |
| id              | Utf8             | 工作空间唯一标识                       |
| name            | Utf8             | 显示名称                               |
| root_path       | Utf8             | 规范化后的工作空间根路径               |
| status          | Utf8             | 工作空间状态                           |
| last_scan_at    | Int64（Nullable）| 最近检查目录变化时间                   |
| last_prepare_at | Int64（Nullable）| 最近索引更新时间                       |
| last_error      | Utf8（Nullable） | 最近一次检查/索引错误                  |
| indexable_file_count   | Int64（Nullable）| 当前可索引文件数                    |
| indexed_file_count     | Int64（Nullable）| 当前已索引文件数                    |
| needs_update_file_count| Int64（Nullable）| 当前需更新索引文件数                |
| failed_file_count      | Int64（Nullable）| 当前索引失败文件数                  |
| not_indexed_file_count | Int64（Nullable）| 当前未索引文件数                    |
| web_source_count       | Int64（Nullable）| 当前网页资料数                      |
| created_at      | Int64            | 创建时间戳                             |
| updated_at      | Int64            | 更新时间戳                             |

### 表: workspace_file_index（工作空间文件索引状态表）

存储工作空间下支持索引文件的持久化索引状态；目录树本身运行时直接读取真实文件系统。

| 字段名           | 类型             | 描述                                           |
| :--------------- | :--------------- | :--------------------------------------------- |
| id               | Utf8             | 索引记录唯一标识                               |
| workspace_id     | Utf8             | 所属工作空间                                   |
| relative_path    | Utf8             | 相对工作空间根路径                             |
| absolute_path    | Utf8             | 最近一次检查到的绝对路径                       |
| name             | Utf8             | 文件名                                         |
| file_ext         | Utf8             | 文件扩展名                                     |
| size             | Int64（Nullable）| 文件大小                                       |
| mtime_ms         | Int64（Nullable）| 文件修改时间                                   |
| content_hash     | Utf8（Nullable） | 最近一次成功索引对应的内容哈希                 |
| index_status     | Utf8             | `not_indexed/indexing/indexed/needs_update/failed` |
| document_id      | Utf8（Nullable） | 关联的已准备 document ID                       |
| indexed_at       | Int64（Nullable）| 最近一次索引完成时间                           |
| last_checked_at  | Int64（Nullable）| 最近一次检查目录变化时间                       |
| last_error       | Utf8（Nullable） | 最近一次文件级索引错误                         |
| created_at       | Int64            | 创建时间戳                                     |
| updated_at       | Int64            | 更新时间戳                                     |

### 表: chat_session（对话会话表）

存储用户的对话会话列表。

| 字段名     | 类型  | 描述         |
| :--------- | :---- | :----------- |
| id         | Utf8  | 会话唯一标识 |
| title      | Utf8  | 会话标题     |
| created_at | Int64 | 创建时间戳   |

### 表: chat_conversation_memory（会话记忆表）

存储会话级摘要记忆，用于运行时补充上下文。

| 字段名      | 类型  | 描述 |
| :---------- | :---- | :--- |
| session_id  | Utf8  | 关联的会话 ID |
| memory_json | Utf8  | 记忆 JSON 字符串 |
| updated_at  | Int64 | 更新时间戳 |

### 表: chat_session_resume_snapshot（会话恢复快照表）

存储同一会话下最近一次可恢复中断的最小 human 语义快照，仅用于 `timeout / network_error` 后的自动恢复。

| 字段名                   | 类型             | 描述 |
| :----------------------- | :--------------- | :--- |
| session_id               | Utf8             | 关联的会话 ID；同一会话只保留最新一条 |
| run_id                   | Utf8             | 触发快照的 run ID |
| reason                   | Utf8             | 失败原因，固定为 `timeout` 或 `network_error` |
| user_input               | Utf8             | 上一次中断时的用户输入 |
| selected_references_json | Utf8             | 资料范围 JSON |
| workspace_json           | Utf8（Nullable） | 工作区绑定 JSON |
| human_state_json         | Utf8             | 仅包含恢复必需字段的最小 `HumanState` 片段 JSON |
| error_message            | Utf8             | 最近失败信息 |
| updated_at               | Int64            | 更新时间戳 |

### 表: chat_message（对话消息表）

存储会话中的每一条消息记录。

| 字段名     | 类型             | 描述                                     |
| :--------- | :--------------- | :--------------------------------------- |
| id         | Utf8             | 消息唯一标识                             |
| session_id | Utf8             | 关联的会话 ID                            |
| role       | Utf8             | 角色（'user', 'assistant', 'system'）    |
| content    | Utf8             | 消息内容                                 |
| timestamp  | Int64            | 消息时间戳                               |
| sources    | Utf8（Nullable） | 引用来源（SearchResult[] 的 JSON 字符串） |
| error      | Boolean（Nullable） | 是否出错                               |

### 表: docx_apply（docx 直接写回记录表）

存储一次 AI 运行中某个 docx 文件的直接写回记录。写回前会保存当前磁盘文件 checkpoint，用于用户回退本次 AI 修改。

| 字段名                | 类型             | 描述 |
| :-------------------- | :--------------- | :--- |
| id                    | Utf8             | AI 修改记录 ID |
| session_id            | Utf8             | 所属会话 |
| run_id                | Utf8             | 所属运行 |
| status                | Utf8             | `applied / reverted / failed` |
| source_path           | Utf8             | 已直接写回的源文件路径 |
| source_name           | Utf8             | 源文件名 |
| operation             | Utf8             | 实际写回语义，`updated` 表示覆盖现有文件，`created` 表示创建新文件 |
| final_revision_ref    | Utf8             | 本次写回对应的任务内最终 revision |
| change_count          | Int32            | 变更数量 |
| before_exists         | Boolean          | 写回前目标文件是否存在 |
| before_snapshot_path  | Utf8（Nullable） | 写回前 checkpoint 快照路径 |
| before_checksum       | Utf8（Nullable） | 写回前文件 checksum |
| before_byte_size      | Int64（Nullable）| 写回前文件大小 |
| before_modified_at    | Int64（Nullable）| 写回前修改时间 |
| preview_diff_artifact_path | Utf8       | 系统内 diff 预览稿路径 |
| preview_diff_checksum | Utf8             | 系统内 diff 预览稿 checksum |
| preview_diff_byte_size | Int64           | 系统内 diff 预览稿大小 |
| after_checksum        | Utf8（Nullable） | 写回后文件 checksum |
| after_byte_size       | Int64（Nullable）| 写回后文件大小 |
| after_modified_at     | Int64（Nullable）| 写回后修改时间 |
| created_at            | Int64            | 创建时间 |
| updated_at            | Int64            | 更新时间 |
| reverted_at           | Int64（Nullable）| 回退时间 |
| last_error            | Utf8（Nullable） | 最近错误 |

### 表: llm_config（大模型配置表）

存储用户配置的 LLM API 信息。

| 字段名     | 类型    | 描述                                       |
| :--------- | :------ | :----------------------------------------- |
| id         | Utf8    | 配置唯一标识                               |
| providerKind | Utf8 | 服务商适配类型                             |
| base_url   | Utf8    | API Base URL                               |
| api_key    | Utf8    | API Key                                    |
| is_active  | Boolean | 是否为当前激活配置（通常只有一个为 True）  |

## 文档与代码冲突时的处理

- 文档未覆盖当前实现时，以 `LanceDbCore` 的 `LANCE_TABLES` / `getTableConfigs()` 和各 `*Store` 为最终真相源。
- 修复数据库相关实现时，若发现文档缺项，应在同一变更中同步更新本文件。
