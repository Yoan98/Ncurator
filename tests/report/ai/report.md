# AI 域测试报告

## 总览

- raw logs 范围：当前仓库内 `tests/logs/ai/**`
- 本次纳入分析的 suite：`tool`、`human`
- 当前未纳入分析的范围：`human/live`

### 总体结论

- 当前正式 AI 基线已经收敛到 `tool + human` 两类 suite。
- `tool` 继续提供 docx、kb、terminal、hand 的稳定底座。
- `human/mock-llm` 继续作为 human-only runtime 的正式回归基线。

## tool

- 当前 `tool` suite 仍作为 AI 域稳定正式基线。
- 后续继续围绕真实工具、真实 artifact、真实审批边界维护。

## human

- 当前 `human/mock-llm` 是 AI 主链的正式回归入口。
- 后续优先补充和维护 `AiRunService -> human` 直达入口 case 与 `human/live` 复杂任务 case。
