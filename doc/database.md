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
  - `ChatStore`：`chat_session` / `chat_message`（会话与消息 CRUD）
  - `LlmConfigStore`：`llm_config`（配置 CRUD 与激活态切换）
- **组合根（Facade）**: `src/main/services/storage/StorageService.ts`
  - 统一持有 `core` 与各 domain store
  - 应用启动时在 `src/main/index.ts` 调用 `await storageService.initialize()`

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

### 表: chat_session（对话会话表）

存储用户的对话会话列表。

| 字段名     | 类型  | 描述         |
| :--------- | :---- | :----------- |
| id         | Utf8  | 会话唯一标识 |
| title      | Utf8  | 会话标题     |
| created_at | Int64 | 创建时间戳   |

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
