## Why

当前 AI runtime 已经偏离了“human 独立完成任务并负责交付”的原始设计：`main` 仍通过 finalization 生成最终答复，单任务请求也缺少 direct human 路径，plan 子任务之间只能依赖薄弱的 `summary/resultData` 收敛。现在需要把 runtime 重构回更清晰的边界，让 `main` 专注编排，让 `human` 负责任务交付、自然语言交接与最终输出，从而为后续扩展性、流式答复和复杂 plan 收口打下稳定基础。

## What Changes

- **BREAKING** 移除 `main_finalize` 的自然语言生成职责，删除 `direct_finalize` 路径，改为 `direct_human` 与 `synthesis_human` 两种由 human 生成最终答复的收口方式。
- 新增 human delivery 模型：human 在任务完成或阻塞后统一生成正式交付，交付物由简短 `summary` 与完整 `deliveryMarkdown` 组成。
- 新增 plan 子任务的 markdown handoff 链：每个子任务输出自然语言交接文档，后续任务通过 objective 吸收前序 handoff，plan 结束后由独立 synthesis human 汇总最终答复。
- 调整事件流、聊天执行 UI 和测试契约，使其能够表达 task delivery、direct human 流式答复和 synthesis human 总结路径。
- 重写 AI canonical 文档与架构图，并同步更新 AGENTS 与 AI architecture skill，不保留旧 finalize 语义的兼容说明。

## Capabilities

### New Capabilities
- `ai-task-delivery-handoff`: 定义 human 任务交付物、markdown handoff 软协议、plan synthesis human 汇总交付与自然语言依赖传递语义。

### Modified Capabilities
- `ai-runner`: main graph 的职责改为纯编排；新增 `direct_human` 与 `main_synthesis_human`，移除由 main finalization 统一生成最终答复的要求。
- `ai-human-task-runner`: human 子图新增 response/delivery 节点，任务输出从 `summary/resultCode/resultData` 扩展为以 `deliveryMarkdown` 为核心的正式交付。
- `ai-run-event-stream`: 最终答复流不再限定来自 finalization；事件流需表达 direct human、synthesis human 和 task delivery ready 的可回放语义。
- `chat-execution-ui`: 聊天执行界面需要支持 direct human 无 plan 运行、plan 任务交付查看、synthesis 总结答复和新的交接检查器。
- `ai-test-reporting-contract`: 测试报告需要覆盖 deliveryMarkdown、task delivery 事件、direct human 答复路径与 synthesis human 收口路径。
- `ai-architecture-reference-doc`: canonical AI 文档、默认阅读入口、AGENTS 与 AI architecture skill 需要重写为 human-led delivery 架构，并补充新的架构图。

## Impact

- AI runtime：`src/main/services/ai/graph/*`、`src/main/services/ai/node/main/*`、`src/main/services/ai/node/human/*`、`src/main/services/ai/prompts/*`、`src/main/services/ai/types.ts`
- 共享契约与事件：`src/shared/types.ts`、IPC 运行事件发送与流式答复逻辑
- Renderer：聊天执行时间线、右侧检查器、assistant run 卡片与最终答复渲染
- 测试：`tests/main/ai/runtime/**`、`tests/main/ai/human/**` 以及相关报告分析契约
- 文档与规则：`doc/architecture/ai/**`、`AGENTS.md`、`.codex/skills/ai-architecture/SKILL.md`
