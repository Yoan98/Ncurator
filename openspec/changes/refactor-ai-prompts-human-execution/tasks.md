## 1. Prompt Registry 基础结构

- [x] 1.1 在 `src/main/services/ai/prompts/` 下创建 `main`、`human`、`memory`、`shared` 与 `index.ts` 入口结构
- [x] 1.2 实现 `shared/contracts.ts`，统一沉淀 JSON-only 输出约束与通用提示词契约片段
- [x] 1.3 实现 `shared/render.ts`，提供结构化入参到 prompt 文本的构建/拼接能力
- [x] 1.4 为 `main/intent.ts`、`main/plan.ts`、`main/finalize.ts` 定义 typed builder 接口与返回结构
- [x] 1.5 为 `human/brain.ts`、`memory/sessionMemory.ts` 定义 typed builder 接口与返回结构

## 2. Main / Human / Memory Prompt 接入迁移

- [x] 2.1 将 `intentNode` 的内联 prompt 迁移为调用 prompt registry
- [x] 2.2 将 `planNode` 的内联 prompt 迁移为调用 prompt registry
- [x] 2.3 将 `finalizeNode` 的内联 prompt 迁移为调用 prompt registry
- [x] 2.4 将 `brainNode` 的内联 prompt 迁移为调用 prompt registry
- [x] 2.5 将 `memory.ts` 的内联 prompt 迁移为调用 prompt registry
- [x] 2.6 清理节点中冗余的 prompt 字符串拼接逻辑并保持既有输入变量完整

## 3. Human 渐进探索控制流增强

- [x] 3.1 在 human 工具执行节点实现失败分级：`workspace_required/approval_denied` 直接阻塞，`failed/invalid_input` 回到 brain 继续探索
- [x] 3.2 保持 `complete_task` 与 `block_task` 作为唯一显式收敛出口，不引入自然语言隐式结束路径
- [x] 3.3 更新 human brain 提示词策略，明确“观察-行动-验证”循环、结束条件与阻塞条件
- [x] 3.4 在可恢复失败场景补充 `summary/resultData` 信息，确保 `human_step` 与 `task_result` 可观测
- [x] 3.5 校验步数保护阈值与取消逻辑在新策略下仍能防止无界循环

## 4. 移除 HumanTaskInput.mode 契约

- [x] 4.1 在 `src/shared/types.ts` 移除 `HumanTaskInput.mode` 并更新注释与导出契约
- [x] 4.2 在 `src/main/services/ai/state/stateSchemas.ts` 移除对应 schema 字段并保持 runtime state 校验通过
- [x] 4.3 更新 `contextEnrichNode` 与 `planExecNode` 的 `runHumanTask` 入参构造，改为仅传 `taskId/objective`
- [x] 4.4 更新 `brainNode` 对任务输入的首轮消息构造，去除“任务模式”文案依赖
- [x] 4.5 全局检索并清理 AI 运行时中的 `mode=context|dispatch` 旧引用

## 5. 文档与规范同步

- [x] 5.1 更新 `doc/ai-architecture.md`，移除 `Human Subgraph (mode=context/dispatch)` 相关表述
- [x] 5.2 在文档中补充 prompt registry 的目录落点与职责边界
- [x] 5.3 在文档中补充 human 渐进探索与失败分级策略的运行规则
- [x] 5.4 校对 OpenSpec 变更文档（proposal/design/specs）与实现范围一致

## 6. 验证与回归

- [x] 6.1 运行 `typecheck`，修复契约迁移引发的类型错误
- [x] 6.2 运行 `lint`，修复迁移引发的风格与静态检查问题
- [x] 6.3 验证主流程：`intent -> context_enrich -> plan -> main_plan_exec -> finalize` 在新 prompt registry 下可运行
- [x] 6.4 验证 human 在可恢复失败场景会继续探索，在不可恢复失败场景会正确阻塞
- [x] 6.5 验证 `HumanTaskInput.mode` 移除后，事件流与 Chat UI 的计划/步骤展示不回归
