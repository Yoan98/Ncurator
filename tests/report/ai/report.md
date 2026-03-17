# AI Domain Report

当前 AI 测试基线已按新 `plan.md` 重置。

## Current Status

- activeStage: `阶段 1 / tools`
- reportState: `waiting_for_new_logs`
- logsState: `tests/logs/ai/**` 当前没有有效 raw logs
- baselineModel: `primary`
- diagnosticModel: `strong`
- diagnosticRule: `仅在 primary 稳定失败后补跑一次 strong 做分析`

## Next Update Trigger

- Stage 1 的 `tools` 用例按新计划实现完成
- 新 backend raw logs 已产出到 `tests/logs/ai/**`
- 报告基于新 logs 重新生成
