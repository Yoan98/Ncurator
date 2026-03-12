# human-test-assessment Specification

## Purpose
Define the human assessment analyzer contract for aggregating `main-ai-human` reports into upgrade-facing conclusions.

## Requirements
### Requirement: Human 评估分析 MUST 聚合 main-ai-human 报告并输出统一 assessment
系统 MUST 基于 `tests/report/main-ai-human/**` 下的结构化报告聚合生成 human assessment 结果，对当前 human 套件的成功路径、阻塞路径、恢复路径、质量分级与稳定性进行统一总结；assessment 输出 MUST 可被人工阅读并作为后续升级记录输入。

#### Scenario: 生成 human assessment
- **WHEN** 开发者执行 human 评估分析
- **THEN** 系统 MUST 读取 `main-ai-human` 报告目录中的结构化产物，并输出覆盖 case 总览、运行总览、质量分级与主要失败模式的 assessment 文件

### Requirement: Human 评估分析 MUST 区分质量等级与阻塞语义
human assessment MUST 按统一规则区分 `hard_pass`、`soft_pass`、`expected_block`、`unexpected_block` 与 `harness_fail`，且 MUST 将预期阻塞、意外阻塞与未启动运行分开统计，避免不同问题类型混在同一结论中。

#### Scenario: 统计软成功与预期阻塞
- **WHEN** 一批 human 报告同时包含成功但绕路的运行与预期阻塞的运行
- **THEN** assessment MUST 分别统计 `soft_pass` 与 `expected_block`，而不是仅给出笼统通过率

#### Scenario: 识别 harness_fail
- **WHEN** 某轮 human 运行因缺失 live 配置或 fixture 而未启动
- **THEN** assessment MUST 将该运行标记为 `harness_fail`，并从能力效果结论中单独隔离

### Requirement: Human 评估分析 MUST 提供稳定性与效率结论
human assessment MUST 统计关键 case 的多轮稳定性、耗时、步数、工具错误率、恢复率与重复调用率，并 MUST 能识别对升级决策有影响的高频失败模式、软成功模式与异常波动。

#### Scenario: 关键 case 多轮运行后生成稳定性结论
- **WHEN** 开发者对关键 human case 进行多轮执行
- **THEN** assessment MUST 输出这些 case 的通过率、软成功比例、阻塞语义正确率以及与耗时、步数相关的稳定性结论

#### Scenario: 高频重复调用被识别为效率问题
- **WHEN** 多轮报告显示同一 human 任务频繁重复相同工具调用或在错误后多次绕路
- **THEN** assessment MUST 将其识别为效率或决策质量问题，并在结论中突出该模式

### Requirement: Human 评估分析 MUST 识别 stale 报告与当前用例集合偏差
human assessment MUST 能识别当前 human 用例集合之外的历史报告目录，并将其标记为 stale evidence，避免过期 case 混入当前评估结论；assessment 同时 MUST 明确哪些结论基于当前用例集合，哪些仅为历史参考。

#### Scenario: 历史报告目录残留
- **WHEN** 报告目录中存在当前 `tests/main/ai/human/**` 已不再定义的旧 case
- **THEN** assessment MUST 将这些目录识别为 stale 报告，并避免将其计入当前 case 覆盖与质量汇总
