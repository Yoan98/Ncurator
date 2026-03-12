# NCurator-Desktop AI Runtime

## 1. 设计目标

- 主流程编排与单任务执行解耦。
- 所有能力统一走 tool 机制，避免 capability 级 AI 循环。
- `brain` 严格按 step 推进，确保运行可观测、可回放。
- 保留 workspace / approval 边界，不回退到旧 host 逻辑。

## 2. 分层边界

- `Main Graph`
  - 系统编排层，负责上下文补充、计划推进与最终收敛。
- `Human Subgraph`
  - 单任务执行层，负责 skill 加载、tool 决策与执行循环。
- `Capability Registry`
  - 按 `tools/<capability>` 聚合真实工具实现。
- `Prompt Registry`
  - 统一管理 main / human / shared prompt 入口。

边界约束：

- Main 不直接执行 capability，只调用 human runner。
- Human 不生成自然语言最终答复，必须通过任务级结果收敛。
- Capability 不是 graph node，只是原子 tool。

## 3. Main Graph

节点：

1. `main_intent_node`
2. `main_context_enrich_node`
3. `main_plan_node`
4. `main_plan_exec_node`
5. `main_finalize_node`

关键规则：

- `intent` 只输出 `need_context | to_plan | direct_finalize`
- `contextRounds` 达到上限后强制降级到 `to_plan`
- `dispatch` 串行执行任务，默认 `fail-fast`
- 最终答复只能由 `main_finalize_node` 生成

## 4. Human Subgraph

节点：

1. `human_brain_node`
2. `human_skill_loader_node`
3. `human_tool_exec_node`

关键规则：

- `brain` 每步只输出 `load_skill | invoke_tool | complete_task | block_task`
- `availableSkillCards` 是常驻可见的轻量能力目录
- `activeTools` 只来自当前 `activeSkillIds`
- 可恢复失败回到 `brain` 继续探索
- 不可恢复失败必须收敛为 `block_task`

## 5. 任务与状态模型

- 任务输入：`HumanTaskInput`
- 任务输出：`HumanTaskOutput`
- Main 路由唯一来源：`AiRunState.mainStage`
- Human 核心状态：
  - `availableSkillCards`
  - `loadedSkills`
  - `activeSkillIds`
  - `activeTools`
  - `lastDecision`
  - `lastObservation`
  - `stepHistory`

## 6. 安全边界

- `terminal_exec` / `docx` 未绑定 workspace 时必须拒绝
- 本地资料不足时不能直接混入非本地信息
- 命中审批策略时必须先走审批事件
- 审批拒绝返回结构化失败，不进入隐式重试

## 7. 代码落点

- Graph：`src/main/services/ai/graph/*`
- Main 节点：`src/main/services/ai/node/main/*`
- Human 节点：`src/main/services/ai/node/human/*`
- State：`src/main/services/ai/state/stateSchemas.ts`
- Prompts：`src/main/services/ai/prompts/*`
- Tools：`src/main/services/ai/tools/*`
