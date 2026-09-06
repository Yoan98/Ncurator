# NCurator-Desktop 数据库架构

本文说明项目的本地存储边界、SQLite 与 LanceDB 的职责关系，以及索引一致性规则。具体表字段和查询细节以 migration、Store 和测试为准。

## 总体原则

- SQLite 是业务真相，文件位于 `userData/app.sqlite`。
- LanceDB 是可重建索引，目录位于 `userData/lancedb`，只保存 `vector_chunk`。
- SQLite schema 通过 migration 向前演进；LanceDB 按文档 generation 写入后删除旧 chunk，检索时库内只留最新数据。
- 同一业务状态不能同时以 SQLite 和 LanceDB 为真相。

## SQLite

SQLite 使用 `better-sqlite3`。启动时 `SqliteCore` 负责：

- 打开 `app.sqlite`。
- 设置 `PRAGMA foreign_keys = ON`。
- 设置 `PRAGMA busy_timeout = 5000`。
- 在任何迁移写入前读取并校验 `schema_migrations`。
- 数据库版本兼容时设置 `PRAGMA journal_mode = WAL`，并执行全部待执行 migration。

SQLite 保存以下业务数据：

- 伙伴（`partner`）以及用于中断恢复、压缩投影的 append-only 伙伴消息记录（`chat_session_message_log`，表名保留，行挂 `partner_id`）；不保存独立恢复快照。
- AI run、审批和文件修改记录（均挂 `partner_id`）。不存在 `chat_search_turn`，Composer 已删除搜索模式。
- 消息中的图片只保存运行时路径或 HTTP(S) 地址，以及 MIME、字节数和尺寸；SQLite 不保存 Base64，也不为临时图片建立独立文件表。运行时文件被清理后允许恢复为不可用占位。
- 工作地址（`workspace_source`，无 name，`root_path UNIQUE`）、文件索引任务、文档元数据和全局网页源（`web_source`，无 `workspace_id`，`UNIQUE(normalized_url)`）。
- LLM 配置和 AI runtime 设置。
- AI runtime 设置中的 `systemNotificationsEnabled`，默认值为 `1`，控制 AI 运行终态系统通知。
- 文件内容和预览 artifact 的 SHA-256 对象引用；实际对象保存在 `userData/partners/{id}/objects/sha256`，相同内容只存一份。
- Workbench 伙伴 UI 快照（`partner_ui_state`）、当前活动伙伴（`workbench_ui_state.active_view_key`）和内置浏览器标签状态（`browser_tab_state.owner_key` = partner_id）。
- 定时任务（`scheduled_task.partner_id`）。

关键规则：

- `partner` 保存名称、头像外形与颜色，以及 `pinned` / `pinned_at` 置顶状态；列表按置顶优先、置顶时间、更新时间排序。标题就是伙伴 `name`，不因消息改名。
- `chat_session_message_log` 使用 `partner_id + seq` 保证伙伴内消息转录的稳定顺序（`user`/`assistant`/`tool`/`annotation` 条目）；`plan_updated`、`compaction_checkpoint` 和 `context_cleared` 是强类型 annotation。`compaction_checkpoint` 只存书签字段（`coveredThroughSeq` 等），不存摘要。`user.content` 是发给模型的 build 全文（`origin: human | compaction`）；压缩记忆只在 compaction user 的 `<memory>`。投影先切最后一次 `context_cleared`，再按书签截断。气泡文案用 `ai_run.input`。
- `ai_run` 挂 `partner_id`，不再保存 `workspace_json`。`partial_answer` 与 `partial_answer_role` 只保存当前流式 UI 草稿；它们不参与下一次模型上下文恢复。`failure_code` 保存 `process_interrupted`、`output_truncated`、`input_too_long` 等终止原因。
- 待审批状态以 SQLite 中的 run 记录为准。
- `document.active_generation_id` 是当前有效索引版本，只用于写入后删除旧 chunk 和启动/任务结束时的孤儿清理，不进入检索 `where`。

### Workbench 伙伴 UI 状态

- `partner_ui_state` 以 `partner_id` 为主键保存版本化 `state_json`，伙伴删除时通过外键级联删除。
- `workbench_ui_state` 是 `id = 1` 的单例，只保存 `active_view_key`（当前伙伴 id）；不再保存 `draft_state_json` 或 `__draft__`。
- `browser_tab_state` 以 `owner_key` 隔离伙伴标签（`owner_key` = partner_id），保存 URL、标题、缩放、导航历史、顺序和更新时间。
- 伙伴在创建弹窗提交时即落库，不存在草稿会话提升事务。
- 删除伙伴级联删除 message log、`ai_run`、`ai_file_change`、`docx_apply`、`partner_ui_state` 和该伙伴定时任务，并清除 `browser_tab_state`、将 `active_view_key` 置空，同时删除 `userData/partners/{id}`。
- Renderer 内存只负责当前交互，SQLite 是重启恢复的真相；浏览器 `WebContentsView` 只负责运行期页面实例，不是持久化真相。

## SQLite Migration

### 当前边界

- 当前代码支持的最终 schema version 是 `10`，由 `CURRENT_SCHEMA_VERSION` 定义。
- version `1–9` 已随正式版发布，永久保留且不可改写。已知历史例外只有 version 2 的旧名称 `workspace_change_sets`；version 9 继续负责修复通知字段。
- version `10` 是破坏性升级，不迁旧数据。`upgrade_from_v9` 从 v9 升级时 DROP 旧表再建最终结构：新增 `partner`；删除 `chat_session`、`chat_session_ui_state`（以及 `chat_conversation_memory`、`chat_session_resume_snapshot`、`ai_run_event`、`chat_session_skill_state`、`chat_message`）；`chat_session_message_log` / `ai_run` / `ai_file_change` / `docx_apply` 改挂 `partner_id`；新增 `partner_ui_state`；`workbench_ui_state` 只留 `active_view_key`，删除 `draft_state_json`；`scheduled_task` 改挂 `partner_id`；`workspace_source` 去掉 name 且 `root_path UNIQUE`；`web_source` 去掉 `workspace_id` 且 `UNIQUE(normalized_url)`；`ai_run` 不再保存 `workspace_json`。不存在、也不新建 `chat_search_turn`。新增 `schema_migration_hooks`，供版本声明提交后副作用。v10 的 `afterCommit` 在 SQLite 事务提交后、LanceDB 连接前删除 `userData/lancedb`；hook 记 `pending/done`，失败可重试，`done` 后不重跑。空库仍执行 version `1–10`，跑完后结构与 v9 升级路径一致。
- 哪些 migration 已正式发布，以 `migrations/released-migrations.json` 为唯一边界。未进入清单的连续迁移可以在发布前合并或重写；进入清单后只能新增更高版本修复。

### 版本身份与执行规则

- migration 记录在 `schema_migrations`，身份由 `version + name` 共同确定，不能只看最大版本号。
- migration 定义统一放在 `src/main/services/storage/sqlite/migrations/00X_*.ts`。版本必须从 1 开始连续、严格递增且唯一；文件版本、定义版本和执行顺序必须一致。
- 已执行记录必须是当前 migration 列表的合法连续前缀。除明确登记的历史别名外，缺号、名称冲突或未知记录都视为数据库历史损坏，拒绝启动。
- 数据库版本高于 `CURRENT_SCHEMA_VERSION` 时，在写 migration、切换 WAL 或初始化业务服务前抛出 `DatabaseVersionTooNewError`，错误同时携带检测版本和支持版本。
- 一次启动中的全部待执行 migration、对应的 `schema_migrations` 记录、`PRAGMA quick_check` 和 `PRAGMA foreign_key_check` 位于同一个 SQLite transaction。任一步失败，整批升级回滚，数据库不会停留在半升级状态。声明了 `afterCommit` 的版本在同一事务中写入 `schema_migration_hooks(status=pending)`；事务提交后、LanceDB 连接前执行这些 hook，成功后标 `done`。`afterCommit` 不在 SQLite 事务里，不得回写 schema。
- migration 必须可重复初始化：已经完整执行的版本不会再次执行。`afterCommit` 只在 hook 仍为 `pending` 时重试。不提供 down migration、自动数据库复制、自动备份或自动恢复。

### 启动状态机与禁止降级

应用先初始化错误日志与 `AppUpdateService`，再检查 SQLite：

1. 数据库兼容且迁移成功：启动状态为 `{ mode: 'normal' }`，继续初始化 Storage、LanceDB、AI、Workbench、定时任务和业务 IPC。
2. 数据库版本高于当前应用支持版本：启动状态为 `{ mode: 'update_required', databaseVersion, supportedDatabaseVersion, downloadPageUrl }`，只创建更新恢复页，不初始化任何业务服务。`downloadPageUrl` 指向官网中文下载页，由官网提供平台选择和安装说明，不在恢复页维护安装包直链。
3. 其他迁移错误：按启动错误处理并保留错误日志，不能把 schema 损坏误判成可更新状态。

恢复页会自动检查更新，只允许检查、下载、重启安装、打开官网中文下载页或退出。更新不可用、网络失败或用户尚未完成升级时，都不能进入 Workbench。官方最新版本必须支持所有已公开发布的数据库版本。

Windows 从本方案发布的 NSIS 安装包开始，会在卸载或写文件前读取 HKCU/HKLM 已安装版本：允许更高版本安装和同版本修复，拒绝低版本安装包。macOS DMG 无法阻止手动用旧 `.app` 覆盖，由上述运行时版本检查兜底。历史上已经发布的旧安装包无法追溯增加安装器保护。

### DDL 与数据安全规则

- 新增普通字段优先使用 `ALTER TABLE ... ADD COLUMN`。
- 删除无索引、外键、唯一约束等依赖的普通字段，可以直接使用 SQLite `DROP COLUMN`。
- 修改类型、主键、唯一约束、外键，或进行复杂数据转换时，使用“建新表 → 复制并校验 → 替换旧表”。
- 新增的正式 schema 迁移不使用宽泛的 `IF EXISTS` / `IF NOT EXISTS` 掩盖结构异常；预期表或字段不存在时应让事务失败并暴露问题。已发布的 version 1–9 保留历史源码（包括 version 8 的 `DROP TABLE IF EXISTS`），不为满足新规则而改写；该历史例外由迁移锁清单固定。
- 启动迁移应保持可控时长。确实需要处理大量数据时，应先设计可恢复的产品流程，不能把长时间分批任务偷偷塞进启动 migration。
- 本项目不做自动数据库备份。备份无法替代版本兼容和原子事务，而且应用无法替用户判断何时恢复。对“SQL 本身错误但成功提交”的风险，通过已发布迁移冻结、正式 v9 fixture 升级测试、完整性检查和发布门禁控制。

### 发布锁与测试门禁

- `released-migrations.json` 保存已发布 migration 的 version、name、文件和源码 SHA-256。
- `release:start` 在 Tag 前先验证所有已锁 migration 未被修改；Unit 全部通过后，把当前连续 migration 纳入锁清单，再与版本号一起提交。任一已锁源码变化都会直接阻止发布。
- 独立迁移 Unit 必须覆盖：空库到当前版本、正式 v9 带数据升级、两条路径最终 schema 一致、重复初始化、批量失败整批回滚、高版本零写入拒绝、历史缺号/重名/名称冲突、已知别名、锁文件篡改以及两项 SQLite 完整性检查。
- `database-version-update-required` E2E 使用隔离 `userData` 写入高版本 migration 记录并重启，验证只出现恢复页、Workbench 不启动、更新全流程、中文失败提示和官网下载入口仍可用。这个 fixture 只准备启动前数据库，不改生产 schema 检查逻辑。

## Native 依赖

`better-sqlite3` 是 native 模块，Node backend 测试和 Electron e2e 使用不同 ABI。项目通过独立缓存保存两套 binding，不覆盖 `node_modules` 中的同一个 `.node` 文件。

测试 runner 和打包流程会自动准备并注入正确 binding，正常开发与回归不手工 rebuild。

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
- 用 LanceDB 保存伙伴、消息记录、run、审批、网页源、工作地址或配置。

## SQLite 与 LanceDB 的关系

SQLite 决定什么数据有效。检索时 LanceDB 中应只留下最新 chunk；搜索按 `document_id` / `source_type` / `workspace_id` 收窄，不再加 `generation_id`。

搜索流程：

1. 若设置页正在「更新索引」（`workspace_index_job.action = prepare` 且 `running`），`kb_search` / `kb_list_documents` 直接失败。
2. 否则到 LanceDB 搜索当前表中的 chunk。
3. 用 SQLite document 元数据补来源路径或 URL。

「检查更新」只扫目录或网页变化，不写向量，不拦截检索。

## Generation 机制

文件和网页索引先写入新 `generation_id`，成功后切换 SQLite `active_generation_id` 并 **await 删除旧 generation**。失败则删除刚写入的新 generation，保留旧 chunk。启动恢复和索引任务结束后会清理非当前 generation 以及没有对应 document 的孤儿 chunk。generation 只用于这次删除，不用于检索过滤。

## Fragment 和 Optimize

LanceDB fragment 是一次或多次写入形成的数据片段，不等于一行数据。

维护规则：

- chunk 必须批量写入。
- 避免大量小 batch 写入。
- 大量写入或删除后可以执行 optimize。
- optimize 只用于整理向量索引文件，不承担业务 migration。
- 不允许启动时自动删表重建。

## 性能约束

- 伙伴首屏只读取必要数据，不回放完整 run/event。
- 完整 run/event replay、context usage、file change detail 不进入切换首屏关键路径。
- chunk 写入必须批量进行。
- 慢查询优先检查 workspace 过滤、source type 过滤、documentIds 过滤和 fragment 数量。
- 不用缓存掩盖错误的数据边界。
