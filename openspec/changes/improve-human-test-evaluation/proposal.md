## Why

当前 `human` 测试套件已经具备基础 live case 与结构化报告能力，但仍主要服务于 smoke 回归，难以稳定回答“当前 human 运行效果如何”“问题集中在哪一层”“是否值得继续优化或升级”。在 `tool capability` 阶段已完成并进入 `human 单任务` 阶段后，需要一套可评估、可比较、可追踪的 human 测试与分析机制，为 prompt、skill card、tool contract 与模型升级提供统一证据。

## What Changes

- 将 `human` 测试从少量 smoke case 扩展为分阶段评估套件，明确 `P0-P3` 覆盖范围、阶段目标与退出标准。
- 为 `human` 用例补充更完整的成功、阻塞、恢复、步数预算与本地证据不足等关键任务类型，优先落地 `P0` 基线诊断用例。
- 扩展 `human` 报告信号与指标，支持区分 `hard_pass`、`soft_pass`、`expected_block`、`unexpected_block`、`harness_fail` 等评估结果。
- 新增 human 评估分析能力，基于 `tests/report/main-ai-human/**` 生成跨 case、跨轮次的 assessment 结论，而不是仅依赖单次 `summary.md` 人工阅读。
- 约束 human 评估批次的执行口径，包括关键 case 多轮运行、稳定性比较、软成功识别与 stale 报告识别。
- 将 human 评估结论纳入测试阶段推进与升级记录，形成后续 prompt/skill/tool/model 优化的统一基线。

## Capabilities

### New Capabilities
- `human-test-assessment`: 对 `main-ai-human` 报告执行跨用例、跨轮次聚合分析，输出质量分级、稳定性结论、主要失败模式与升级建议输入。

### Modified Capabilities
- `human-test-suite`: 扩展 human 测试矩阵、阶段分层、关键 case 类型、质量判定口径与批次执行规则，使其从 smoke 回归升级为评估套件。
- `ai-test-reporting-contract`: 扩展 `human` 报告的结构化信号与指标字段，支持质量分级、恢复行为、重复调用、步数预算占用与评估分析器消费。

## Impact

- 测试用例目录：`tests/main/ai/human/**`
- Main 测试 harness：`tests/harness/main/humanCase.ts`、`tests/harness/main/reporter.ts`、`tests/harness/main/contextFactory.ts`、相关断言与分析脚本
- 报告产物：`tests/report/main-ai-human/**` 与新增 human assessment 汇总文件
- 测试命令与自动化：`package.json` 中 `human` 测试与分析命令
- 文档与阶段记录：`doc/testing/architecture.md`、`doc/testing/phased-plan.md`、`doc/testing/upgrade-journal.md`
- OpenSpec 规格：`openspec/specs/human-test-suite/spec.md`、`openspec/specs/ai-test-reporting-contract/spec.md`，以及新增 `openspec/specs/human-test-assessment/spec.md`
