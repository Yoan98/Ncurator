# NCurator-Desktop 数据库与存储设计

## 1. 存储总览

- SQLite 是业务与元数据真相，位于 `userData/app.sqlite`。
- LanceDB 保存按模型身份与维度隔离的完整 chunk 索引，位于 `userData/lancedb`；正文、FTS 和向量共同存放。
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

本地 Jina（身份 `local:jinaai/jina-embeddings-v2-base-zh`、768 维）使用 `vector_chunk`。其他组合使用 `vector_chunk_<sha256(identity)>_<dim>`，维度必须为正整数。每张表均保存完整 chunk 正文、来源、generation、顺序、元数据与固定维度向量，并具备全文索引；不另设只有向量的补充表。支持批量写入、向量及全文搜索、按 document／workspace／generation 删除，以及 optimize。业务状态只存 SQLite，重嵌的 chunk 幂等写入不承担业务状态合并。

SQLite 的 `document.embedding_identity`、`embedding_dim` 与 `active_generation_id` 决定每份资料当前有效的表和 generation，`embedding_error` 保存重嵌错误，与普通导入错误分离。查询保留 `document_id`、`source_type`、`workspace_id` 的范围约束，来源路径或 URL 由 SQLite 补齐。向量检索只查询当前模型身份和查询向量维度对应的有效表；chunk 读取选择文档有效表。全文检索遍历表族，同一有效 generation 的正文副本按文档与 chunk 身份去重，避免迁移提交期间模型标记变化导致漏检；删除或过期 generation 仍被排除。资料列表来自 SQLite，不依赖嵌入模型就绪。

远程身份由规范化后的实际 embeddings 端点、模型名、官方最大输入 tokens 和输入策略版本共同计算，不包含配置 id、显示名称或 API Key。端点、模型名或输入预算改变产生新身份；仅改名称或 Key 保持身份，Key 更新刷新执行器而不重嵌已完成资料。不同维度的数据始终隔离，不能混合向量检索。

用户填写官方单段总上限，程序预留 `max(16, ceil(上限 × 2.5%))`，其余为正文预算。通用兼容接口没有标准分词器信息，使用每个 Unicode 码点的原 UTF-8 与规范分解／小写展开后 UTF-8 字节数的较大值累计，作为保守 token 估算；该规则不是任意服务分词器的精确计数或保证。切分保留原文字节对应的 Unicode 内容、页码与顺序，不存规范化替换文本、不截断。新建文件／网页索引及后台迁移共用预算；远程执行器在发送前再次校验，过长查询明确失败。向量缓存按含预算的索引身份隔离，基础解析切分缓存保持模型无关，不能把预算切分结果写回基础缓存。

### Generation 与清理

文件和网页索引先写入新 generation；成功后切换 SQLite 的 `document.active_generation_id`，并 **await 删除旧 generation**。失败时删除新 generation，保留旧 chunk。新 generation 激活前取消时，恢复本轮开始前的文档状态、正文哈希及元数据，使已有有效正文仍能参与后续模型迁移；恢复须确认文档仍属于本轮，不能复活已删除资料或覆盖已激活的版本。普通索引的块写入、激活和失败清理以及后台替换，与全库陈旧块清理共用串行闸，避免清理快照删除尚未激活的新块。启动恢复和索引任务结束后，清理非当前 generation 及没有对应 document 的孤儿 chunk。

模型后台重嵌读取有效 generation 的正文，不扫描源文件或重新抓取网页，不需要旧模型执行器。片段布局不变时复用 chunk 身份；输入预算要求进一步切分时生成新 chunk 身份和目标 generation，避免关键词混合旧大块与新小块。目标表先以 `document_id + generation_id + id` 写入全部 chunk，随后校验源 generation、正文哈希、导入状态与任务身份仍有效，再通过 SQLite 事务一起切换有效 generation、模型身份与维度并清除重嵌错误。普通索引正在处理、资料已删除或任务已过期时不提交；失败、暂停、切换和退出前未提交的目标行不成为有效检索内容，旧正文保持可用。各资料写入串行，新 generation 成功后回收旧 generation，失败则回收未激活的新版本。

模型切换本身保留旧模型表与正文；清理、删除和 optimize 遍历整个 chunk 表族。普通内容更新的旧 generation 清理仍然执行，不能因切换模型保留已失效正文。切换后仅迁移已有有效索引且身份不匹配的资料，不创建新的工作地址、网页或资料，也不改变查询范围。

### 模型设置与任务恢复

`embedding_settings` 的单例 JSON 保存当前模型 id、远程配置列表和暂停偏好。远程配置含名称、API 地址、模型名、官方最大输入 tokens 与 API Key；未填写或旧配置缺少上限时统一使用 512，不根据模型名推测更大额度。Key 当前随配置保存在本地 SQLite，不能将该设计描述为系统凭据库或加密存储。用户输入 Key 仍经过 Renderer，Main 读取、编辑回填及操作响应只投影 `hasApiKey`，不返回已保存 Key。

Main 选择模型后立即切换后续嵌入执行器，不等待全库完成，也不自动 fallback。文档模型标记和重嵌错误构成可恢复进度：当前身份为已完成，身份不匹配且存在错误为失败，其余有效资料为待处理。切换或重试清除上次任务错误，切回已有有效模型不会保留其他目标的失败状态。合法空资料以维度 0 表示，不请求嵌入、不创建向量表；同身份已有正维度时，响应维度变化明确失败。进度只统计已有有效 generation。暂停偏好持久化，退出时取消在途执行并停止旧任务提交；启动后恢复未暂停的剩余任务，失败项由重试清除错误后重新处理。此任务不写入普通 `workspace_index_job` 的 running prepare 门禁。

普通文件／网页更新索引仍阻断 KB 检索和列表查询；模型后台迁移不触发该门禁。关键词与列表查询不要求嵌入就绪，向量／混合查询依赖当前模型且失败明确返回；工具对当前范围内的待处理及失败资料提示语义覆盖不足。产品行为和验收见 [Settings PRD](../prd/settings.md#46-向量模型管理)。

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

### 共享用户 Skill 资产

`userData/skills/{name}/` 保存用户导入或手动创建的标准 Skill 文件夹，包含 `SKILL.md` 与可选的 `scripts/`、`references/`、`assets/` 及其他普通文件。导入复制整个所选目录，不引用源路径，也不扫描平台账号或用户主目录。原始 YAML（包括未知字段）和资源字节保持不变。共享资产不是伙伴运行缓存，删除伙伴或清理 runtime 不删除它。

`user_skill` 只记录 ID、名称、描述、目录名和创建时间；正文和资源只存文件。`partner_user_skill` 保存显式启用关系，导入不会自动启用。删除伙伴只级联其绑定；删除资产级联所有绑定并移除受管目录。

创建和导入先写同级临时目录，校验后发布，再写元数据；同名冲突不覆盖旧资产，失败清理本次临时文件。拒绝符号链接、特殊文件、越界路径；单文件最多 16 MiB、目录最多 64 MiB / 1000 项、`SKILL.md` 最多 32 KiB。名称遵守小写字母/数字/单连字符规则（最多 64 字符），并排除跨平台保留文件名。运行时重新检查启用关系和受管文件；元数据被外部修改时要求重新导入，不暗中改变目录身份。

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
