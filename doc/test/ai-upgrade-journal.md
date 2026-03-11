# AI 能力测试汇总（持续追加）

本文件是 AI 能力测试的唯一持续汇总入口。  
规则：每次完成一轮 AI 相关测试后，必须在本文件追加一条记录，供后续 AI 继续升级能力时直接读取。

说明：
- 原 `tool capability` 专项文档已并入本文件（2026-03-11）。
- 后续不再维护独立的 `tool capability` 专项文档。

## 1. 使用方式

- 记录顺序：按时间倒序追加（最新在最上方）。
- 记录粒度：一次完整测试执行为一条记录。
- 事实优先：只写可验证结果与证据路径，不写空泛结论。
- 阶段专题结论（能力边界、显式缺口、推进门槛）直接写在对应阶段记录下。

## 2. 记录模板

```md
## [YYYY-MM-DD] <阶段名> - <轮次/标签>

- 时间：YYYY-MM-DD HH:mm（本地时间）
- 阶段：tool capability / human 单任务 / main context / plan 质量 / ai 架构验收
- 执行命令：
  - `...`
  - `...`
- 报告路径：
  - `tests/report/...`
- 结果摘要：
  - 通过：x/y
  - 失败：...
  - 显式缺口：...
- 风险与边界：
  - ...
- 推进决策：
  - 允许进入下一阶段 / 留在当前阶段继续收敛
- 下一轮优先级：
  1. ...
  2. ...

### 阶段专题结论（按需）
- 覆盖范围：...
- 能力边界：...
- 门槛判定：...
```

## 3. 历史记录

## [2026-03-11] tool capability - 基线轮次

- 时间：2026-03-11（本地）
- 阶段：tool capability
- 执行命令：
  - `pnpm test:main:ai:capability`
  - `pnpm test:main:ai:capability:analyze`
- 报告路径：
  - `tests/report/main-ai-capability/tool-capability-assessment.md`
- 结果摘要：
  - 通过：`21/21`
  - 失败：`0`
  - 覆盖矩阵：完整
  - 总体 verdict：`基本可用（建议继续优化）`
  - 显式缺口：`docx_render_preview(format=png/pdf)`（非阻塞）
- 风险与边界：
  - `docx` 的块级重建类操作（`replace_block` / `insert_before` / `insert_after` / `update_table_cell`）仍需谨慎。
  - 批注、脚注/尾注、书签、页眉/页脚内图片等复杂结构缺少充分回归证据。
- 推进决策：
  - 允许进入下一阶段（`human 单任务`）。
- 下一轮优先级：
  1. 验证 `changedBlocks + confirm/rollback/save` 的闭环稳定性。
  2. 补齐复杂 docx 结构回归样例。

### 阶段专题结论（由原 tool capability 专项文档合并）

#### 1) 阶段目的

本阶段只评估工具本身是否具备“值得交给 AI 调用”的基础能力，不评估：
- AI 是否会正确调用 tool
- human 子图是否能完成单任务
- main graph 的 context 收集与 plan 质量
- renderer 的确认交互与回滚交互

#### 2) 本轮覆盖范围

- tool family：
  - `docx`
  - `terminal_exec`
  - `local_kb_retrieval`
- 主门禁命令：
  - `pnpm test:main:ai:capability`
  - `pnpm test:main:ai:capability:analyze`

#### 3) 各能力族结论

- `docx`
  - 已验证：`open / outline / get_block / search(literal|regex|semantic) / apply_ops / get_history / rollback / save / validate`
  - 已验证关键场景：复杂编辑链路、草稿快照链、保存后重开、目标链接文本修改保持链接关系
  - 当前判断：
    - 已具备“复杂文档局部修改且不影响其他区域”的基础证据
    - `replace_text` 可靠性高于块级重建类操作

- `terminal_exec`
  - 已验证：workspace 边界拦截、中高风险审批拒绝、低风险命令执行、失败返回 `failed`、执行事件取证
  - 当前判断：
    - 安全边界与证据链基本可用
    - 下一阶段重点是 runtime/e2e 的审批交互闭环

- `local_kb_retrieval`
  - 已验证：`kb_hybrid_search_chunks / kb_vector_search_chunks / kb_fts_search_chunks / kb_list_documents`
  - 已验证点：scope 过滤、`documentIds` 交集语义、分页边界、空结果可观测、越界短路
  - 当前判断：
    - 工具层能力可进入下一阶段
    - 后续重点转到“上层编排是否正确调用”

#### 4) docx 能力边界

- 较可信：
  - paragraph/table cell 局部文本替换
  - 保存后重开读回正确结果
  - 非目标稳定块不连带修改
  - 图片关系、页眉页脚、超链接、分页符等外围结构保持存在

- 仍高风险：
  - `replace_block`
  - `insert_before`
  - `insert_after`
  - `update_table_cell`

- 尚无充分证据：
  - 批注
  - 脚注/尾注
  - 书签
  - 页眉/页脚内图片
  - 更复杂域、引用、编号交叉结构

#### 5) 显式缺口

- 当前唯一保留：`docx_render_preview(format=png/pdf)`（`invalid_input`，已显式标注）
- 判定：非阻塞项，不阻碍进入下一阶段

#### 6) 已收敛的设计结论

- `docx` 推荐草稿快照模型：
  - `open -> apply_ops(生成新 docId) -> get_history/rollback -> save`
- 用户确认优先级：
  - `changedBlocks + confirm + rollback + save`
  - 不优先追求 `png/pdf preview`

#### 7) 下一阶段门槛核验

建议门槛：
1. `pnpm test:main:ai:capability` 全绿
2. `pnpm test:main:ai:capability:analyze` 结论稳定
3. `explicit_gap` 只剩非阻塞项
4. 目标文档类型有相近结构回归样例

本轮判定：
- 1-3 已满足
- 4 对常见办公文档基本满足；对批注/脚注/书签等复杂结构仍需补强
