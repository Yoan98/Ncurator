# Tool Capability 阶段评估

入口说明：
- 默认先读 `doc/test/README.md`
- 当前文档只负责 `tool capability` 阶段结论

更新时间：2026-03-11

## 1. 目的

本阶段只评估 `tool capability`，不评估：

- AI 是否会正确调用 tool
- human 子图是否能完成单任务
- main graph 的 context 收集与 plan 质量
- renderer 的确认交互与回滚交互

本阶段只回答一个问题：

> 这些工具本身，是否已经具备“值得交给 AI 调用”的基础能力。

## 2. 当前范围

当前纳入门禁的 tool family：

- `docx`
- `terminal_exec`
- `local_kb_retrieval`

主门禁命令：

```bash
pnpm test:main:ai:capability
pnpm test:main:ai:capability:analyze
```

最新结构化结论输出：

- 报告汇总：[tool-capability-assessment.md](/Users/test/work-space/NCurator-Desktop/tests/report/main-ai-capability/tool-capability-assessment.md)

## 3. 当前结论

截至 2026-03-11，本阶段结论为：

- `21 / 21` capability case 通过
- 覆盖矩阵完整
- 总体 verdict：`基本可用（建议继续优化）`

结论解释：

- “基本可用”表示：工具已经具备进入下一阶段验证的基础能力，不再停留在“只能跑简单 demo”的状态。
- “建议继续优化”表示：能力边界已经被测出来，但仍有显式缺口和高风险边界，不适合把所有复杂任务默认交给 AI 自动落盘。

## 4. 各能力族状态

### 4.1 docx

当前已验证能力：

- `docx_open`
- `docx_outline`
- `docx_get_block`
- `docx_search`
  - `literal`
  - `regex`
  - `semantic`（按 `docId` 快照做 block 级惰性索引与缓存复用）
- `docx_apply_ops`
- `docx_get_history`
- `docx_rollback`
- `docx_save`
- `docx_validate`

当前已验证的关键场景：

- 复杂编辑链路：
  - `open -> outline -> get_block -> apply_ops -> search -> save -> validate`
- 局部文本替换：
  - `replace_text` 尽量原位替换文本节点，保留目标 run 样式
- 结构型编辑：
  - `replace_block`
  - `insert_before`
  - `insert_after`
  - `update_table_cell`
  - `delete_block`
- 草稿快照链：
  - `apply_ops` 先生成新 `docId`
  - `get_history` 可查看祖先链
  - `rollback` 可回到祖先快照
  - `save` 才是真正落盘动作
- 大文档混合场景：
  - 编号列表
  - styled runs
  - 表格
  - 图片关系
  - 页眉页脚
  - 外部链接
  - 分页符
- 保存后重开回归：
  - 保存后的 `.docx` 可再次 `open`
  - 重开后目标编辑结果仍正确
  - 非目标稳定块不变
- 目标段落带链接结构：
  - 修改链接内部文本后，链接关系不丢
  - 同时修复了超链接文本在 `outline/search/get_block` 中可见性不足的问题

当前判断：

- `docx` 已经不只是“能改点文字”。
- 对“较复杂文档中的局部修改，不影响其他地方”已经有较强证据支持。
- 当前最可靠的编辑能力是 `replace_text`。
- 当前仍需谨慎对待的能力是目标块级重建类操作。

### 4.2 terminal_exec

当前已验证能力：

- workspace 边界拦截
- 中高风险审批拒绝
- 低风险命令执行
- 失败命令返回 `failed`
- `terminal_step_*` 事件取证
- 文件产物事件取证

当前判断：

- `terminal_exec` 的安全边界和执行证据链已经基本可用。
- 可以进入下一阶段，但仍应继续通过 runtime/e2e 验证审批交互是否稳定闭环。

### 4.3 local_kb_retrieval

当前已验证能力：

- `kb_hybrid_search_chunks`
- `kb_vector_search_chunks`
- `kb_fts_search_chunks`
- `kb_list_documents`

当前已验证点：

- run scope 过滤
- `documentIds` 与 scope 的交集语义
- `sourceType` 透传
- `limit/page/pageSize` 边界
- 空结果可观测
- 完全越界短路

当前判断：

- retrieval family 已具备进入 human/main 阶段验证的基础。
- 后续主要关注的是“被上层编排正确使用”，而不是工具本身能否搜索。

## 5. docx 的真实边界

当前 `docx` 并不是“100% 无损 Word 编辑器”。

需要明确的边界：

### 5.1 已经比较可信的部分

- 在目标 paragraph / table cell 中做局部文本替换
- 保存后重开仍能读回正确结果
- 未命中的稳定 paragraph / table cell 不被连带修改
- 图片关系、页眉页脚、超链接、分页符等外围结构在局部正文修改后仍保持存在

### 5.2 仍然高风险的部分

- `replace_block`
- `insert_before`
- `insert_after`
- `update_table_cell`

原因：

- 这些操作本质上是目标块级重建，不是 run 级原位修改。
- 它们更容易影响目标块内部的复杂 OOXML 细节。

### 5.3 当前尚未形成证据的结构

- 批注
- 脚注 / 尾注
- 书签
- 页眉/页脚内图片
- 更复杂的域、引用、编号交叉结构

这几类结构在真实办公文档里经常出现，但当前阶段还没有回归证据，不能默认视为安全。

## 6. 显式缺口

当前唯一保留的显式缺口：

- `docx_render_preview(format=png/pdf)`

现状：

- 该能力在 tool 层仍返回 `invalid_input`
- 已通过 `explicit_gap` case 显式标注

当前建议：

- 不把它作为进入下一阶段的阻塞项
- 右侧面板文档查看仍应优先依赖现有 renderer docx render 方案
- 若后续需要“静态快照证据 / 导出 PNG 或 PDF / 视觉回归”，再单独提升优先级

## 7. 已收敛的关键设计结论

### 7.1 docx 编辑应采用草稿快照模型

推荐模型：

- `open` 得到原始 `docId`
- `apply_ops` 只生成新草稿 `docId`
- `save` 才允许真正写文件
- `rollback` 用于回退草稿快照

这比“每一步直接覆盖原文件”更适合 AI 协作场景。

### 7.2 用户确认重点不应只是“打开文件看一眼”

更重要的是：

- 看到改了哪些 block
- 看到每块前后差异
- 决定接受、回滚还是放弃

所以后续 renderer/main 阶段的重点应是：

- `changedBlocks`
- `confirm`
- `rollback`
- `save`

而不是优先去做额外的 `png/pdf preview`

## 8. 进入下一阶段的建议门槛

建议满足以下条件后，再进入 `human 单任务` 阶段：

1. `pnpm test:main:ai:capability` 全绿
2. `pnpm test:main:ai:capability:analyze` 结论稳定
3. `explicit_gap` 只剩非阻塞项
4. 对当前要试运行的文档类型，至少已有一条相近结构的回归用例

当前状态：

- 上述 1-3 已满足
- 第 4 条对常见办公文档已基本满足，但对批注/脚注/书签等复杂结构尚未满足

## 9. 下一步优先级

### P0

- 无

### P1

- renderer / main 侧补 `changedBlocks + confirm/rollback/save` 交互闭环
- 补更复杂 docx 结构回归：
  - 批注
  - 脚注 / 尾注
  - 书签
  - 页眉/页脚内图片

### P2

- `docx_render_preview(format=png/pdf)` 在需要静态快照证据时再实现

## 10. 文档使用方式

建议把本文件作为阶段决策文档使用：

- 进入下一阶段前，先看本文件确认 tool 是否达标
- 若 capability 回归失败，先更新这里的“边界”和“结论”，再决定是否进入后续阶段
- 后续若新增高风险 docx 结构测试，应同步补充第 5 节与第 9 节
