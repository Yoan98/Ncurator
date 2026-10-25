# NCurator-Desktop 数据库与存储设计

## 1. 存储总览

- SQLite 是业务与元数据真相，位于 `userData/app.sqlite`。
- LanceDB 是可重建的 `vector_chunk` 索引，位于 `userData/lancedb`。
- 文件资源保存附件、工具结果、备份、工作版本与审核产物，SQLite 保存其业务关联及校验。
- 同一业务状态不能同时以 SQLite 和 LanceDB 为真相；完整表字段见 [数据表目录](tables.md)。

## 2. 数据库存储

### SQLite 初始化

SQLite 使用 `better-sqlite3`。启动时 `SqliteCore` 负责：

- 打开 `app.sqlite`。
- 设置 `PRAGMA foreign_keys = ON`。
- 设置 `PRAGMA busy_timeout = 5000`。
- 在任何迁移写入前读取并校验 `schema_migrations`。
- 数据库版本兼容时设置 `PRAGMA journal_mode = WAL`，并执行全部待执行 migration。

外键级联与无 CASCADE 绑定以当前 schema／migration 为准。

### Schema 演进

#### 当前边界

- 当前代码支持的最终 schema version 由 `CURRENT_SCHEMA_VERSION` 定义。
- 已随正式版发布的 migration 永久保留且不可改写，发布边界以 `released-migrations.json` 为准。
- 已知历史例外：version 2 的旧名称 `workspace_change_sets`；version 9 继续负责修复通知字段。
- 各版本具体 DDL / 数据变更以对应 migration 源码为准；空库执行完整版本序列后，结构与主升级路径一致。
- 未进入发布清单的连续迁移可以在发布前合并或重写；进入清单后只能新增更高版本修复。

#### 版本身份与执行规则

- migration 记录在 `schema_migrations`，身份由 `version + name` 共同确定，不能只看最大版本号。
- migration 定义统一放在 `migrations/00X_*.ts`。版本必须从 1 开始连续、严格递增且唯一；文件版本、定义版本和执行顺序必须一致。
- 已执行记录必须是当前 migration 列表的合法连续前缀。除明确登记的历史别名外，缺号、名称冲突或未知记录都视为数据库历史损坏，拒绝启动。
- 数据库版本高于 `CURRENT_SCHEMA_VERSION` 时，在写 migration、切换 WAL 或初始化业务服务前抛出 `DatabaseVersionTooNewError`，错误同时携带检测版本和支持版本。
- 一次启动中的全部待执行 migration、对应的 `schema_migrations` 记录、`PRAGMA quick_check` 和 `PRAGMA foreign_key_check` 位于同一个 SQLite transaction。任一步失败，整批升级回滚，数据库不会停留在半升级状态。声明了 `afterCommit` 的版本在同一事务中写入 `schema_migration_hooks(status=pending)`；事务提交后、LanceDB 连接前执行这些 hook，成功后标 `done`。`afterCommit` 不在 SQLite 事务里，不得回写 schema。
- migration 必须可重复初始化：已经完整执行的版本不会再次执行。`afterCommit` 只在 hook 仍为 `pending` 时重试。不提供 down migration、自动数据库复制、自动备份或自动恢复。

#### 启动与禁止降级

- 数据库兼容且迁移成功：继续初始化 Storage、LanceDB 与业务服务。
- 数据库版本高于当前应用支持版本：抛出 `DatabaseVersionTooNewError`，不初始化业务服务。
- 其他迁移错误按启动错误处理，不能把 schema 损坏误判成可更新状态。
- 官方最新版本必须支持所有已公开发布的数据库版本。

#### DDL 与数据安全规则

- 新增普通字段优先使用 `ALTER TABLE ... ADD COLUMN`。
- 删除无索引、外键、唯一约束等依赖的普通字段，可以直接使用 SQLite `DROP COLUMN`。
- 修改类型、主键、唯一约束、外键，或进行复杂数据转换时，使用“建新表 → 复制并校验 → 替换旧表”。
- 新增的正式 schema 迁移不使用宽泛的 `IF EXISTS` / `IF NOT EXISTS` 掩盖结构异常；预期表或字段不存在时应让事务失败并暴露问题。已发布的 version 1–9 保留历史源码（包括 version 8 的 `DROP TABLE IF EXISTS`），不为满足新规则而改写；该历史例外由迁移锁清单固定。
- 启动迁移应保持可控时长。确实需要处理大量数据时，应先设计可恢复的产品流程，不能把长时间分批任务偷偷塞进启动 migration。
- 本项目不做自动数据库备份。备份无法替代版本兼容和原子事务，而且应用无法替用户判断何时恢复。对“SQL 本身错误但成功提交”的风险，通过已发布迁移冻结、正式 fixture 升级测试、完整性检查和发布门禁控制。

#### 已发布迁移锁

`released-migrations.json` 保存已发布 migration 的 version、name、文件及源码 SHA-256。锁定的源码变化会阻止发布，只能新增更高版本修复。升级保障包括正式带数据 fixture、结构一致性与完整性检查；发布操作与门禁顺序见 [发布流程](../deploy/release.md#11-发布准备与-tag)。

### Native 运行环境

`better-sqlite3` 在 Node backend 与 Electron 中使用不同 ABI。两套 binding 通过独立缓存准备和注入，不覆盖 `node_modules` 中的同一个 `.node` 文件；测试 runner 和打包流程负责选择正确 binding。

## 3. 索引存储

### 数据边界与检索

LanceDB 只创建和使用 `vector_chunk`：支持批量写入、向量及全文搜索、按 document／workspace／generation 删除，以及 optimize。禁止高频业务 update、业务状态 mergeInsert，或保存 SQLite 已承担的业务真相。

SQLite 决定数据是否有效。检索按 `document_id`、`source_type`、`workspace_id` 收窄，并由 SQLite 补齐来源路径或 URL，不将 `generation_id` 加入检索过滤。

### Generation 与清理

文件和网页索引先写入新 generation；成功后切换 SQLite 的 `document.active_generation_id`，并 **await 删除旧 generation**。失败时删除新 generation，保留旧 chunk。启动恢复和索引任务结束后，清理非当前 generation 及没有对应 document 的孤儿 chunk。

### Fragment 与性能

LanceDB fragment 是一次或多次写入形成的数据片段，不等于一行数据。

- chunk 批量写入，避免大量小 batch。
- 大量写入或删除后可 optimize；它只整理向量索引文件，不承担业务 migration。
- 不在启动时自动删表重建。
- 慢查询先检查 workspace、source type、documentIds 过滤及 fragment 数量，不用缓存掩盖错误的数据边界。

### 应用偏好与官方目录缓存

`app_settings` 保存语言和官方服务线路。线路没有有效值时按只读发行标识初始化并写回；已有值不被启动或升级覆盖。设置采用局部更新，避免不同面板覆盖彼此的偏好。语言在下次启动生效，线路影响后续操作。

免费和预设模型目录按服务线路及有效语言保存独立缓存；免费模型短时凭证和续期任务按入口隔离。模型图标仍按资源 URL 缓存。切换线路不迁移或复用另一入口的凭证。

## 4. 文件资源与目录布局

### 测试索引计算缓存

测试可显式启用持久解析/向量缓存；解析按真实源内容、影响锚点的名称和解析/切分指纹寻址，向量按嵌入文本序列、模型资产及执行指纹寻址。缓存不包含 workspace/document ID、绝对临时路径、数据库或 job 状态，绑定和索引写入始终在当前隔离存储完成。依赖指纹变化、快照结构/向量形状或完整性不匹配时重新计算，原子发布避免半成品。测试调度、预热与强制冷跑规则见 [测试规范](../test.md#调度与缓存)。

### 共享用户 Skill 资产

`userData/skills/{name}/` 保存用户导入或手动创建的标准 Skill 文件夹，包含 `SKILL.md` 与可选的 `scripts/`、`references/`、`assets/` 及其他普通文件。导入复制整个所选目录，不引用源路径，也不扫描平台账号或用户主目录。原始 YAML（包括未知字段）和资源字节保持不变。共享资产不是伙伴运行缓存，删除伙伴或清理 runtime 不删除它。

`user_skill` 只记录 ID、名称、描述、目录名和创建时间；正文和资源只存文件。`partner_user_skill` 保存伙伴表单内显式选择的绑定，伙伴属性和绑定在同一 SQLite 事务中保存；导入不会自动启用。删除伙伴只级联其绑定；删除资产级联所有绑定并移除受管目录。

创建和导入先写同级临时目录，校验后发布，再写元数据；同名导入经确认后替换，保留稳定 ID 和绑定；编辑保留未知 YAML 和资源，重命名同步目录及元数据。文件发布或数据库更新失败时回滚旧资产，取消清理暂存；普通文件保留源权限位。拒绝符号链接、特殊文件、越界路径；附带资源单文件最多 16 MiB、资源合计最多 64 MiB，整个目录最多 1000 项。根 `SKILL.md` 不设独立字节上限，不计入附带资源大小；解析、创建、编辑、导入和读取共用此规则。名称遵守小写字母/数字/单连字符规则（最多 64 字符），并排除跨平台保留文件名。运行时重新检查启用关系、目录与正文；外部元数据变化通过按名称同步索引修复，不推断目录重命名关系。启用及修改共享正文时检查所有受影响伙伴的 64 KiB 正文预算。

导入草稿可修改名称、描述和正文；发布时合并到暂存副本的 YAML，只修改已知字段。显式替换目标使用稳定 ID，发布前重新检查目标、名称冲突及预算。编辑内容和导入草稿返回相对资源清单；资源读取逐段拒绝符号链接和越界，暂存访问校验所属窗口与有效期。文本预览限 256 KiB，图片按普通文件限制读取；打开文件夹只定位受管目录，不执行资源。

AI 直接维护 `userData/skills/{name}/`，名称必须与根 SKILL.md 一致；同步只更新元数据索引与显式请求的当前伙伴绑定，不复制、重写或执行文件。同名更新保留内部 ID 和所有绑定；直接改目录名按新资产识别，旧绑定不自动迁移。状态查询仅返回已登记资产的配置状态。

UI 创建、编辑和导入继续以暂存目录发布，发布与同步共用索引写入、最终绑定预算检查和变更通知；UI 文件或数据库失败恢复旧资产。AI 已直接写入磁盘的修改不随同步失败回滚，索引和绑定在正常同步校验通过后同事务提交。显式停用允许在目录损坏、缺失或超限时解除当前伙伴已有绑定，并在反馈中说明目录未同步。运行前检查当前伙伴全部启用正文的总预算，格式和超限错误明确反馈。成功写入统一通知 UI 刷新，不覆盖未保存草稿；不新增数据库迁移。

### 伙伴运行资源

伙伴资源位于 `userData/partners/{partnerId}/runtime/`：

| 目录                                    | 用途                                 |
| --------------------------------------- | ------------------------------------ |
| `scripts/`                              | 一次性临时脚本                       |
| `toolresult/{runId}/`                   | 大工具结果的落盘正文                 |
| `assets/`                               | 附件、生成文件与渲染中间资源         |
| `file-changes/{ownerRunId}/{changeId}/` | 独立原始备份、临时工作版本与长期审核 |

读取图片的缓存位于 `assets/read_image-cache/<hash>-v1.webp`，按源图 SHA-256 寻址，消息只存路径引用。该缓存不是用于文件回退的原始备份。模型图标缓存位于 `userData/llm-icons/`，不属于伙伴数据。

### 文件版本资源

```text
file-changes/{ownerRunId}/{changeId}/
├── before.{ext}                原始 A，用于回退
├── after*.{ext}                图片历史快照
├── working-{version}.{ext}     最新确认 B，临时
├── pending.json               会话与结构身份，临时
└── review/{artifactId}/        自包含审核，长期
```

文件会话与结构身份是 Main 内部元数据，不新增业务表。`ai_file_change` 保存首次 A 的备份路径、确认 B 的校验、审核路径、统计、撤销状态和错误；Word 应用记录通过统一记录投影，共用基线及撤销。

每条修改独立保存原始字节、备份与审核，SQLite 保存路径及校验，不依赖共享对象仓库。每次确认使用新工作版本路径，确认后清理上一份；审核使用独立产物路径并更新记录引用，避免覆盖与缓存陈旧。

| 类型  | 自包含审核产物                                                                 |
| ----- | ------------------------------------------------------------------------------ |
| Word  | review.docx、navigation.json 定位索引                                          |
| Excel | review.xlsx、navigation.json，固定原始与最终公式结果及审核坐标到最终坐标的映射 |
| PPT   | manifest.json、前后 SVG、navigation.json 及必要资源                            |
| 文本  | review.json v4，包含完整 before/after 文本                                     |
| 图片  | 历史图片快照                                                                   |

## 5. 生命周期与一致性

### 文件确认、收尾与恢复

正式文件完成替换并回读校验后，才持久化确认工作版本与结构身份。失败不自动恢复正式文件；未确认版本不成为最终审核的 B。

主运行完成、失败或取消时，等待在途写入结束，使用原始 A 和最后确认 B 生成审核。子任务、yield 和追加消息续接共用 ownerRunId，不单独触发最终审核；执行终态见 [Human Harness](../ai-harness/human-harness.md#8-交付与失败)。

全部资源和记录保存成功后清理工作版本及 pending；失败保留输入，供重启补生成或重复收尾。已有文件零净变化移除本轮记录，新建空文件仍保留。内容审核完成后 `after_snapshot_path/after_object_hash` 为空；图片继续保留历史快照，原始 A 保留用于回退。

Office 历史审核只依赖本条记录的产物；文本审核左侧依赖保存的 A，右侧读取并编辑当前正式文件 C。定位索引和审核同生命周期，记录 B 校验、稳定区域 ID 及只读定位上下文（段落原文、幻灯片／元素身份、单元格值和同行／同列锚点），不向实际文件写入定位标记；旧产物不转换、不进入旧渲染链路。启动或伙伴恢复只补生成未完成文件会话的审核，不执行 AI、不修改正式文件。

### 消息与子会话

`ai_subagent` 保存子会话身份，主子完整日志共用 `chat_session_message_log`，由可空 `subagent_id` 隔离。主会话和各子会话分别分配 seq 与唯一索引，主查询排除子完整日志。

完成交付时，父 annotation 与子会话删除同事务提交；失败保留子上下文。启动标记中断，不自动恢复执行。消息投影和压缩规则见 [Human Harness](../ai-harness/human-harness.md)。

### 保留与删除

| 操作                   | 数据与资源处理                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 清空消息、保留修改历史 | 删除消息与子会话，保留文件修改记录和回退、审核资源                                                                                                       |
| 清空消息并删除修改历史 | 同时删除关联修改记录及资源，不回滚已写正式文件                                                                                                           |
| Settings 缓存清理      | 保留 transcript 和 ai_run，按选定时段删除对应缓存及修改记录，覆盖四类伙伴 runtime 目录；同次扫描分别汇总全部占用与符合截止时间、引用保护条件的可清理数据 |
| 删除伙伴               | 等待运行写入与收尾结束，删除关联数据及伙伴目录                                                                                                           |
