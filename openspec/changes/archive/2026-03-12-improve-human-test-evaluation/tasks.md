## 1. P0 基线评估用例

- [x] 1.1 升级现有 `human-read-workspace-file` 用例断言，补充 `resultData`、步骤上限与软成功识别所需校验
- [x] 1.2 升级现有 `human-docx-edit` 用例断言，补充输出路径、工具错误恢复与质量分级输入校验
- [x] 1.3 升级现有 `human-approval-denied-block` 用例断言，补充审批拒绝后不再继续执行的校验
- [x] 1.4 新增 `human-step-budget-exhausted-block` 用例，验证步数预算耗尽时以 `bounded_loop_error` 阻塞收敛
- [x] 1.5 新增 `human-nonexistent-file-block` 用例，验证读取不存在文件时不会伪造成功结果
- [x] 1.6 新增 `human-local-evidence-insufficient-block` 用例，验证本地证据不足时阻塞而非猜测完成
- [x] 1.7 复核 `human-missing-live-config-fail-fast` 用例与报告断言，确保其只作为 `harness_fail` 门禁

## 2. Human 报告契约扩展

- [x] 2.1 扩展 `runHumanCase` 输入与落盘数据，补充 `taskGoal`、`maxSteps`、`approvalPolicy` 与模型标识
- [x] 2.2 扩展 `metrics.json` 生成功能，增加 `toolErrorCount`、`recoveryAfterErrorCount`、`repeatedToolCallCount` 与 `stepBudgetUsage`
- [x] 2.3 扩展 `signals.json` 生成功能，增加 `resultDataKeys`、`firstFailureStage` 与评估分析所需的 human 专用信号
- [x] 2.4 为 `main-ai-human` 报告增加质量分级所需的基础派生字段，并保持现有标准文件集合与向后兼容
- [x] 2.5 更新 human 报告读取与断言辅助工具，确保新增字段可被测试与后续 analyzer 使用

## 3. Human Assessment 分析能力

- [x] 3.1 新增 human assessment 脚本，基于当前 `tests/main/ai/human/**` 解析当前 case 集
- [x] 3.2 在 analyzer 中聚合 `tests/report/main-ai-human/**` 的 latest run 与历史 run，输出按 case 的质量与稳定性统计
- [x] 3.3 在 analyzer 中实现 `hard_pass`、`soft_pass`、`expected_block`、`unexpected_block`、`harness_fail` 的判定规则
- [x] 3.4 在 analyzer 中实现 stale 报告识别，避免历史旧 case 混入当前覆盖结论
- [x] 3.5 输出 `tests/report/main-ai-human/human-assessment.md`，包含总览、主要失败模式、效率问题与升级决策输入
- [x] 3.6 为 `package.json` 增加 human assessment 执行命令，并验证与现有 `human` suite 命令协同工作

## 4. P1 Harness 扩展与覆盖补齐

- [x] 4.1 为 human 测试 context 增加可注入 `documentsStore` fixture 的能力，支撑 `local-kb` 正向/空结果场景
- [x] 4.2 为 human 测试 context 增加可关闭 workspace 绑定的模式，支撑 `workspace_required` 阻塞用例
- [x] 4.3 为 human 测试 harness 增加一次性工具失败注入能力，支撑恢复能力评估
- [x] 4.4 新增 `human-local-kb-answer` 与 `human-local-kb-empty-result-block` 用例，补齐 `local-kb-retrieval` 覆盖
- [x] 4.5 新增 `human-workspace-missing-block`、`human-multi-skill-kb-then-shell` 与 `human-tool-error-recovery` 用例，补齐 workspace、多 skill 与恢复覆盖

## 5. 文档、阶段记录与回归

- [x] 5.1 更新 `doc/testing/architecture.md`，补充 human 评估分层、报告字段与 assessment 产物说明
- [x] 5.2 更新 `doc/testing/phased-plan.md`，明确 `human 单任务` 阶段的评估批次与推进门槛
- [x] 5.3 在完成首轮 `P0` 评估后更新 `doc/testing/upgrade-journal.md`，记录 human assessment 结论与下一轮优先级
- [x] 5.4 执行 `pnpm test:main:ai:human` 与新增 human assessment 命令，校验 P0 基线报告与 assessment 落盘结果
- [x] 5.5 对关键 P0 case 执行多轮评估批次并复核 analyzer 输出，确认稳定性、软成功与阻塞语义统计正确
