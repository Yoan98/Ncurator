# NCurator-Desktop Docx 设计细节

本文定义 docx 子系统中必须对齐的设计方向、职责边界、核心数据与关键规则。整体架构、主流程和模块关系见 `architecture.md`。

## 1. 设计不变量

- `source baseline` 只做初始化基线与最终落盘目标，不做持续工作副本。
- `read session` 只负责读取与搜索，不承担审阅、提交或持续编辑职责。
- `replay session` 是运行时唯一真相，当前状态持续更新，后续编辑始终基于最新状态继续推进。
- `working / review / committed` 三个 view 都从当前 session 单向投影，不能反向重建真相。
- 文档只维护设计边界、核心数据与稳定规则；实现约束、阈值和底层细节以代码为准。

## 2. 关键流程

1. docx 先以 `source` 初始化只读会话。
2. 纯读取场景停留在 `read session`，只做解析、索引、搜索和精读。
3. 进入 create、edit、history、rollback 或 review 后，升级到 `replay session`。
4. 编辑始终写入当前 session 的最新状态，并生成新的 revision。
5. 当前 session 可以投影出 `working`、`review`、`committed` 三类视图。
6. `review view` 用于用户审阅，`committed view` 用于最终落盘。
7. 回滚、提交和丢弃都围绕当前 session 和其视图 artifact 展开。

## 3. Source Baseline

### 职责边界

- `source baseline` 是文档运行链路的起点。
- update 模式下，`source` 同时也是最终提交要覆盖写回的目标。
- create-target 模式下，baseline 可以是空文档快照，最终目标路径只在 commit 时真正落地。

### 规则说明

- `source` 不参与持续编辑中的“当前工作真相”维护。
- review 或 committed 视图不能重新回退为“以 source 为真相做累计差异重建”。

## 4. Read Session

### 职责边界

- `read session` 负责打开 `source` 后的只读阶段真相。
- 它维护解析结果、块级索引和局部缓存，供 outline、search 和 read 等读取工具复用。
- 它不建立 revision tree、review artifact 或 committed artifact。

### 相关数据定义

```ts
interface DocxReadSession {
  // 当前只读会话绑定的最终 sourcePath。
  sourcePath: string
  // 当前读取视角对应的 worker 文档标识。
  docId: string
  // 当前只读会话对应的文档元信息与统计。
  meta: DocxOpenMeta
  stats: DocxOpenStats
  // 只读路径默认停留在初始 revision；只有升级到 replay 后才继续演化。
  currentRevisionRef: string
  // 解析结果派生的只读缓存。
  cache: {
    outlineByCacheKey: Map<string, { blocks: DocxOutlineBlock[] }>
    detailByBlockId: Map<string, DocxDetailedBlock>
  }
}
```

### 规则说明

- 纯读取路径必须复用同一份解析结果，避免每次精读都重新全文解析。
- 升级到 `replay session` 后，旧的 `read session` 应释放，不同时保留两套运行态缓存。

## 5. Replay Session

### 职责边界

- `replay session` 是 docx 当前会话的唯一运行真相。
- 它维护当前最新状态、revision 链、节点身份、块顺序以及视图 artifact 缓存。
- 所有写工具、history、rollback、review 和 commit 都围绕它工作。

### 相关数据定义

```ts
interface DocxReplaySession {
  // 本次会话绑定的最终目标路径；update 模式下是源文件路径，create 模式下是 commit 输出目标路径。
  sourcePath: string
  // 当前会话是修改已有文件还是新建目标文件。
  targetMode: 'update' | 'create'
  // baseline 打开时对应的 worker 文档标识。
  sourceDocId: string
  // 当前最新状态对应的 worker 文档标识。
  activeDocId: string
  // 当前会话最新修订引用。
  activeRevisionRef: string
  // 下一次成功编辑要分配的修订号。
  nextRevisionNumber: number
  // baseline 对应的结构快照。
  sourceSnapshot: DocxReplaySnapshot
  // 当前最新状态对应的结构快照。
  activeSnapshot: DocxReplaySnapshot
  // 当前会话所有节点的真相表。
  nodeById: Map<string, DocxReplayNode>
  // 当前正文顺序。
  bodyNodeIds: string[]
  // 当前会话的修订集合。
  revisionByDocId: Map<string, DocxRevision>
  // 最近一次物化出来的视图 artifact 缓存。
  viewArtifacts: {
    working?: DocxViewArtifact
    review?: DocxViewArtifact
    committed?: DocxViewArtifact
  }
}

interface DocxReplayNode {
  // 节点稳定标识；跨 revision 用它追踪同一个语义节点。
  nodeId: string
  // 节点在 source 中对应的原始 block 标识；新增节点可缺失。
  sourceBlockId?: string
  // 节点在当前 active snapshot 中对应的 block 标识。
  currentBlockId?: string
  // 节点当前结构对象；三种视图都从它读取。
  spec: DocxBlockSpec
  // 节点当前审阅状态。
  reviewState: DocxReviewState
  // 节点来源；区分 source 节点与后续新增节点。
  sourceOrigin: 'source' | 'generated'
  // 节点最近一次被哪个 revision 变更过。
  changedRevisionRef?: string
  // 节点最初由哪个 revision 创建。
  createdRevisionRef?: string
}

interface DocxRevision {
  // 对外暴露的修订引用。
  revisionRef: string
  // 该修订对应的 worker 文档标识。
  docId: string
  // 该修订的直接父修订。
  parentRevisionRef?: string
  // 修订创建时间。
  createdAt: number
  // 本次修订的摘要。
  summary?: string
  // 本次修订命中的块级变化摘要。
  changedBlocks?: DocxChangedBlock[]
  // 本次修订真正执行过的编辑 op。
  ops?: DocxOp[]
  // 本次修订新增的 block 列表。
  createdBlocks?: DocxCreatedBlock[]
}
```

### 规则说明

- 当前状态必须持续更新，下一轮编辑始终基于 `activeSnapshot` 对应的最新状态继续执行。
- `artifact` 只是物化缓存，不能反过来成为运行真相来源。
- 结构插入后的节点重绑必须先保留本轮新增块，再去匹配旧节点，避免 review 中出现下游旧块重复或错位。

## 6. Working / Review / Committed Views

### 职责边界

- `working draft view` 给 AI 读取和继续编辑，只保留当前有效内容。
- `review view` 给用户审阅，稳定表达新增、删除和替换。
- `committed view` 给最终提交使用，去除审阅态。

### 相关数据定义

```ts
interface DocxViewArtifact {
  // 当前 artifact 属于哪个视图。
  kind: 'working' | 'review' | 'committed'
  // 物化后的文件路径。
  path: string
  // 最近一次生成时间。
  createdAt: number
}
```

### 规则说明

视图关系固定为：

```text
DocxReplaySession -> working/review/committed views -> artifacts
```

- `working artifact` 对应 AI 读取的当前工作稿。
- `review artifact` 对应用户看到的审阅稿。
- `committed artifact` 对应最终提交时落盘的正式文档。
- 三种 artifact 都只能从当前 session 单向生成。

## 7. Edit / History / Rollback

### 职责边界

- 写工具的内部语义都是“对当前 session 的最新状态继续编辑”。
- `history` 按 revision 暴露过程历史。
- `rollback` 按 revision 恢复当前 session 状态。

### 相关数据定义

```ts
type DocxOp =
  | { type: 'create_document' }
  | { type: 'insert_before' | 'insert_after' | 'replace_block' }
  | { type: 'delete_block' | 'update_table_cell' | 'replace_text' | 'style_text' }
```

### 规则说明

- 每次 edit 成功后都必须形成一个新的 revision。
- `changedBlocks` 必须进入 revision 摘要，供 review 和 rollback 诊断使用。
- 新增块必须通过 `createdBlocks` 明确记录，而不是仅靠 `blockId` 集合差推断。
- `rollback` 成功后，working、review、committed 三个 view 都必须重新对齐当前状态。

## 8. Review / Commit / Discard

### 职责边界

- review 只负责稳定表达当前变更，不参与继续编辑。
- commit 只负责从 committed 视图落盘。
- discard 只清理运行态和 artifact，不改写 source。

### 规则说明

- review 视图必须直接从当前 session 投影生成，不能重新以 source 为基线做累计差异重建。
- commit 必须从 `committed artifact` 落盘；update 模式覆盖写回 source，create-target 模式原子创建最终目标文件。
- create-target 模式下，正式目标文件在 commit 前不得真实存在于 workspace 目标路径。
- discard 后，create-target 模式的最终目标路径必须继续不存在。

## 9. Tool 与底层执行边界

### 职责边界

- Tool API 层统一定义 docx 工具名、schema 和 AI-facing 能力边界。
- read / write tools 负责 AI-facing 语义。
- runtime / session 层是 read/write、worker 与 review/commit 之间的中控层。
- worker 与 OOXML adapter 负责打开、解析、执行和校验底层文档结构。

### 规则说明

- `docx_create` 负责建立新的 docx draft target 与初始化 session，不直接等价于最终提交。
- `docx_outline`、`docx_search`、`docx_read_blocks` 都应面向“当前最新文档”工作，而不是固定回看 source。
- 写工具结果继续保留 `postWriteReadback.regions` 这类写后复核信息，供上层判断是否继续编辑或额外读取。

## 10. 不纳入文档维护的实现细节范围

- 读取范围换算、体积阈值、预算比例等实现参数。
- tool family 内部每个工具的逐项行为限制清单。
- OOXML 层的样式继承细节、具体 XML 操作方式和底层校验步骤。
- review 样式叠加、freshness 校验和原子替换的实现细节。
