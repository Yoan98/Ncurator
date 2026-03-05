## Why

当前项目缺少可复用的自动化测试架构，`docx/terminal/kb/human` 的验证主要依赖临时操作，导致结果不可复盘、不可比较，也无法稳定支撑后续让 AI 基于测试输出给出优化建议。随着能力工具化和 human 子图稳定落地，需要尽快建立一套脚本优先、直接调用生产代码的测试体系。

## What Changes

- 新增脚本式测试框架（基于 Vitest + Main 测试 harness），用于在非 E2E 场景下运行 AI 能力测试。
- 新增 capability tool 级测试机制：按“一个 tool 一个用例”组织，统一 `setup -> run -> assert` 结构。
- 新增 human live 测试机制：直接运行 human graph（不经 main graph），使用真实 LLM 配置执行任务并评估“渐进式解决问题”能力。
- 新增 fixture 前置规范：明确测试前必须将 docx 与工作区输入文件放入指定目录，测试脚本按约定路径装载。
- 新增统一测试输出契约：沉淀结构化事件流、断言结果、指标与总结，供后续 AI 自动分析并提出修改建议。
- 明确测试必须调用生产入口（如 capability tools 与 human runner），禁止在测试中复刻业务逻辑。

## Capabilities

### New Capabilities

- `capability-tool-test-suite`: 定义 tool 级脚本测试能力，覆盖 docx/terminal/kb 等能力工具的前置条件、执行步骤、断言与复用机制。
- `human-live-test-suite`: 定义 human 子图真实运行测试能力，覆盖真实模型调用、任务完成质量与渐进式决策行为评估。
- `ai-test-reporting-contract`: 定义统一测试报告与结果归档契约，支持 AI 基于输出进行问题归因和优化建议生成。

### Modified Capabilities

- （无）

## Impact

- 影响代码范围：测试工程目录、测试运行脚本、测试配置、以及少量用于注入测试上下文的适配层。
- 影响系统边界：新增测试专用 workspace/fixture/report 目录约定，不改变生产运行时主链路行为。
- 依赖与工具：引入并规范化 Vitest 测试执行入口与报告产物落盘约束。
- 协作方式：后续可通过与 Codex 对话持续追加新测试用例，而无需重建测试框架。
