# NCurator-Desktop Docx 实现规范

本文收口 docx 子系统的全部实现规范。整体思路见 `/Users/test/work-space/NCurator-Desktop/doc/docx-design/architecture.md`，数据结构与流转见 `/Users/test/work-space/NCurator-Desktop/doc/docx-design/data-definition-and-flow.md`。

## 1. 子系统边界

docx 子系统负责：

- 打开、读取、搜索与精读 docx。
- 在当前最新状态上连续执行多轮编辑。
- 生成 working / review / committed 三视图及其 artifact。
- 维护 revision、history、rollback、review、commit、discard 主链。

## 2. 分层与职责

### 2.1 Tool API 层

- 统一定义 docx 工具名、schema、tool spec 与对 AI 的能力边界。
- 对外暴露的 docx 工具入口固定收口到同一个 tool family。

### 2.2 Read / Write tools 层

- read tools 负责 `outline / search / read / history` 的 AI-facing 语义。
- write tools 负责 `paragraph / heading / table / text / style / rollback` 的 AI-facing 语义。
- 工具层接收 `sourcePath`，但内部语义始终基于当前 session 的最新状态工作。

### 2.3 Runtime / Session 层

- 统一维护 `sourcePath -> DocxReplaySession`。
- 统一维护 `revision`、open target、history、rollback 与 artifact 状态。
- 是 read/write、worker 与 review/commit 之间的中控层。

### 2.4 Worker 层

- 负责 `open / outline / get_block / search / apply_ops / validate`。
- 负责 run 内 doc snapshot 管理与底层 buffer 执行。

### 2.5 OOXML Adapter 层

- 负责 block 建模、outline 构建、详细块读取、底层 op 执行与 docx 校验。
- 负责把 OOXML 结构转成工具层可消费的 block/snapshot 结构。

### 2.6 Review / Commit 层

- 负责 replay tree、三视图投影、review serializer、commit、discard 与 artifact 清理。

## 3. 读取与搜索规范

### 3.1 open

- 首次打开 source 时必须初始化 baseline 与 replay session。
- 存在 active review 时，`resolveDocxOpenTarget` 必须返回当前 `working draft artifact`。
- 对 AI 来说，打开 docx 的结果始终应表现为“当前最新文档”。

### 3.2 outline

- `docx_outline` 返回当前 working draft 的结构概览。
- 必须支持 `fromBodyIndex + maxBlocks` 分页。
- 当结果被截断时，必须显式暴露“结果已截断，文档后续内容未包含”的事实。

### 3.3 search

- `docx_search` 支持 `literal / regex / semantic` 三种模式。
- literal 模式允许有限 alias fallback。
- regex 模式必须对非法表达式稳定报错。
- semantic 模式必须基于当前文档可搜索块的 embedding 结果返回相关块。
- `scopeBlockIds` 只允许在当前文档内进一步缩圈。

### 3.4 read

- `docx_read_blocks` 基于当前 working draft 返回连续 block 区间。
- `fromBlockId / toBlockId` 必须按文档顺序返回闭区间内容。
- 返回内容必须足够支撑 AI 做连续精读，而不是只返回零散片段。

### 3.5 history

- `docx_history` 统一按 `revision` 暴露历史。
- tool result、resourceContext、history 输出与 rollback 输入都不能回退到 `version` 语义。

## 4. 编辑规范

### 4.1 edit 主线

- `docx_*_edit` 的内部语义是“对当前 session 的最新状态继续编辑”。
- 每次 edit 成功后都必须形成一个新的 `revision`。
- edit 结果必须回写 replay session，并更新当前最新状态。

### 4.2 changedBlocks / createdBlocks

- worker 返回的 `changedBlocks` 必须进入 revision 摘要。
- 新增块必须通过 `createdBlocks` 明确记录，并参与 replay session 节点更新。
- 对 `insert_before / insert_after`，`createdBlocks` 必须按插入区间解析，不能依赖前后 `blockId` 集合差。
- 原因是当前 `blockId` 由 `bodyIndex` 派生，结构插入后下游块的 `blockId` 可能整体漂移。

### 4.3 rollback

- rollback 必须按 revision 恢复当前 session 状态。
- rollback 成功后，working / review / committed 三视图都必须重新对齐当前状态。

## 5. replay session 与当前状态规范

- `source baseline` 只用于初始化 session 与最终落盘目标。
- 当前状态必须持续更新，下一轮编辑始终基于最新状态继续执行。
- `DocxReplaySession` 是唯一运行真相。
- `artifact` 只是当前状态的物化缓存，不能反过来成为真相来源。
- `DocxReplayNode` 必须稳定维护节点身份、来源、当前结构、reviewState 与 revision 归属。

## 6. 三视图规范

### 6.1 working draft view

- 给 AI 读取与继续编辑。
- 只保留当前有效内容。
- 不带审阅标记。

### 6.2 review view

- 给用户审阅。
- 必须稳定表达新增、删除与替换。
- 必须直接从当前 session 投影。

### 6.3 committed view

- 给最终提交。
- 去除审阅态。
- 必须是最终落盘的唯一来源。

### 6.4 artifact 关系

- `working artifact` 对应 working draft view。
- `review artifact` 对应 review view。
- `committed artifact` 对应 committed view。
- 三种 artifact 都只能从当前 session 单向生成。

## 7. review / commit / discard 规范

### 7.1 review

- review view 必须直接从当前 session 投影生成。
- 禁止重新以 source 为基线做累计差异重建。
- review artifact 只是 review view 的物化结果。

### 7.2 commit

- commit 必须从 committed artifact 落盘。
- 提交前必须做 freshness 校验。
- 写回源文件时必须使用原子替换。

### 7.3 discard

- discard 只清理 review/working/committed artifact 与 session 状态。
- discard 不得改写 source。

## 8. 样式继承与底层执行约束

### 8.1 paragraph 样式继承

- 插入 paragraph 时，优先继承锚点邻近 paragraph 的正文样式骨架。
- 至少覆盖对齐、缩进、段前段后距、行距与编号信息。
- 结构插入不得重写 anchor 原 XML；`insert_before / insert_after` 只能新增 sibling block，不能把 anchor 与新内容一起重建回写。

### 8.2 run 样式继承

- 插入 run 时，优先继承上下文基础文字样式。
- 至少覆盖字体、字号、中日韩字体与基础强调属性。

### 8.3 table 规则

- table 必须保持稳定布局规则。
- 至少稳定维护 `tblLayout / tblGrid / tcW`。
- cell 内 paragraph 也必须遵循同样的上下文样式继承。

### 8.4 review 样式叠加

- review 标记只作为显示层叠加。
- 不能破坏正文样式骨架、段落结构、表格布局与块顺序。
- replay 在处理结构插入时，旧节点重绑必须避开当前 revision 的 `createdBlocks`，避免把新插入块重新绑定成旧节点。
