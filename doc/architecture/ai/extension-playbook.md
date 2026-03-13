# NCurator-Desktop AI 扩展手册

## 1. 新增 Tool / Capability

1. 在 `src/main/services/ai/tools/<capability>/` 新增实现
2. 在 `src/main/services/ai/tools/registry.ts` 注册工具
3. 若要暴露给 human，补充 skill card / tool 可见性逻辑
4. 校对 workspace / approval / artifact 边界
5. 为 capability 增加生产入口直连测试
6. 若影响交付或事件语义，同步更新 [runtime.md](/Users/test/work-space/NCurator-Desktop/doc/architecture/ai/runtime.md) 或 [event-contracts.md](/Users/test/work-space/NCurator-Desktop/doc/architecture/ai/event-contracts.md)

## 2. 新增 Prompt / Objective 编译逻辑

1. prompt 放在 `src/main/services/ai/prompts/*`
2. direct human、plan task、synthesis 的差异优先通过 objective 编译表达
3. 不要把新的固定模式字段暴露给 human 的模型可见输入
4. 若新增 delivery contract，必须同步检查：
   - `human_response` prompt
   - `deliveryMarkdown` 软协议
   - `task_delivery_ready` 事件
   - UI inspector 与测试报告

## 3. 新增状态或事件

1. 状态优先收敛到 `stateSchemas.ts`
2. 事件必须先明确属于：
   - 运行事件
   - 任务交付事件
   - 审批事件
   - 审阅事件引用
3. 任何用户可见的新事件都要同步更新工作台时间线与检查器
4. 若新增最终答复来源，必须明确它是否来自 `human_response`

## 4. 新增 Handoff / Delivery 能力

1. 先确认交付是 `handoff` 还是 `final`
2. 若是 plan 依赖传递，优先扩展 markdown handoff，而不是先引入结构化依赖图
3. 若是最终答复，必须校对：
   - 是否需要真实 token 流
   - 是否要产生 `local_sources_status`
   - 是否会触发 `non_local_permission_requested`

## 5. 新增草稿审阅能力

1. 优先复用 draft review 存储模型
2. 先定义 change unit、preview、commit 语义
3. 在运行阶段只允许生成草稿，不直接写回真实文件

## 6. 测试与报告同步

新增或修改 AI runtime 行为后，至少检查：

1. direct human 路径
2. plan handoff 链
3. synthesis human
4. `task_delivery_ready`
5. `answer_token / answer_completed`
6. 测试报告里的 `taskDeliveryCount / finalDeliverySource / synthesisTriggered`

## 7. 文档与 skill 同步

以下场景必须同时加载 `Doc-Governance`：

- 新增或重命名 AI 文档
- 修改 AI 默认阅读入口
- 修改 AI skill 的触发描述
- 修改影响默认工作流的 canonical 规则
