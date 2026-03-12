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

## [2026-03-12] human 单任务 - P1 覆盖扩展轮次

- 时间：2026-03-12 17:38（本地）
- 阶段：human 单任务
- 执行命令：
  - `pnpm exec vitest --config vitest.ai.config.mts run tests/main/ai/human/human.local-kb-answer.live.test.ts tests/main/ai/human/human.local-kb-empty-result.live.test.ts tests/main/ai/human/human.workspace-missing.live.test.ts tests/main/ai/human/human.multi-skill-kb-then-shell.live.test.ts tests/main/ai/human/human.tool-error-recovery.live.test.ts`
  - `pnpm test:main:ai:human`
  - `pnpm exec vitest --config vitest.ai.config.mts run tests/main/ai/human/human.workspace-missing.live.test.ts`
  - `pnpm test:main:ai:human:analyze`
- 报告路径：
  - `tests/report/main-ai-human/**`
  - `tests/report/main-ai-human/human-assessment.md`
- 结果摘要：
  - 当前 human 用例：`12`
  - assessment 总运行：`42`
  - latest quality：`hard_pass=4`、`soft_pass=1`、`expected_block=6`、`harness_fail=1`
  - 新增覆盖：
    - `local-kb-retrieval`：`human-local-kb-answer`、`human-local-kb-empty-result-block`
    - `workspace_required`：`human-workspace-missing-block`
    - 多 skill：`human-multi-skill-kb-then-shell`
    - 恢复能力：`human-tool-error-recovery`
- 风险与边界：
  - `human-docx-edit`、`human-local-kb-answer`、`human-multi-skill-kb-then-shell` 历史成功率仍未到完全稳定，assessment 里分别是 `71.43% / 75.00% / 75.00%`。
  - `human-tool-error-recovery` 已能稳定完成，但始终属于 `soft_pass`，说明恢复路径成本仍偏高。
  - 全量 `pnpm test:main:ai:human` 中 `human-workspace-missing-block` 出现过一次 `240s` 超时；同日单独重跑通过，当前更像 live 模型长尾而非用例语义错误。
- 推进决策：
  - 允许把 `human 单任务` 阶段推进到“P1 覆盖已具备，后续重点转稳定性与升级验证”。
- 下一轮优先级：
  1. 对 `human-docx-edit`、`human-local-kb-answer`、`human-multi-skill-kb-then-shell` 做更系统的 `5-10` 轮批次，确认波动来源。
  2. 收敛 retrieval 结果在 human 中的结构化消费，减少 `kb_*` 文本证据 fallback。
  3. 清理 stale 报告目录，避免历史旧 case 干扰结论阅读。

### 阶段专题结论（按需）
- 覆盖范围：
  - 三个 skill 都已有正向或阻塞证据。
  - workspace 缺失、多 skill 协作、单次工具失败恢复均已有 live 报告。
- 能力边界：
  - local-kb 在 human 中可用，但对检索结果的结构化消费仍不够稳，当前部分依赖文本证据 fallback。
  - multi-skill 已可完成 `KB -> shell` 协作，但复杂任务仍存在历史 `unexpected_block` 记录。
- 门槛判定：
  - `P1` 覆盖已完成。
  - 下一阶段重点不再是“有没有 case”，而是“关键 case 的稳定性是否足够支撑升级决策”。

## [2026-03-12] human 单任务 - P0 基线评估轮次

- 时间：2026-03-12 17:09（本地）
- 阶段：human 单任务
- 执行命令：
  - `pnpm test:main:ai:human`
  - `pnpm exec vitest --config vitest.ai.config.mts run tests/main/ai/human/human.read-workspace-file.live.test.ts tests/main/ai/human/human.approval-denied.live.test.ts tests/main/ai/human/human.docx-edit.live.test.ts`
  - `pnpm test:main:ai:human:analyze`
- 报告路径：
  - `tests/report/main-ai-human/**`
  - `tests/report/main-ai-human/human-assessment.md`
- 结果摘要：
  - P0 基线用例：`7/7`
  - assessment 当前用例：`7`
  - assessment 总运行：`21`
  - latest quality：`hard_pass=2`、`expected_block=4`、`harness_fail=1`
  - 关键 case 稳定性：`human-read-workspace-file=3/3`、`human-approval-denied-block=3/3`、`human-docx-edit=4/6`
- 风险与边界：
  - `human-docx-edit` 已从阻塞恢复为可完成，但仍存在 `soft_pass` 与历史 `unexpected_block`，主要表现为 `docx_save` 参数纠错和额外 `get_history` 绕路。
  - `human-missing-live-config-fail-fast` 属于 `harness_fail` 门禁，不纳入能力效果判断。
  - assessment 识别到 stale 报告目录：`human-brain-mock-decision-regression`、`human-missing-config-fail-fast`、`human-missing-fixture-fail-fast`。
- 推进决策：
  - 允许将 `human 单任务` 阶段视为已具备 P0 基线评估能力，但仍需留在当前阶段继续补齐 P1 覆盖与 docx 稳定性收敛。
- 下一轮优先级：
  1. 为 `local-kb-retrieval` 补齐可注入 `documentsStore` 的 harness，并新增正向/空结果 case。
  2. 为 workspace 缺失与一次性工具失败注入补充 harness 能力，覆盖多 skill 与恢复路径。
  3. 继续对 `human-docx-edit` 做多轮评估，确认 `docx_save(outPath)` 路径是否稳定。

### 阶段专题结论（按需）
- 覆盖范围：
  - 单 skill 成功：workspace-shell、docx
  - 负路径阻塞：approval denied、nonexistent file、local evidence insufficient、step budget exhausted
  - 环境门禁：missing live config
- 能力边界：
  - `workspace-shell` 成功与阻塞语义已稳定。
  - `docx-editing` 需要显式暴露 `docx_save` 且在 skill card 中强调 `outPath` 参数，否则 human 会因保存参数漂移而出现软成功或意外阻塞。
- 门槛判定：
  - P0 成功路径与阻塞路径均已形成结构化报告和 assessment。
  - 当前更像“可以继续扩大覆盖”，而不是“可以结束 human 阶段”。

## [2026-03-12] unified workbench + draft review - 确认提交流程回归轮次

- 时间：2026-03-12 13:49（本地）
- 阶段：main context / ai 架构验收 / renderer contract / deterministic e2e
- 执行命令：
  - `pnpm typecheck`
  - `pnpm test:renderer`
  - `pnpm exec vitest --config vitest.ai.config.mts run tests/main/ai/runtime/docx.draft-review-commit.test.ts`
  - `pnpm exec electron-vite build`
  - `pnpm exec vitest --config vitest.e2e.config.mts run tests/e2e/**/deterministic`
- 报告路径：
  - `tests/report/main-ai-runtime/docx-draft-review-ready/**`
  - `tests/report/main-ai-runtime/docx-draft-review-partial-commit/**`
  - `tests/report/main-ai-runtime/docx-draft-review-conflict/**`
  - `tests/report/renderer-chat-contract/**`
  - `tests/report/e2e-chat/**`
  - `tests/report/e2e-search/**`
  - `tests/report/e2e-import/**`
- 结果摘要：
  - 类型检查：`通过`
  - Renderer contract：`7/7`
  - Main runtime：`3/3`
  - Deterministic E2E：`8/8`
  - 显式缺口：`renderer 侧仍存在 AntD message / React act warning，需要后续清理`
- 风险与边界：
  - deterministic e2e 若并发运行会出现 Electron 首窗争抢，当前已通过 `fileParallelism: false` 收敛
  - 当前完整提交流程只对 `docx` 落地；`md/txt/xlsx/pptx/pdf` 仍停留在适配器接口层
- 推进决策：
  - 允许把统一工作台与草稿审阅提交流程视为已通过当前阶段门禁
- 下一轮优先级：
  1. 清理 renderer 测试中的 AntD 静态 message 与 React 19 `act(...)` 警告
  2. 为非 `docx` 格式逐个补充首个审阅/提交能力与对应 deterministic e2e

### 阶段专题结论（按需）
- 覆盖范围：
  - 统一工作台 `AI 对话 / 纯搜索`
  - 右侧时间线与检查器
  - docx 草稿快照链、统一审阅、部分接受后提交、冲突阻止提交、提交后草稿清理
- 能力边界：
  - 运行中不逐块确认、后续读取默认基于最新草稿快照、最终提交前校验源文件新鲜度
- 门槛判定：
  - 当前 change 的关键行为已具备 main / renderer / e2e 三层证据
  - 可进入后续格式扩展或归档前验证阶段

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
