# NCurator-Desktop AI 架构升级手册

## 1. 适用场景

- Main / Human 边界调整
- event contract 调整
- tool registry / skill card 机制调整
- 审批、范围、草稿审阅或工作台语义调整

## 2. 升级步骤

1. 先确认当前变更属于 runtime、event 还是扩展方式变化
2. 同步更新以下文档：
   - `runtime.md`
   - `event-contracts.md`
   - `extension-playbook.md`（若扩展方式变化）
3. 同步更新以下入口：
   - `.codex/skills/ai-architecture/SKILL.md`
   - [AGENTS.md](/Users/test/work-space/NCurator-Desktop/AGENTS.md)
   - `doc/reference/source-of-truth.md`（若入口或真相源变化）
4. 若影响测试层，更新 `doc/testing/*`
5. 若影响 active spec，更新 `openspec/specs/*`

## 3. 升级约束

- 不把历史迁移说明写回 `runtime.md`
- 不保留旧路径作为默认入口
- 文档、skill、AGENTS 必须在同一 change set 同步
- 运行规则变化必须有至少一层对应测试收敛

## 4. 变更完成判定

满足以下条件后，才视为升级完成：

- 新入口能明确指向当前架构
- 相关 skill 会优先读新入口
- AGENTS 文档路由与新路径一致
- active spec 不再指向废弃路径
