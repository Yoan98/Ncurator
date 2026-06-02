# NCurator-Desktop Docx 设计细节

本文定义 docx 子系统中必须对齐的设计方向、职责边界、核心数据与关键规则。整体架构、主流程和模块关系见 `architecture.md`。

## 1. 设计不变量

- `source baseline` 只做初始化基线与最终写回目标，不做持续工作副本。
- `read session` 只负责读取与搜索，不承担持续编辑或写回职责。
- `replay session` 是运行时唯一真相，当前状态持续更新，后续编辑始终基于最新状态继续推进。
- `working / committed` view 都从当前 session 单向投影，不能反向重建真相。
- 写回源文件前必须保存当前磁盘文件 checkpoint；用户回退只依赖 checkpoint 与 apply record。
- 文档只维护设计边界、核心数据与稳定规则；实现约束、阈值和底层细节以代码为准。

## 2. 关键流程

1. docx 先以 `source` 初始化只读会话。
2. 纯读取场景停留在 `read session`，只做解析、索引、搜索和精读。
3. 进入 create、edit、history 或 rollback 后，升级到 `replay session`。
4. 编辑始终写入当前 session 的最新状态，并生成新的 revision。
5. 当前 session 可以投影出 `working` 和 `committed` 两类视图。
6. run 收尾时从 `committed view` 直接写回源文件，并记录 `DocxApplyRecord`。
7. 用户回退围绕 `DocxApplyRecord` 和 checkpoint 展开，不依赖任务内 revision 重放。

## 3. Source Baseline

### 职责边界

- `source baseline` 是文档运行链路的起点。
- update 模式下，`source` 同时也是最终写回目标。
- create-target 模式下，baseline 可以是空文档快照，最终目标路径只在 apply 时真正落地。

### 规则说明

- `source` 不参与持续编辑中的“当前工作真相”维护。
- committed view 不能重新回退为“以 source 为真相做累计差异重建”。

## 4. Read Session

### 职责边界

- `read session` 负责打开 `source` 后的只读阶段真相。
- 它维护解析结果、块级索引和局部缓存，供 outline、search 和 read 等读取工具复用。
- 它不建立 revision tree 或 apply record。

### 规则说明

- 纯读取路径必须复用同一份解析结果，避免每次精读都重新全文解析。
- 升级到 `replay session` 后，旧的 `read session` 应释放，不同时保留两套运行态缓存。

## 5. Replay Session

### 职责边界

- `replay session` 是 docx 当前会话的唯一运行真相。
- 它维护当前最新状态、revision 链、节点身份、块顺序以及视图 artifact 缓存。
- 所有写工具、history、rollback 和 committed view 生成都围绕它工作。

### 规则说明

- 当前状态必须持续更新，下一轮编辑始终基于 `activeSnapshot` 对应的最新状态继续执行。
- artifact 只是物化缓存，不能反过来成为运行真相来源。
- 结构插入后的节点重绑必须先保留本轮新增块，再去匹配旧节点，避免下游旧块重复或错位。

## 6. Working / Committed Views

### 职责边界

- `working view` 给 AI 读取和继续编辑，只保留当前有效内容。
- `committed view` 给最终写回使用，去除任务内审阅态标记。
- `diff preview artifact` 给系统内 apply 预览使用，保留任务内新增、删除与替换标记，不写回真实源文件。

### 相关数据定义

```ts
interface DocxViewArtifact {
  kind: 'working' | 'review' | 'committed'
  path: string
  createdAt: number
}
```

### 规则说明

视图关系固定为：

```text
DocxReplaySession -> working/committed views -> artifacts
```

- `working artifact` 对应 AI 读取的当前工作态。
- `review artifact` 对应系统内 diff 预览稿，只用于用户查看本次 AI 修改差异。
- `committed artifact` 对应最终写回源文件的正式文档。
- artifact 都只能从当前 session 单向生成。

## 7. Edit / History / Rollback

### 职责边界

- 写工具的内部语义都是“对当前 session 的最新状态继续编辑”。
- `history` 按 revision 暴露过程历史。
- `rollback` 按 revision 恢复当前 session 状态。

### 规则说明

- 每次 edit 成功后都必须形成一个新的 revision。
- `changedBlocks` 必须进入 revision 摘要，供 history、诊断和 apply 记录使用。
- 新增块必须通过 `createdBlocks` 明确记录，而不是仅靠 `blockId` 集合差推断。
- `rollback` 成功后，working 与 committed view 都必须重新对齐当前状态。

## 8. Apply / Checkpoint / Revert

### 职责边界

- apply 负责从 committed view 直接写回源文件。
- checkpoint 负责保存写回前的当前磁盘状态。
- revert 负责根据 apply record 恢复 checkpoint 或删除新建文件。

### 相关数据定义

```ts
interface DocxApplyRecord {
  id: string
  session_id: string
  run_id: string
  status: 'applied' | 'reverted' | 'failed'
  source_path: string
  source_name: string
  operation: 'created' | 'updated'
  final_revision_ref: string
  change_count: number
  before_exists: boolean
  before_snapshot_path?: string
  before_checksum?: string
  preview_diff_artifact_path: string
  preview_diff_checksum: string
  preview_diff_byte_size: number
  after_checksum?: string
  created_at: number
  updated_at: number
  reverted_at?: number
  error?: string
}
```

### 规则说明

- 采用宽松写回模式：apply 前不校验 replay 初始化版本是否仍等于当前磁盘版本。
- apply 前总是以当前磁盘文件作为 checkpoint；若文件不存在则记录 `before_exists=false`。
- apply 同时生成系统内 diff 预览 artifact；diff 预览粒度为一次 AI run 内每个被修改文件一份，不按单次工具调用拆分。
- operation 以实际磁盘行为为准：写回前存在则 `updated`，不存在则 `created`。
- revert 默认校验当前文件 checksum 是否等于 `after_checksum`；若不一致，UI 必须提示继续回退会丢失后续修改。
- 用户确认后允许 force revert；updated 恢复 checkpoint，created 删除文件。

## 9. Tool 与底层执行边界

### 职责边界

- Tool API 层统一定义 docx 工具名、schema 和 AI-facing 能力边界。
- read tools 负责读取当前文档结构、内容、检索结果和任务内历史。
- write tools 对 AI 只暴露 `docx_edit` 与 `docx_rollback`；旧的分散写工具不再作为 AI-facing 能力出现。
- runtime / session 层是 read/write、worker 与 apply/revert 之间的中控层。
- worker 与 OOXML adapter 负责打开、解析、执行和校验底层文档结构。

### 规则说明

- `docx_edit` 通过 `actions[]` 区分写入语义，当前支持 `create_document`、`insert_blocks`、`replace_block`、`replace_text`、`style_text`、`update_table_cell`、`delete_blocks`。
- 每次 `docx_edit` 对同一文件的一组 `actions[]` 作为一次串行编辑脚本执行：tool 开始时先把所有输入 blockId 绑定到稳定 replay locator，执行时按 action 顺序把 locator 解析为当前 worker 可用的 live blockId，全部 action 成功后才注册一次外部 revision。
- `create_document` 必须作为唯一 action；后续图片、批注、脚注、编号、页眉页脚等能力应通过新增 action 或 block 类型扩展。
- `docx_outline`、`docx_search`、`docx_read_blocks` 都应面向“当前最新文档”工作，而不是固定回看 source。
- 写工具结果继续保留 `postWriteReadback.regions` 这类写后复核信息，且该回读只基于全部 action 完成后的最终文档状态生成，供上层判断是否继续编辑或额外读取。
- 每次 `docx_edit` 开始时必须以当前 `activeSnapshot / activeDocId / activeRevisionRef` 绑定整组输入 blockId；输入 id 不在当前 snapshot、已删除或无法唯一绑定到可见 replay node 时直接失败，不猜测目标；不支持在同一次 `actions[]` 内引用本次刚创建且尚未回读的新 blockId。
- `insert_blocks` 插入多条 block 时必须作为一次结构 op 执行，并按输入 `blocks` 顺序落入文档。
- 复杂定位排版 block 属于 read-only 区域，写入失败应走 `hand_docx_positioned_write_blocked`，由 brain/mouth 改为人工修改建议或独立补充稿。

## 10. 不纳入文档维护的实现细节范围

- 读取范围换算、体积阈值、预算比例等实现参数。
- tool family 内部每个工具的逐项行为限制清单。
- OOXML 层的样式继承细节、具体 XML 操作方式和底层校验步骤。
- checkpoint 文件清理策略、临时文件命名和原子替换的具体实现细节。
