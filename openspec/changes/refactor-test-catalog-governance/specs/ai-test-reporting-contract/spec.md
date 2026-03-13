## ADDED Requirements

### Requirement: 报告契约 MUST 与 case catalog 稳定关联且不得定义当前 case inventory
测试报告契约 MUST 继续为每次执行输出历史证据目录，但报告目录本身 MUST NOT 被解释为“当前测试全集”；所有报告消费方 MUST 先读取 case catalog，再通过 `suite`、`caseId` 与 latest report 关联字段定位对应报告。

#### Scenario: 读取 active case 的最新报告
- **WHEN** AI 或分析脚本需要读取某个当前 case 的最新执行结果
- **THEN** 系统 MUST 先通过 catalog 确认该 case 的当前状态，再定位 latest report，而不是直接扫描报告目录猜测 case 是否仍然有效

#### Scenario: 报告目录中存在 stale case
- **WHEN** `tests/report/**` 中保留了已废弃或已重命名 case 的历史目录
- **THEN** 系统 MUST 将这些目录视为历史证据，而不是自动纳入当前 case inventory

### Requirement: 报告分析器 MUST 基于 catalog 推断 suite 的当前 case 集
任何对测试报告做聚合、对比、批次分析或摘要生成的脚本 MUST 基于 catalog 判定当前 suite 的 case 集，而不是通过扫描报告目录或汇总文件自行推断。

#### Scenario: 运行 human assessment 分析
- **WHEN** 系统为 `main-ai-human` 生成 assessment 或 batch summary
- **THEN** 分析器 MUST 以 catalog 中当前有效的人类测试 case 集作为输入边界

#### Scenario: 生成 capability 或 UI suite 摘要
- **WHEN** 系统对 capability、renderer 或 e2e suite 生成聚合视图
- **THEN** 聚合逻辑 MUST 过滤掉 catalog 中不存在或已标记为非 active 的历史报告目录
