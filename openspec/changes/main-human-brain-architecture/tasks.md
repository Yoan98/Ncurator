## 1. 共享契约与运行时类型重构

- [x] 1.1 在 `src/shared/types.ts` 新增 human 运行契约类型：`HumanTaskInput`、`BrainStepAction`、`CapabilityResult`、`HumanTaskOutput`、步骤级事件字段
- [x] 1.2 在 `src/main/services/ai/types.ts` 重构运行态定义，补充 main/human 双层执行所需状态并移除旧 host 动作循环专属字段
- [x] 1.3 统一 `invoke_capability / complete_task / block_task` 的 schema 校验入口，确保 brain 动作在进入执行层前完成强校验

## 2. Main Graph 重构为系统编排层

- [x] 2.1 重构 `src/main/services/ai/graph.ts`，实现 `probe -> context_enrichment_loop -> plan -> dispatch_to_human -> finalize` 的阶段路由
- [x] 2.2 将计划任务改为“逐任务派发到 human runner”，main 仅负责任务级聚合与状态推进
- [x] 2.3 删除旧 host 节点在主图中的调度入口，确保运行时不存在旧 host 兼容分支

## 3. Human Runner 与 LangGraph 动态工具执行

- [x] 3.1 新建/重构 human 运行节点，落地 `brain -> tool -> observe` 的单任务步骤循环与有界控制（步数/超时/取消）
- [x] 3.2 在每一步执行前生成 `activeTools`，并保证同一步 `bindTools(activeTools)` 与 `ToolNode(activeTools)` 使用同一工具集合
- [x] 3.3 实现 `complete_task` 与 `block_task` 的终态收敛逻辑，禁止 capability/human 子步骤直接结束整条 run

## 4. Tool Broker 与 Capability Registry 升级

- [x] 4.1 扩展 capability registry 元数据（`tags`、`requiresWorkspace`、`requiresApproval`、`consumes`、`produces`、`inputSchema`、`outputSchema`）
- [x] 4.2 实现 Broker 确定性筛选规则：白名单、前置门禁、slot 可用性、目标匹配与数量截断（默认 3~6）
- [x] 4.3 增加 `activeToolSetId` 与筛选快照记录，确保工具筛选与执行链路可回放、可审计

## 5. 任务级 Slot Memory 机制

- [x] 5.1 实现 task-scoped slot 命名空间与读写接口，确保不同任务之间状态隔离
- [x] 5.2 在步骤执行前后实现 `consume / produce / expect.requiredOutputs` 校验与错误回传
- [x] 5.3 实现步骤级原子提交与回滚策略，禁止部分 slot 写入成功
- [x] 5.4 对大输出启用 `ref + summary` 存储策略，避免超大内容直接进入 prompt

## 6. Capability 原子化改造（移除内部 AI 循环）

- [x] 6.1 将 `local_kb_retrieval`、`terminal_exec`、`docx` 适配为原子执行器接口，输入输出统一对齐 `CapabilityResult`
- [x] 6.2 移除 capability 内部 AI 决策循环逻辑，保留必要的工程级边界处理（如 I/O 重试、超时控制）
- [x] 6.3 校验 workspace/approval 门禁在 human 步骤执行下仍严格生效
- [x] 6.4 补齐未知 capability/未知工具的快速失败与结构化错误返回

## 7. 事件流与 Renderer 语义更新

- [x] 7.1 更新事件模型以表达 main stage 与 human step 双层语义，并补充 Broker/slot 提交可观测事件
- [x] 7.2 在 `src/renderer/src/pages/ChatPage.tsx` 适配新事件语义，正确展示任务步骤、工具切换与阻塞原因
- [x] 7.3 校验 finalization 输出链路：最终答复仅由 main finalization 发出 `answer_token/answer_completed`

## 8. 遗留清理与回归验证

- [x] 8.1 删除 `src/main/services/ai/node/host/**` 及相关旧 host 遗留引用，清理无用类型与辅助函数
- [x] 8.2 完成关键路径回归：直答、单任务多步、动态工具切换、slot 依赖、审批/工作区门禁、`block_task` 收敛
- [x] 8.3 更新 `doc/ai-architecture.md`，将架构文档切换到 main/human 新模型并移除旧 host 叙述
