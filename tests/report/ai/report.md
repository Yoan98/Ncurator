# AI Domain Report

当前 AI 测试基线已按新 `plan.md` 重置，并已完成 Stage 1 `backend/tools` 首轮落地。

## Current Status

- activeStage: `阶段 1 / tools`
- reportState: `stage_1_tools_completed`
- logsState: `tests/logs/ai/backend/tools/**` 已生成 20 条 case 的 raw logs，最新一轮全量运行通过
- baselineModel: `primary`
- diagnosticModel: `strong`
- diagnosticRule: `仅在 primary 稳定失败后补跑一次 strong 做分析`

## Stage 1 Summary

- suite: `ai/backend/tools`
- caseCount: `20`
- latestRun: `2026-03-17`
- result: `20 / 20 passed`
- coverage:
  - `docx`：覆盖结构读取、歧义定位、三种搜索模式、复杂编辑、保存冲突、预览校验回滚、多文档隔离
  - `terminal`：覆盖材料发现、路径解析、批量读取、产物识别、审批分支、拒绝后续、失败与长输出
  - `kb`：覆盖 `hybrid / vector / fts / list_documents` 以及 empty scope / no-result 边界

## Next Update Trigger

- 创建并推进 `Stage 2 / human` 的 `todo-stage-2.md`
- `backend/human` 首批 case 产出新的 raw logs
- 报告进入下一阶段汇总
