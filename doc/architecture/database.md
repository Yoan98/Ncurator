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
  - `WorkspaceStore`：`workspace_source` / `workspace_node`（工作空间、目录树快照、准备状态与节点绑定）
  - `ChatStore`：`chat_session` / `chat_message`（会话与消息 CRUD）
  - `DraftReviewStore`：`draft_review` / `draft_review_document` / `draft_review_change` / `draft_commit_job`（草稿审阅、变更确认与提交结果）
  - `LlmConfigStore`：`llm_config`（配置 CRUD 与激活态切换）
- **组合根（Facade）**: `src/main/services/storage/StorageService.ts`
  - 统一持有 `core` 与各 domain store
  - 应用启动时在 `src/main/index.ts` 调用 `await storageService.initialize()`
  - 初始化阶段会执行一次旧本地导入清理迁移：保留网页资料，清理未绑定 `workspace_node.document_id` 的历史本地 file documents

### 约束与最佳实践

- **不要在业务逻辑里直接 `lancedb.connect/openTable/createIndex`**；新增/修改数据库行为优先在 `LanceDbCore` 或对应 `*Store` 内完成。
- **where 条件中拼接外部输入时必须转义**：使用 `LanceDbCore.escapeSqlString()`；`IN` 条件优先用 `buildInClause()`。
- **keyword 搜索条件优先复用**：`LanceDbCore.buildWhereFromKeyword(keyword, fields)`。
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
| file_path     | Utf8（Nullable） | 原始文件路径                                 |
| created_at    | Int64            | 创建时间戳                                   |
| import_status | Int32            | 导入状态（1 导入中，2 导入成功，3 导入失败） |

导入状态取值:

- 1: 导入中
- 2: 导入成功
- 3: 导入失败

说明：
- `source_type='file'` 的 document 仅表示“已准备的本地文件索引文档”，其真相来源必须可由 `workspace_node.document_id` 反向找到。
- `source_type='web'` 的 document 由 `web_source.document_id` 绑定到网页资料来源。

### 表: web_source（网页资料来源表）

存储网页资料的来源 identity、抓取状态和范围选择元数据。

| 字段名                 | 类型             | 描述                                      |
| :--------------------- | :--------------- | :---------------------------------------- |
| id                     | Utf8             | 网页来源唯一标识                          |
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

### 表: workspace_source（工作空间来源表）

存储用户配置的本地工作空间及其最近扫描/准备状态。

| 字段名          | 类型             | 描述                                   |
| :-------------- | :--------------- | :------------------------------------- |
| id              | Utf8             | 工作空间唯一标识                       |
| name            | Utf8             | 显示名称                               |
| root_path       | Utf8             | 规范化后的工作空间根路径               |
| status          | Utf8             | 工作空间状态                           |
| last_scan_at    | Int64（Nullable）| 最近扫描时间                           |
| last_prepare_at | Int64（Nullable）| 最近准备时间                           |
| last_error      | Utf8（Nullable） | 最近一次扫描/准备错误                  |
| created_at      | Int64            | 创建时间戳                             |
| updated_at      | Int64            | 更新时间戳                             |

### 表: workspace_node（工作空间节点快照表）

存储目录树快照中的目录/文件节点，以及文件节点与已准备 document 的绑定关系。

| 字段名           | 类型             | 描述                                           |
| :--------------- | :--------------- | :--------------------------------------------- |
| id               | Utf8             | 节点唯一标识                                   |
| workspace_id     | Utf8             | 所属工作空间                                   |
| parent_id        | Utf8（Nullable） | 父目录节点 ID                                  |
| kind             | Utf8             | `directory` 或 `file`                          |
| name             | Utf8             | 节点名称                                       |
| relative_path    | Utf8             | 相对工作空间根路径                             |
| absolute_path    | Utf8             | 当前扫描到的绝对路径                           |
| file_ext         | Utf8（Nullable） | 文件扩展名（仅文件节点）                       |
| exists           | Bool             | 当前扫描快照中是否存在                         |
| size             | Int64（Nullable）| 文件大小                                       |
| mtime_ms         | Int64（Nullable）| 文件修改时间                                   |
| content_hash     | Utf8（Nullable） | 内容哈希，用于差异检测与准备状态同步           |
| prepare_status   | Utf8             | `not_prepared/preparing/prepared/stale/failed/missing` |
| document_id      | Utf8（Nullable） | 关联的已准备 document ID                       |
| last_prepared_at | Int64（Nullable）| 最近一次准备完成时间                           |
| last_error       | Utf8（Nullable） | 最近一次节点级错误                             |
| created_at       | Int64            | 创建时间戳                                     |
| updated_at       | Int64            | 更新时间戳                                     |

### 表: chat_session（对话会话表）

存储用户的对话会话列表。

| 字段名     | 类型  | 描述         |
| :--------- | :---- | :----------- |
| id         | Utf8  | 会话唯一标识 |
| title      | Utf8  | 会话标题     |
| created_at | Int64 | 创建时间戳   |

### 表: chat_session_memory（会话记忆表）

存储会话级摘要记忆，用于运行时补充上下文。

| 字段名      | 类型  | 描述 |
| :---------- | :---- | :--- |
| session_id  | Utf8  | 关联的会话 ID |
| memory_json | Utf8  | 记忆 JSON 字符串 |
| updated_at  | Int64 | 更新时间戳 |

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

### 表: draft_review（草稿审阅汇总表）

存储一次 AI 运行产生的待审阅结果集合。

| 字段名                | 类型             | 描述 |
| :-------------------- | :--------------- | :--- |
| id                    | Utf8             | 审阅 ID |
| session_id            | Utf8             | 所属会话 |
| run_id                | Utf8             | 所属运行 |
| status                | Utf8             | 审阅状态 |
| title                 | Utf8             | 审阅标题 |
| document_count        | Int32            | 文档数 |
| change_count          | Int32            | 变更总数 |
| pending_change_count  | Int32            | 待决策变更数 |
| accepted_change_count | Int32            | 已接受变更数 |
| rejected_change_count | Int32            | 已拒绝变更数 |
| created_at            | Int64            | 创建时间 |
| updated_at            | Int64            | 更新时间 |
| completed_at          | Int64（Nullable）| 审阅完成时间 |
| committed_at          | Int64（Nullable）| 最终提交时间 |
| last_error            | Utf8（Nullable） | 最近错误 |

### 表: draft_review_document（草稿审阅文档表）

存储审阅中的单个草稿文档及其源文件版本信息。

| 字段名                  | 类型             | 描述 |
| :---------------------- | :--------------- | :--- |
| id                      | Utf8             | 草稿文档 ID |
| review_id               | Utf8             | 所属审阅 ID |
| source_document_id      | Utf8（Nullable） | 源 document ID |
| source_path             | Utf8             | 源文件路径 |
| source_name             | Utf8             | 源文件名 |
| format                  | Utf8             | 文档格式 |
| latest_draft_snapshot_id| Utf8             | 最新草稿快照 |
| preview_artifact_path   | Utf8（Nullable） | 预览产物路径 |
| draft_artifact_path     | Utf8（Nullable） | 草稿产物路径 |
| source_version_json     | Utf8             | 源版本信息 JSON |
| total_change_count      | Int32            | 变更总数 |
| pending_change_count    | Int32            | 待决策变更数 |
| accepted_change_count   | Int32            | 已接受变更数 |
| rejected_change_count   | Int32            | 已拒绝变更数 |
| created_at              | Int64            | 创建时间 |
| updated_at              | Int64            | 更新时间 |

### 表: draft_review_change（草稿审阅变更表）

存储最小审阅单元及其接受/拒绝状态。

| 字段名              | 类型             | 描述 |
| :------------------ | :--------------- | :--- |
| id                  | Utf8             | 变更 ID |
| review_id           | Utf8             | 所属审阅 ID |
| document_id         | Utf8             | 所属草稿文档 ID |
| order_index         | Int32            | 排序索引 |
| change_kind         | Utf8             | 变更类型 |
| title               | Utf8             | 变更标题 |
| summary             | Utf8             | 变更摘要 |
| decision            | Utf8             | `pending / accepted / rejected` |
| before_text         | Utf8             | 变更前文本 |
| after_text          | Utf8             | 变更后文本 |
| locator_json        | Utf8             | 定位信息 JSON |
| preview_artifact_path| Utf8（Nullable）| 局部预览产物 |
| metadata_json       | Utf8（Nullable） | 附加元数据 |
| created_at          | Int64            | 创建时间 |
| updated_at          | Int64            | 更新时间 |

### 表: draft_commit_job（草稿提交任务表）

存储审阅通过后的最终提交执行结果。

| 字段名        | 类型             | 描述 |
| :------------ | :--------------- | :--- |
| id            | Utf8             | 提交任务 ID |
| review_id     | Utf8             | 所属审阅 ID |
| status        | Utf8             | 提交状态 |
| document_count| Int32            | 文档数量 |
| results_json  | Utf8             | 提交结果 JSON |
| started_at    | Int64            | 开始时间 |
| completed_at  | Int64（Nullable）| 完成时间 |
| error         | Utf8（Nullable） | 错误信息 |

### 表: llm_config（大模型配置表）

存储用户配置的 LLM API 信息。

| 字段名     | 类型    | 描述                                       |
| :--------- | :------ | :----------------------------------------- |
| id         | Utf8    | 配置唯一标识                               |
| name       | Utf8    | 配置名称                                   |
| base_url   | Utf8    | API Base URL                               |
| model_name | Utf8    | 模型名称                                   |
| api_key    | Utf8    | API Key                                    |
| is_active  | Boolean | 是否为当前激活配置（通常只有一个为 True）  |

## 文档与代码冲突时的处理

- 文档未覆盖当前实现时，以 `LanceDbCore` 的 `LANCE_TABLES` / `getTableConfigs()` 和各 `*Store` 为最终真相源。
- 修复数据库相关实现时，若发现文档缺项，应在同一变更中同步更新本文件。
