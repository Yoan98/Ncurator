## Context

当前 AI runtime 在 `graph.ts` 中采用一次性 `ensurePlan` 生成任务后再调度 capability 的模式，缺少显式“host 先决策是否补充上下文，再决定直答或生成计划”的运行时协议。虽然现有规格已定义 host 应在上下文充分后做分流决策，但实现层仍存在两类偏差：

1. host 不具备结构化“下一步动作”循环，只能直接产出 `tasks`。
2. 当规划返回 `tasks: []` 时会被 heuristic 回退为任务执行，弱化 host 自主决策能力。

本次设计目标是在不破坏 capability 边界（`local_kb_retrieval` / `terminal_exec` / `docx`）的前提下，将“策略可由 host 提示词演进、约束由 runtime 固化”落到同一套运行时模型中。

## Goals / Non-Goals

**Goals:**
- 将 host 执行模型升级为“决策动作循环”，支持 `retrieve_context`、`create_plan`、`final_answer`。
- 让“是否先补充上下文”成为 host 的显式可控决策，而不是固定前置流程。
- 在 run context 中提供可控的本地指令输入（memory + workspace policy），提升 host 决策稳定性。
- 明确事件语义：前置上下文补充不等同于用户可见执行计划。
- 通过轮次/超时/取消机制确保 host 决策循环可终止、可回退。

**Non-Goals:**
- 不改造 capability 内部工具循环逻辑（terminal/docx/retrieval 内部执行策略保持现状）。
- 不在本次引入新的外部依赖或新的存储表。
- 不要求一次性重写 Renderer 全部执行可视化，仅补齐与新语义相关的最小兼容。

## Decisions

### 1) Host 输出从“计划”改为“下一步动作工具协议”

**Decision**
- host 每轮只允许调用一个 host 控制类 tool：
  - `retrieve_context`: 请求执行一次上下文补充，并显式声明本轮使用的 capability kind（可为 `local_kb_retrieval`、`terminal_exec`、`docx`）
  - `create_plan`: 产出对用户可见的 capability 任务计划
  - `final_answer`: 直接给出最终答复
- runtime 负责执行该 tool 动作，随后将新增证据回注给 host 进入下一轮。
- 保留兼容回退：当模型未产生 tool call 时，允许受控 JSON 解析回退一次，再进入失败安全路径。

建议动作载荷最小形态：
- `retrieve_context`: `{ action, capabilityKind, objective, optionalCapabilityInput }`
- `create_plan`: `{ action, tasks }`
- `final_answer`: `{ action, answer? }`

**Rationale**
- 满足“提示词可调策略、代码固化边界”的长期目标。
- 避免一次性 plan 结构承载过多阶段语义。

**Alternatives considered**
- 仅调 host 提示词、不改 runtime：无法保证真正两阶段决策，且仍受 heuristic 回退干扰。
- 新增独立 pre-plan 节点：可行但会把策略分散到多节点，不利于后续通过 host prompt 统一演化。

### 2) 本地指令输入作为独立上下文构件

**Decision**
- 在 `runtime` 构建 host 输入时，新增 `localInstructions`（边界化、去重、限长）并维持优先级：
  1. workspace policy 指令
  2. memory `pinnedFacts`
  3. memory `userPrefs`
  4. 其他可用运行时偏好
- host 提示词消费 `localInstructions`，不再依赖将规则散落在自然语言上下文中。

**Rationale**
- 提升 host 决策一致性，避免从 summary/recent turns 中隐式抽取规则导致漂移。

**Alternatives considered**
- 每轮临时从 history 文本抽取“指令”：噪声大且不可控。
- 将指令写死在系统提示词：缺乏会话级个性化与策略可运营性。

### 3) 前置上下文补充与用户执行计划语义分层

**Decision**
- `plan_created` 仅在 host 选择 `create_plan` 后发出。
- `retrieve_context` 阶段允许走任意已注册 capability，但属于“内部上下文动作”；其过程通过 `activity` / `tool_call_*`（以及必要时的 workspace/approval 门禁事件）表达，不占用用户执行计划任务槽位。

**Rationale**
- 防止 UI 将“内部推理动作”误渲染为“可执行计划步骤”。
- 保持 plan 面板语义稳定：只展示真正执行任务。

**Alternatives considered**
- 把前置补充当成 plan task：实现简单，但会污染任务进度和失败语义。

### 4) 决策循环硬约束与安全降级

**Decision**
- 新增 host 决策循环预算：`maxDecisionRounds`、`maxContextEnrichmentRounds`、每轮超时与取消检查。
- 达到上限时触发安全降级：优先 `final_answer`，必要时按显式错误收敛。
- 当 `retrieve_context` 选择 workspace-bound capability（`terminal_exec` / `docx`）但门禁未满足时，runtime 不进入无限重试，必须将阻塞原因回注 host 并进入有界分流。

**Rationale**
- 避免“反复补充上下文”导致不可终止或超时。

**Alternatives considered**
- 完全交给模型自行停止：不满足工程稳定性要求。

### 5) 动作级完成语义与状态更新

**Decision**
- `retrieve_context`：完成一次 capability 证据补充即视为“内部上下文步骤完成”，更新内部轮次计数，不触发 `plan_created`。
- `create_plan`：触发 `plan_created` 并进入现有 `task_started/task_completed/task_failed/task_result` 任务完成模型。
- `final_answer`：触发 `answer_token/answer_completed` 并直接收敛到 run 完成，不创建计划任务。

**Rationale**
- 明确三动作各自的“完成”定义，避免实现时混用 plan 状态和内部步骤状态。

### 6) 事件协议保持增量兼容

**Decision**
- 优先复用现有事件族，新增可选字段或新的活动 actionType；避免破坏当前 `AiRunEvent` 消费。
- 若确需新增事件类型，采用增量 union 扩展并保证旧消费者可忽略。

**Rationale**
- 降低 Renderer 改造成本，减少跨进程契约风险。

### 7) Host 目录抽离到 `node/host`

**Decision**
- 将 host 相关控制逻辑从 `src/main/services/ai/graph.ts` 拆分到 `src/main/services/ai/node/host/`，建议最小结构：
  - `src/main/services/ai/node/host/hostNode.ts`（host 主循环）
  - `src/main/services/ai/node/host/hostActionTools.ts`（`retrieve_context/create_plan/final_answer` tools）
  - `src/main/services/ai/node/host/hostActionExecutor.ts`（tool 动作执行与状态落地）
  - `src/main/services/ai/node/host/hostPrompt.ts`（host system/user prompt 组装）
- `graph.ts` 保留路由编排职责，不再内嵌 host 细节实现。

**Rationale**
- 符合项目目录规范中的“graph 做编排、节点实现归位到 node 目录”的分层目标，降低后续维护复杂度。

**Alternatives considered**
- 继续把 host 逻辑堆在 `graph.ts`：短期改动少，但会加剧跨职责耦合与测试难度。

## Risks / Trade-offs

- **[Risk] Host 动作协议引入后，提示词质量仍影响决策稳定性** → Mitigation: 增加 JSON schema 校验、默认回退路径、离线回放样例。
- **[Risk] 本地指令过多造成 prompt 膨胀** → Mitigation: 指令分层去重、按优先级截断、长度上限。
- **[Risk] 前置补充动作不可见导致“系统像在卡住”** → Mitigation: 统一发出 activity（如“正在补充上下文”）并展示阶段状态。
- **[Risk] 旧 UI 对新增字段处理不完整** → Mitigation: 保持事件结构向后兼容，先灰度启用新字段。
- **[Risk] host 目录迁移引发 import/循环依赖问题** → Mitigation: 先抽纯函数与类型，再迁移节点实现，最后收敛入口依赖。

## Migration Plan

1. 在 `graph` 中引入 host 动作循环状态与路由，不改变现有 capability executor 注册方式。
2. 新建 `src/main/services/ai/node/host/` 并迁移 host 相关实现，保持 `graph.ts` 仅做路由编排。
3. 在 host 层实现 `retrieve_context/create_plan/final_answer` 控制类 tools 与单轮单动作约束。
4. 在 `runtime` 扩展 host 输入构建，补充 `localInstructions` 聚合与限长策略。
5. 在 host 动作执行器中支持 capability-kind 可选分发，使 `retrieve_context` 可调用 `local_kb_retrieval` / `terminal_exec` / `docx`。
6. 调整 `plan_created` 触发时机，仅在 `create_plan` 动作后发出。
7. 增加 activity/actionType 语义并验证 Renderer 兼容显示。
8. 移除/替换 `tasks: []` 的 heuristic 强制回退逻辑。
9. 使用回归样例验证四种路径：直接答复、先 KB 补充后答复、先 terminal/docx 补充后答复、先补充后执行计划。

**Rollback strategy**
- 保留旧 host 规划分支的 feature flag（或可回滚分支）以便快速切回一次性规划模式。

## Open Questions

- `localInstructions` 是否需要在 IPC 请求层支持显式用户注入（除 memory/workspace 外）？
- host 动作协议是否需要记录 `reason`/`confidence` 供调试与评估使用？
- 在上下文补充失败时，默认降级到 `final_answer` 还是 `create_plan` 更符合产品体验？
