# NCurator-Desktop 数据库设计

本文说明本地存储边界、SQLite 与 LanceDB 的职责关系、schema 演进规则，以及索引一致性约束。

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

与存储布局相关的约束：

- 大对象以 SHA-256 内容寻址落在 `userData/partners/{id}/objects/sha256/<前 2 位>/<其余>`，SQLite 只存引用；相同内容只存一份。
- `document.active_generation_id` 只用于写后删旧 chunk 与孤儿清理，不进入检索 `where`。
- 外键级联与无 CASCADE 绑定以当前 schema / migration 为准。

## SQLite Migration

### 当前边界

- 当前代码支持的最终 schema version 由 `CURRENT_SCHEMA_VERSION` 定义。
- 已随正式版发布的 migration 永久保留且不可改写，发布边界以 `released-migrations.json` 为准。
- 已知历史例外：version 2 的旧名称 `workspace_change_sets`；version 9 继续负责修复通知字段。
- 各版本具体 DDL / 数据变更以对应 migration 源码为准；空库执行完整版本序列后，结构与主升级路径一致。
- 未进入发布清单的连续迁移可以在发布前合并或重写；进入清单后只能新增更高版本修复。

### 版本身份与执行规则

- migration 记录在 `schema_migrations`，身份由 `version + name` 共同确定，不能只看最大版本号。
- migration 定义统一放在 `migrations/00X_*.ts`。版本必须从 1 开始连续、严格递增且唯一；文件版本、定义版本和执行顺序必须一致。
- 已执行记录必须是当前 migration 列表的合法连续前缀。除明确登记的历史别名外，缺号、名称冲突或未知记录都视为数据库历史损坏，拒绝启动。
- 数据库版本高于 `CURRENT_SCHEMA_VERSION` 时，在写 migration、切换 WAL 或初始化业务服务前抛出 `DatabaseVersionTooNewError`，错误同时携带检测版本和支持版本。
- 一次启动中的全部待执行 migration、对应的 `schema_migrations` 记录、`PRAGMA quick_check` 和 `PRAGMA foreign_key_check` 位于同一个 SQLite transaction。任一步失败，整批升级回滚，数据库不会停留在半升级状态。声明了 `afterCommit` 的版本在同一事务中写入 `schema_migration_hooks(status=pending)`；事务提交后、LanceDB 连接前执行这些 hook，成功后标 `done`。`afterCommit` 不在 SQLite 事务里，不得回写 schema。
- migration 必须可重复初始化：已经完整执行的版本不会再次执行。`afterCommit` 只在 hook 仍为 `pending` 时重试。不提供 down migration、自动数据库复制、自动备份或自动恢复。

### 启动与禁止降级

- 数据库兼容且迁移成功：继续初始化 Storage、LanceDB 与业务服务。
- 数据库版本高于当前应用支持版本：抛出 `DatabaseVersionTooNewError`，不初始化业务服务。
- 其他迁移错误按启动错误处理，不能把 schema 损坏误判成可更新状态。
- 官方最新版本必须支持所有已公开发布的数据库版本。

### DDL 与数据安全规则

- 新增普通字段优先使用 `ALTER TABLE ... ADD COLUMN`。
- 删除无索引、外键、唯一约束等依赖的普通字段，可以直接使用 SQLite `DROP COLUMN`。
- 修改类型、主键、唯一约束、外键，或进行复杂数据转换时，使用“建新表 → 复制并校验 → 替换旧表”。
- 新增的正式 schema 迁移不使用宽泛的 `IF EXISTS` / `IF NOT EXISTS` 掩盖结构异常；预期表或字段不存在时应让事务失败并暴露问题。已发布的 version 1–9 保留历史源码（包括 version 8 的 `DROP TABLE IF EXISTS`），不为满足新规则而改写；该历史例外由迁移锁清单固定。
- 启动迁移应保持可控时长。确实需要处理大量数据时，应先设计可恢复的产品流程，不能把长时间分批任务偷偷塞进启动 migration。
- 本项目不做自动数据库备份。备份无法替代版本兼容和原子事务，而且应用无法替用户判断何时恢复。对“SQL 本身错误但成功提交”的风险，通过已发布迁移冻结、正式 fixture 升级测试、完整性检查和发布门禁控制。

### 发布锁与测试门禁

- `released-migrations.json` 保存已发布 migration 的 version、name、文件和源码 SHA-256。
- `release:start` 在 Tag 前先验证所有已锁 migration 未被修改；Unit 全部通过后，把当前连续 migration 纳入锁清单，再与版本号一起提交。任一已锁源码变化都会直接阻止发布。
- 独立迁移 Unit 必须覆盖：空库到当前版本、正式带数据升级路径、两条路径最终 schema 一致、重复初始化、批量失败整批回滚、高版本零写入拒绝、历史缺号/重名/名称冲突、已知别名、锁文件篡改以及两项 SQLite 完整性检查。
- 高版本拒绝初始化的 E2E（隔离 `userData` 写入高版本 migration 记录）验证不初始化业务层；fixture 只准备启动前数据库，不改生产 schema 检查逻辑。

## Native 依赖

`better-sqlite3` 是 native 模块，Node backend 测试和 Electron e2e 使用不同 ABI。项目通过独立缓存保存两套 binding，不覆盖 `node_modules` 中的同一个 `.node` 文件。

测试 runner 和打包流程会自动准备并注入正确 binding，正常开发与回归不手工 rebuild。

## LanceDB

LanceDB 只创建和使用 `vector_chunk` 表。

允许操作：

- 批量写入 chunks。
- 向量搜索和全文搜索 chunks。
- 按 `document_id / workspace_id / generation_id` 删除 chunks。
- 对向量表执行 optimize。

禁止操作：

- 高频业务 update。
- 业务状态 mergeInsert。
- 用 LanceDB 保存 SQLite 已承担的业务真相。

## SQLite 与 LanceDB 的关系

SQLite 决定什么数据有效。检索时 LanceDB 中应只留下最新 chunk；搜索按 `document_id` / `source_type` / `workspace_id` 收窄，不再加 `generation_id`。用 SQLite document 元数据补来源路径或 URL。

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

- chunk 写入必须批量进行。
- 慢查询优先检查 workspace 过滤、source type 过滤、documentIds 过滤和 fragment 数量。
- 不用缓存掩盖错误的数据边界。

## 文件版本持久化

文件会话和结构身份是 Main 内部元数据，不新增业务表。使用现有 `ai_file_change` 保存首次 A 的对象引用、最终确认 B 的校验、审核路径、统计、撤销状态和错误；Word 应用记录通过统一记录投影，不再维护另一套基线及撤销。

```text
userData/
├── app.sqlite
└── partners/{partnerId}/
    ├── objects/sha256/...                         原始 A，内容去重
    └── runtime/file-changes/{ownerRunId}/{changeId}/
        ├── working-{version}.{ext}                唯一最新确认 B，临时
        ├── pending.json                          会话和结构身份，临时
        └── review/{artifactId}/                   自包含审核，长期
```

每次发布使用新的工作版本路径，确认后清理上一份。每次审核使用独立产物路径并更新记录引用，避免同路径覆盖和缓存陈旧。Word 保存 review.docx，Excel 保存 review.xlsx，PPT 保存 manifest.json、前后 SVG 与必要资源，文本保存含完整有序行及旧新行数的 review.json。全部资源和记录保存成功后清理工作版本及 pending；失败保留输入，以便重启补生成或重复收尾。已有文件零净变化移除本轮记录，新建空文件仍保留。

内容审核完成后 after_snapshot_path/after_object_hash 为空；图片继续保留历史图片快照。原始 A 保留用于撤销。清空消息保留回退记录和资源；删除伙伴等待运行写入及收尾结束，再清理对应目录。只清理本次产生且无引用的文件。旧审核不迁移、不从当前文件重建，旧记录不删除。
