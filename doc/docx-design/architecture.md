# NCurator-Desktop Docx 架构设计

本文定义 docx 编辑子系统的整体思路，只描述主线、角色和核心原则。

## 1. 子系统目标

docx 子系统负责三件事：

- 让 AI 在同一份文档上高效读取，并在需要时升级到连续多轮编辑。
- 让用户看到稳定的新增、删除和替换差异。
- 让确认后的结果安全落盘回源文件。

## 2. 核心结构

docx 子系统围绕五个对象工作：

- `source baseline`：原始文档基线，只负责初始化和最终落盘目标。
- `read session`：只读阶段真相，持有解析结果、索引与局部缓存。
- `replay session`：当前会话真相，持有持续更新的最新状态。
- `working draft view`：给 AI 读取和继续编辑的当前工作视图。
- `review / committed view`：分别给用户审阅和最终提交。

## 3. 整体分层

```mermaid
flowchart TD
    A["Tool API<br/>toolSpecs / schemas / index"] --> B["Read / Write Tools<br/>readTools / writeTools"]
    B --> C["Runtime / Session<br/>runtime / types"]
    C --> D["Worker<br/>docxWorker / workerClient"]
    D --> E["OOXML Adapter<br/>blockIndex / opExecutor / validator"]
    C --> F["Review / Commit<br/>replayTree / viewProjector / reviewSerializer"]
```

- Tool API 层负责对 AI 暴露 docx 工具与 schema。
- Read / Write tools 层负责 AI-facing 的读取、搜索、编辑与回滚语义。
- Runtime / Session 层负责 sourcePath、read session、replay session、revision 与 open target 的统一管理。
- Worker 层负责实际文档打开、读取、搜索、编辑执行与校验。
- OOXML Adapter 层负责 docx 结构解析、block 建模与底层 op 执行。
- Review / Commit 层负责三视图投影、审阅稿生成、提交与丢弃。

## 4. 主流程

### 4.1 初始化与读取

- 纯读取阶段，打开 `source` 后先建立 `read session`。
- `read session` 只负责解析、索引、分页读取与搜索，不建立 revision/review 状态。
- 只有当 AI 真的要 create / edit / history / rollback / review 时，才从当前 `read session` 升级到 `replay session`。

### 4.2 持续更新当前状态

- AI 每轮都读取最新的 `working draft view`。
- AI 发起 edit 后，系统把改动写进当前 `replay session`。
- session 更新后，再投影出新的 working draft。

这条链路的关键不是“反复回到 source 重算”，而是：

> 当前状态会持续更新，下一轮始终基于最新状态继续工作。

### 4.3 审阅

- 用户看到的是 `review view`。
- review view 直接从当前 session 投影，不重新以 source 为基线做差异重建。
- review 只负责稳定表达新增、删除和替换，不参与继续编辑。

### 4.4 提交

- 用户确认后，系统从当前 session 生成 `committed view`。
- committed view 是最终正式文档。
- 落盘时只把 committed view 写回源文件。

## 5. 关键原则

- `source` 只做基线，不做持续工作副本。
- `read session` 只负责读取，不能提前承担审阅和提交职责。
- `replay session` 是运行时唯一真相。
- AI 永远只读 `working draft view`。
- 用户永远只看 `review view`。
- 提交永远只从 `committed view` 落盘。
- 三个 view 都从当前 session 直接投影，不能互相反推真相。

## 6. 文档边界

- 设计边界、核心数据与关键规则见 `/Users/test/work-space/NCurator-Desktop/doc/docx-design/design-detail.md`
