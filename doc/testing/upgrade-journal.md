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

## [2026-03-13] ai 架构验收 - human-led delivery 首轮落地

- 时间：2026-03-13 12:14（本地）
- 阶段：ai 架构验收
- 执行命令：
  - `pnpm exec tsc --noEmit -p tsconfig.node.json --composite false`
  - `pnpm exec tsc --noEmit -p tsconfig.web.json --composite false`
  - `pnpm exec vitest --config vitest.ai.config.mts run tests/main/ai/runtime`
  - `pnpm exec vitest --config vitest.renderer.config.mts run tests/renderer/chat/contract`
- 报告路径：
  - `tests/report/main-ai-runtime/prompt-local-first-contract/<latest>/summary.md`
  - `tests/report/main-ai-runtime/runtime-scope-validation/<latest>/summary.md`
  - `tests/report/main-ai-runtime/source-scope-explicit-preserve/<latest>/summary.md`
  - `tests/report/main-ai-runtime/human-result-data-enrichment/<latest>/summary.md`
  - `tests/report/main-ai-runtime/docx-draft-review-ready/<latest>/summary.md`
  - `tests/report/main-ai-runtime/docx-draft-review-conflict/<latest>/summary.md`
  - `tests/report/main-ai-runtime/docx-draft-review-partial-commit/<latest>/summary.md`
- 结果摘要：
  - `main-ai-runtime` 当前 `8/8` 文件、`13/13` 测试通过；新增 `human-led-orchestration` 与 `human.response-delivery` 单测覆盖了 `direct_human`、plan handoff、blocked 后 synthesis、`task_delivery_ready` 与最终答复流来源。
  - `renderer chat contract` 当前 `4/4` 文件、`5/5` 测试通过，说明工作台时间线、检查器、审批/工作区阻塞和 draft review 主链路没有被新的 delivery 模型打断。
  - node/web 双 typecheck 均通过，`main_finalize` 与 `outputText` 的旧收口假设已经从当前实现主链移除。
  - 测试报告契约已补充 `taskDeliveryCount`、`finalDeliverySource`、`deliveryTaskIds`、`deliverySectionCounts`、`synthesisTriggered` 等新观测字段。
- 风险与边界：
  - 新增的 orchestration / response 行为主要通过 Vitest 单测断言，不会像 `runRuntimeCase` 那样自动落完整 case report。
  - 当前 plan 依赖仍是顺序 handoff 链，不是 DAG；复杂依赖图仍属于后续扩展范围。
  - `localSourceStatus` 目前来自 human delivery 阶段的启发式归纳，后续如果要更精细区分“使用了哪些本地来源”，还需要单独增强。
- 推进决策：
  - human-led delivery runtime 可以作为当前 canonical 架构继续推进；后续功能扩展都应基于 `direct_human + task_delivery_ready + synthesis_human` 这组边界。
- 下一轮优先级：
  1. 若继续优化 plan 质量，优先补“更长 handoff 链”和“多资料范围混合”场景。
  2. 若继续扩展 UI，可增加 task delivery 的 markdown diff / section 导航，而不是回退到 JSON 结果展示。
  3. 若未来要上复杂依赖，再评估 DAG/显式 `dependsOn`，但保持 `deliveryMarkdown` 仍是第一真相源。

## [2026-03-12] main context - 首轮 runtime baseline

- 时间：2026-03-12 19:22（本地）
- 阶段：main context
- 执行命令：
  - `pnpm test:main:ai:runtime`
- 报告路径：
  - `tests/report/main-ai-runtime/prompt-local-first-contract/2026-03-12_19:22:12/summary.md`
  - `tests/report/main-ai-runtime/runtime-scope-validation/2026-03-12_19:22:12/summary.md`
  - `tests/report/main-ai-runtime/source-scope-explicit-preserve/2026-03-12_19:22:12/summary.md`
  - `tests/report/main-ai-runtime/runtime-missing-fixture-fail-fast/2026-03-12_19:22:12/summary.md`
  - `tests/report/main-ai-runtime/human-result-data-enrichment/2026-03-12_19:22:12/summary.md`
  - `tests/report/main-ai-runtime/docx-draft-review-ready/2026-03-12_19:22:12/summary.md`
  - `tests/report/main-ai-runtime/docx-draft-review-conflict/2026-03-12_19:22:12/summary.md`
  - `tests/report/main-ai-runtime/docx-draft-review-partial-commit/2026-03-12_19:22:12/summary.md`
- 结果摘要：
  - `main-ai-runtime` 套件首轮基线 `6/6` 文件、`8/8` 测试全部通过，未出现新的 runtime 契约回归。
  - `runtime-scope-validation` 与 `source-scope-explicit-preserve` 继续通过，说明 main graph 的 context / scope 约束在当前代码下保持稳定。
  - `prompt-local-first-contract` 与 `human-result-data-enrichment` 一并通过，说明刚完成的 human 收敛修复没有反向污染 runtime 契约。
  - `runtime-missing-fixture-fail-fast` 继续通过，main context 入口的 fail-fast 门禁没有回退。
  - `docx-draft-review-ready / conflict / partial-commit` 三条提交路径全部通过，当前 main context 相关 docx review 契约稳定。
- 风险与边界：
  - 这轮是 `main context` 的 contract/runtime 首轮基线，不是完整的 `plan 质量` 或端到端架构验收。
  - 当前通过结果主要说明“上下文收集、scope 语义、fail-fast 门禁、docx draft review 契约”没有回归，不代表 main graph 的所有复杂计划路径都已验证。
  - `human` 阶段遗留的 `soft_pass` 长尾仍然存在，但已经被隔离在后续 human compare / 质量优化中，不再阻塞 main context 启动。
- 推进决策：
  - `main context` 阶段现已正式启动且首轮 baseline 通过；下一步可继续在该阶段补充更贴近 main graph 的上下文/阻塞场景，或在无新增风险时进入 `plan 质量` 准备。
- 下一轮优先级：
  1. 盘点 `tests/main/ai/runtime/**` 中是否还缺少 main graph 上下文轮次、scope 降级或阻塞语义的补充 case。
  2. 若近期继续改 human prompt / tool / skill，使用 `p2-default-2026-03-12-baseline-v3` 执行正式 `P3 compare`，避免把 human 回归带进 main context 阶段。
  3. 若 main context 不再暴露新问题，开始整理 `plan 质量` 阶段的输入用例。

### 阶段专题结论（按需）
- 覆盖范围：
  - 当前 `main context` 的默认 runtime 入口已经有一轮完整 green baseline，覆盖 scope、prompt、fail-fast、resultData 保真与 docx review 提交契约。
- 能力边界：
  - 这轮结果能证明 runtime 契约稳定，但还没有直接回答“计划拆解质量是否足够好”，因此不能把它替代 `plan 质量` 阶段。
- 门槛判定：
  - `main context` 已从“未开始”进入“已启动且首轮通过”。
  - 现阶段没有证据表明需要回退到 `human 单任务`；human 后续以 `P3 compare` 作为变更守门即可。

## [2026-03-12] human 单任务 - P3 baseline 就绪轮次（resultData 保真修复）

- 时间：2026-03-12 19:20（本地）
- 阶段：human 单任务
- 执行命令：
  - `pnpm exec vitest --config vitest.ai.config.mts run tests/main/ai/runtime/human.result-data-enrichment.test.ts`
  - `pnpm test:main:ai:human:p2 -- --profile custom --case human-local-kb-answer --runs 5 --batch-id p2-2026-03-12-local-kb-after-resultdata-fix`
  - `pnpm test:main:ai:human:p2 -- --batch-id p2-default-2026-03-12-baseline-v3`
- 报告路径：
  - `tests/report/main-ai-human/batches/p2-2026-03-12-local-kb-after-resultdata-fix/batch-summary.md`
  - `tests/report/main-ai-human/batches/p2-default-2026-03-12-baseline-v3/batch-summary.md`
  - `tests/report/main-ai-human/human-assessment.md`
- 结果摘要：
  - human `complete_task` 新增了基于 `lastObservation` 的 `resultData` 保真补偿：当 local-kb 返回唯一文档引用时，系统会回填或纠正 `document_name/document_id`，避免把 `atlas-notes.md / doc-atlas` 泛化成 `local-knowledge-base`。
  - `human.result-data-enrichment` runtime 回归 `1/1` 通过。
  - `human-local-kb-answer` 定向 batch `5/5` 全部 `hard_pass`，此前的文档名泛化问题未再复现。
  - 新的全量 `p2-default-2026-03-12-baseline-v3` 已完整生成并可复用：四个关键 case 共 `20/20` 成功，`unexpected_block=0`、`harness_fail=0`。
  - baseline-v3 结构如下：
    - `human-docx-edit = 5/5 hard_pass`
    - `human-local-kb-answer = 5/5 hard_pass`
    - `human-multi-skill-kb-then-shell = 5/5`，其中 `hard=3 / soft=2`
    - `human-tool-error-recovery = 5/5`，全部 `soft_pass`
  - latest assessment 当前为：
    - `human-docx-edit = 25/27 = 92.59%`
    - `human-local-kb-answer = 26/27 = 96.30%`
    - `human-multi-skill-kb-then-shell = 21/23 = 91.30%`
    - `human-tool-error-recovery = 12/13 = 92.31%`
    - `historicalSuccessfulRunRate = 91.30%`
    - `latestUnexpectedBlockRate = 0.00%`
- 风险与边界：
  - `human-multi-skill-kb-then-shell` 虽然已经 `5/5` 成功，但仍存在 `soft_pass`，说明多 skill 收敛效率还没有完全硬化。
  - `human-tool-error-recovery` 继续保持成功，但恢复成本仍稳定落在 `soft_pass`；`repeatedToolCalls / recoveryAfterError` 仍是后续质量优化重点，不再构成阶段门槛。
  - `P3 compare` 现在已经具备干净 baseline 输入，但还没有“下一次变更后的 after batch”，因此不能写成“P3 compare 已执行完成”。
- 推进决策：
  - `human 单任务` 当前可视为完成 `P2` 收口并拿到正式 `P3` baseline；允许进入下一阶段测试，同时保留 `p2-default-2026-03-12-baseline-v3` 作为后续 human 变更 compare 的 `before` 输入。
- 下一轮优先级：
  1. 开始 `main context` 阶段测试，优先运行 `pnpm test:main:ai:runtime`，检查上下文收集、scope 语义与阻塞契约。
  2. 下一次对 human prompt / skill / tool / model 再做改动后，执行 `pnpm test:main:ai:human:p3:compare -- --before p2-default-2026-03-12-baseline-v3 --after <newBatchId>`。
  3. 若继续优化 human 质量，优先降低 `human-tool-error-recovery` 与 `human-multi-skill-kb-then-shell` 的 `soft_pass` 占比。

### 阶段专题结论（按需）
- 覆盖范围：
  - `P2` 默认四 case 集合现在已有一份完整、干净、可复用的 baseline。
  - local-kb、docx、多 skill、单次工具失败恢复四类成功路径都已重新在同一 batch 中落盘。
- 能力边界：
  - human 单任务的主要问题已经从“是否能完成任务”收缩为“恢复成本和多 skill 收敛成本是否还要继续优化”。
  - 这意味着当前 human 结果已经足以支撑下一阶段测试，同时也为后续 human 升级保留了稳定的 compare 输入。
- 门槛判定：
  - `P3` 仍然是 human 单任务内部的最后一层验证机制。
  - 截至 2026-03-12 这轮结果，`P3` 的正确表述应是“已具备 compare 前置条件并拿到正式 baseline”，而不是“compare 已执行完成”。

## [2026-03-12] human 单任务 - P3 baseline 预备轮次（prompt 收敛修正）

- 时间：2026-03-12 19:04（本地）
- 阶段：human 单任务
- 执行命令：
  - `pnpm exec vitest --config vitest.ai.config.mts run tests/main/ai/runtime/prompt.local-first-contract.test.ts`
  - `pnpm test:main:ai:human:p2 -- --profile custom --case human-multi-skill-kb-then-shell --runs 5 --batch-id p2-2026-03-12-multi-skill-after-prompt-tune`
  - `pnpm test:main:ai:human:p2 -- --batch-id p2-default-2026-03-12-baseline-v2`
- 报告路径：
  - `tests/report/main-ai-human/batches/p2-2026-03-12-multi-skill-after-prompt-tune/batch-summary.md`
  - `tests/report/main-ai-human/batches/p2-default-2026-03-12-baseline-v2/batch-summary.md`
  - `tests/report/main-ai-human/human-assessment.md`
- 结果摘要：
  - human brain prompt 新增了“拿到 resultData 所需证据后立即 complete_task”与“不要再次确认式重复调用”的约束，同时 recent steps 回看窗口从 `6` 提升到 `10`。
  - prompt 契约回归 `1/1` 通过。
  - `human-multi-skill-kb-then-shell` 定向 batch `5/5` 通过，`unexpected_block=0`；此前的 `bounded_loop_error` 未复现。
  - 新的全量 `p2-default` baseline 仍未生成成功：`human-local-kb-answer` 在第 `4` 轮断言失败，`resultData.document_name` 输出为 `local-knowledge-base`，而不是检索结果中的 `atlas-notes.md` / `doc-atlas`。
  - latest assessment 当前为：
    - `human-docx-edit = 20/22 = 90.91%`
    - `human-local-kb-answer = 16/17 = 94.12%`
    - `human-multi-skill-kb-then-shell = 16/18 = 88.89%`
    - `human-tool-error-recovery = 7/8 = 87.50%`
    - `historicalSuccessfulRunRate = 88.89%`
    - `latestUnexpectedBlockRate = 0.00%`
- 风险与边界：
  - `multi-skill` 的主要问题已经从“步数耗尽导致 unexpected_block”转为“仍有 soft_pass 和长尾时延”，说明 prompt 收敛方向有效，但还没到完全硬通过。
  - `local-kb-answer` 当前暴露的是结构化结果保真问题，不是检索失败：`kb_hybrid_search_chunks` 的事件预览里包含 `document_name=atlas-notes.md / document_id=doc-atlas`，但 human 在 `complete_task` 时仍把 `document_name` 泛化成了 `local-knowledge-base`。
  - `p2-default-2026-03-12-baseline-v2` 的 batch summary 只统计到了成功轮次，未把触发断言失败的那一轮写进 case 汇总；因此这份产物不能作为正式 baseline。
- 推进决策：
  - `human 单任务` 的 `P2` 门槛结论不回退，但 `P3` 仍不能视为正式开始；当前仍处于“生成干净 baseline 前的最后收口”状态。
- 下一轮优先级：
  1. 修复 local-kb 结果在 human observation / complete_task 中的结构化保真，确保 `document_name/document_id` 可稳定写入 `resultData`。
  2. 修复后重新生成新的全量 `p2-default` batch，替代 `p2-default-2026-03-12-baseline-v2`。
  3. 只有在拿到干净 baseline 后，才执行下一次 prompt / skill / tool / model 变更后的 `P3 compare`。

### 阶段专题结论（按需）
- 覆盖范围：
  - `multi-skill` 的单点回归已具备修复前后对照证据。
  - `docx` 与 `local-kb-answer` 在新 prompt 下没有出现新的阻塞路径扩散。
- 能力边界：
  - human 现在更容易在“证据已足够”时收敛，但 `local-kb` 的结构化引用字段仍可能在最后一步被模型泛化。
  - 这意味着当前问题已从“是否能完成”进一步收缩为“完成时的字段精度是否足够稳定支撑 compare baseline”。
- 门槛判定：
  - `P3` 仍是 `human 单任务` 内部评估的最后一层，但当前仓库还没有生成出一份可正式用于 compare 的干净 baseline。
  - 因此当前状态应表述为“`P3-ready` 修复中”，而不是“`P3` 已开始”。

## [2026-03-12] human 单任务 - P2 收口与 recovery 修复

- 时间：2026-03-12 18:46（本地）
- 阶段：human 单任务
- 执行命令：
  - `pnpm exec vitest --config vitest.ai.config.mts run tests/main/ai/capability/terminal.boundary-approval.test.ts`
  - `pnpm test:main:ai:human:p2 -- --profile custom --case human-tool-error-recovery --runs 3 --batch-id p2-2026-03-12-recovery-fix`
- 报告路径：
  - `tests/report/main-ai-human/batches/p2-2026-03-12-recovery-fix/batch-summary.md`
  - `tests/report/main-ai-human/batches/p2-2026-03-12-recovery-fix/batch-summary.json`
  - `tests/report/main-ai-human/human-assessment.md`
- 结果摘要：
  - terminal capability 回归 `3/3` 通过，新增覆盖了 `workspace root cwd alias -> root` 归一化，以及不存在 `cwd` 的 fail-fast。
  - `human-tool-error-recovery` 修复后 batch `3/3 soft_pass`，中位耗时从此前长尾 `~122307ms` 收敛到 `8012ms`。
  - assessment 已更新为：
    - `human-multi-skill-kb-then-shell = 8/9 = 88.89%`
    - `human-tool-error-recovery = 7/8 = 87.50%`
    - `historicalSuccessfulRunRate = 85.48%`
    - `latestUnexpectedBlockRate = 0.00%`
  - `P2` 四个关键成功路径当前都已超过 `80%` 门槛：
    - `human-docx-edit = 83.33%`
    - `human-local-kb-answer = 87.50%`
    - `human-multi-skill-kb-then-shell = 88.89%`
    - `human-tool-error-recovery = 87.50%`
- 风险与边界：
  - `human-tool-error-recovery` 仍然是 `soft_pass` 主导样本，`repeatedToolCallCount / recoveryAfterErrorCount` 仍高，这是注入一次失败后的预期恢复成本，不再是阻塞门槛，但仍值得后续优化。
  - `p2-2026-03-12-followup` 是 batch runner 修复前生成的失败批次，summary 未纳入断言失败那一轮；后续若做正式 compare，不应把它当作基线。
  - 当前结论成立的关键前提是：`terminal_exec` 已把 `cwd=test-workspace` 这类 workspace 根目录别名归一化到真实 root，并对不存在 `cwd` 提前返回 `invalid_input`，不再把路径错误放大成 `shell_unavailable`。
- 推进决策：
  - `human 单任务` 的 `P2` 收敛可以视为完成；后续进入 `P3` 时，应重新生成一份干净的固定 case 集 baseline 再做 compare。
- 下一轮优先级：
  1. 生成一份新的全量 `p2-default` batch，作为 `P3` compare 的正式 baseline。
  2. 在下一次 prompt / skill / tool / model 变更后执行 `pnpm test:main:ai:human:p3:compare -- --before <batchId> --after <batchId>`。
  3. 若继续做质量优化，重点收敛 `human-tool-error-recovery` 的重复调用成本，而不是再扩充覆盖面。

### 阶段专题结论（按需）
- 覆盖范围：
  - `P2` 的四个关键 case 都已有 `5+` 历史样本，且最新 assessment 已不再存在 latest `unexpected_block`。
  - recovery 路径现在同时有 capability 侧回归证据和 human live batch 证据。
- 能力边界：
  - `human` 目前已能稳定完成单任务、多 skill 和一次工具失败后的恢复，但恢复路径仍然倾向于 `soft_pass`，说明“能恢复”不等于“恢复代价低”。
  - 当前不稳定项已从“任务会不会失败”收敛为“恢复效率和长尾时延是否还要继续优化”。
- 门槛判定：
  - `P2` 已完成，不再处于“继续收敛才可推进”的状态。
  - `P3` compare 工具已具备，但需要一份修复后重新生成的干净 baseline，当前还不能把旧失败 batch 直接拿来做正式前后对比。

## [2026-03-12] human 单任务 - P2 稳定性采样轮次

- 时间：2026-03-12 18:12（本地）
- 阶段：human 单任务
- 执行命令：
  - `pnpm test:main:ai:human:p2 -- --runs 5 --batch-id p2-2026-03-12`
  - `node scripts/human-report-analyzer.mjs`
- 报告路径：
  - `tests/report/main-ai-human/batches/p2-2026-03-12/batch-summary.md`
  - `tests/report/main-ai-human/batches/p2-2026-03-12/batch-summary.json`
  - `tests/report/main-ai-human/human-assessment.md`
- 结果摘要：
  - `P2` 采样 batch 已落盘：`human-docx-edit=5/5 hard_pass`，`human-local-kb-answer=4/4 hard_pass`，共 `9/9`
  - `human-docx-edit` 新增 5 轮后，assessment 成功率从 `71.43%` 提升到 `83.33%`
  - `human-local-kb-answer` 新增 4 轮后，assessment 成功率从 `75.00%` 提升到 `87.50%`
  - assessment 总运行从 `42` 增长到 `51`，historicalSuccessfulRunRate 从 `80.95%` 提升到 `84.31%`
  - 采样时延中位数：
    - `human-docx-edit=74367ms`
    - `human-local-kb-answer=112291ms`
- 风险与边界：
  - `human-docx-edit` 与 `human-local-kb-answer` 本轮都稳定通过，但 live 成本明显偏高，单轮峰值分别到 `95315ms / 127097ms`
  - `human-multi-skill-kb-then-shell` assessment 仍是 `3/4 = 75.00%`，还没达到 `P2` 成功路径 `80%` 门槛
  - `human-tool-error-recovery` 仍然只有 `soft_pass`，说明恢复路径虽然可完成，但重复调用/恢复成本尚未收敛
  - `p2-2026-03-12` batch 因 live 长尾在 `human-local-kb-answer` 第 5 轮前被人工中断；当前 batch 是可复用的 `partial_interrupted` 基线，不是完整四 case 批次
- 推进决策：
  - `P2` 已启动并产出首个稳定性采样与可复用 baseline，但 `human 单任务` 阶段仍需留在当前阶段继续收敛
- 下一轮优先级：
  1. 对 `human-multi-skill-kb-then-shell` 补齐 `5-10` 轮批次，确认是否能拉过 `80%` 门槛
  2. 对 `human-tool-error-recovery` 做定向批次，重点看 `soft_pass` 是否能下降、`repeatedToolCallCount` 是否能收敛
  3. 在下一次 prompt/skill/tool/model 变更后，用 `p2-2026-03-12` 作为 `P3` baseline 跑正式 compare

### 阶段专题结论（按需）
- 覆盖范围：
  - `P2` 已经不再停留在文档定义层，当前已有真实 batch 产物和 assessment 增量证据
  - 高风险成功路径里，`docx` 与 `local-kb` 已新增多轮稳定性样本
- 能力边界：
  - 当前主要问题已从“能不能完成任务”转为“高时延下是否还能维持稳定性，以及恢复成本是否过高”
  - `multi-skill` 仍是 `human` 阶段的主不稳定项，当前不能拿 `docx/local-kb` 的改善代替它的门槛判定
- 门槛判定：
  - `P2` 已开始且有实测结果，不能再视为“未开始”
  - `P3` compare 工具和 baseline 都已具备，但还没有第二个变更后 batch，因此 `P3` 仍未正式执行
  - `human 单任务` 当前仍未完成整个 `P2` 收敛
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
