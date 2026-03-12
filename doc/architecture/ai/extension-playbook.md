# NCurator-Desktop AI 扩展手册

## 1. 新增 Tool / Capability

1. 在 `src/main/services/ai/tools/<capability>/` 新增实现
2. 在 `src/main/services/ai/tools/registry.ts` 注册工具
3. 若需要暴露给 human，补充 skill card / tool 可见性逻辑
4. 为 capability 增加生产入口直连测试
5. 若用户可观察行为发生变化，同步更新 `runtime.md` 或 `event-contracts.md`

## 2. 新增 Prompt / 决策逻辑

1. 将 prompt 放在 `src/main/services/ai/prompts/*`
2. 若新增结构化 decision 或状态字段，先更新 shared / main 类型
3. 补充 human 或 main runtime 测试，避免 prompt contract 漂移

## 3. 新增状态或事件

1. 状态优先收敛到 `stateSchemas.ts`
2. 事件必须先明确它是：
   - 运行事件
   - 审批事件
   - 审阅事件引用
3. 任何用户可见的新事件都要同步说明 UI 语义

## 4. 新增草稿审阅能力

1. 优先复用 draft review 存储模型
2. 先定义 change unit、preview、commit 语义
3. 在运行阶段只允许生成草稿，不直接写回真实文件

## 5. 文档与 skill 同步

以下场景必须同时加载 `Doc-Governance`：

- 新增或重命名 AI 文档
- 修改 AI 默认阅读入口
- 修改 AI skill 的触发描述
- 修改影响默认工作流的 canonical 规则
