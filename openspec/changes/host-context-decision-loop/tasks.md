## 1. Host 目录重构与模块归位

- [ ] 1.1 新建 `src/main/services/ai/node/host/`，拆分 `hostNode.ts`、`hostActionTools.ts`、`hostActionExecutor.ts`、`hostPrompt.ts`
- [ ] 1.2 将 `graph.ts` 中 host 细节迁移到 `node/host` 目录，保留 `graph.ts` 仅做状态图路由编排
- [ ] 1.3 清理迁移后的导入与引用关系，确保无循环依赖且符合 `doc/project-structure.md` 目录职责

## 2. Host 三动作 tool 协议

- [ ] 2.1 在 `src/main/services/ai/types.ts` 定义 host 控制类 tool 动作协议（`retrieve_context` / `create_plan` / `final_answer`）及运行态字段
- [ ] 2.2 将当前一次性 `ensurePlan` 流程改为“host tool 决策 -> runtime 执行动作 -> 回到 host”的循环路由
- [ ] 2.3 在 `retrieve_context` 动作中支持 host 指定 capability kind（至少覆盖 `local_kb_retrieval`、`terminal_exec`、`docx`）并复用现有 capability registry 分发
- [ ] 2.4 为 pre-plan `retrieve_context` 走 `terminal_exec`/`docx` 时补齐 workspace/approval 门禁处理与有界回退
- [ ] 2.5 移除 `tasks: []` 的 heuristic 强制回退，改为按 host 决策终态收敛
- [ ] 2.6 保留“无 tool call 时的单次 JSON 回退 + 失败安全”处理，避免模型输出漂移导致死循环

## 3. 本地指令上下文构建

- [ ] 3.1 在 `src/main/services/ai/runtime.ts` 扩展 host 输入构建，输出 bounded `localInstructions`
- [ ] 3.2 将 memory `userPrefs`、`pinnedFacts` 与 workspace policy 信息按优先级整合并去重/截断
- [ ] 3.3 更新 host 提示词输入模板，使其显式消费 `localInstructions` 与上下文补充证据

## 4. 事件语义与任务完成判定

- [ ] 4.1 调整 `plan_created` 触发时机：仅在 host 选择 `create_plan` 后发出
- [ ] 4.2 实现动作级完成语义：`retrieve_context` 完成内部步骤并回到 host，`create_plan` 进入任务生命周期，`final_answer` 直接收敛 run
- [ ] 4.3 为“host 决策/上下文补充”补充 activity 语义，保证与执行计划任务语义分离
- [ ] 4.4 在 `src/shared/types.ts` 中以增量方式扩展事件契约，保持旧消费者兼容

## 5. Renderer 兼容与展示

- [ ] 5.1 在 `src/renderer/src/pages/ChatPage.tsx` 校验并适配新的 activity/plan 语义，避免把前置补充动作显示为执行计划步骤
- [ ] 5.2 验证右侧面板与执行进度在“直答 / 先补充后直答 / 先补充后计划执行”三条路径下展示一致

## 6. 边界与回归验证

- [ ] 6.1 增加或补充 host 决策循环边界验证（最大轮次、超时、取消信号）
- [ ] 6.2 回归验证 workspace/approval 门禁不受新 host 决策循环影响
- [ ] 6.3 验证 `retrieve_context` 三类 capability 选择（KB / terminal / docx）均可按预期分流与收敛
- [ ] 6.4 验证三动作完成语义与事件流一致：`retrieve_context` 不触发 plan、`create_plan` 进入 task、`final_answer` 直收敛
- [ ] 6.5 验证事件流满足 `ai-run-event-stream` 新旧契约兼容，且能稳定按 run/task 关联渲染
