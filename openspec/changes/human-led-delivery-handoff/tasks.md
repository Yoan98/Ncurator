## 1. Shared 契约与主流程骨架

- [x] 1.1 重构 shared AI 类型与状态契约，新增 `deliveryMarkdown`、task delivery 相关事件，并移除 `main_finalize` 作为自然语言收口的契约假设
- [x] 1.2 重构 main graph 路由，删除 `direct_finalize` 与旧 finalize 收口逻辑，建立 `need_context`、`direct_human`、`to_plan`、`main_synthesis_human`、`main_complete` 的新阶段流转
- [x] 1.3 调整 main plan 执行状态，使 plan 业务任务结束后总能进入 synthesis human，并在业务任务阻塞时停止后续业务任务但保留 synthesis 收口

## 2. Human 交付模型

- [x] 2.1 为 human 子图新增 `human_response_node`，让 `complete_task` 与 `block_task` 都进入正式交付生成阶段
- [x] 2.2 重构 `HumanTaskOutput` 与 human 运行返回值，收敛为 `summary + deliveryMarkdown` 为核心、`resultData` 为辅助的输出模型
- [x] 2.3 实现 objective 编译策略，使 direct human、plan 中间任务与 synthesis human 都通过自然语言 objective 表达任务语义，而不向模型暴露固定模式字段
- [x] 2.4 实现 markdown handoff 软协议 prompt，使中间任务与最终答复分别生成稳定的交付 section

## 3. 事件、流式输出与 IPC

- [x] 3.1 将最终答复流式输出从 IPC 后置切片迁移到 human delivery 节点，确保 `answer_token` / `answer_completed` 来源于 direct human 或 synthesis human
- [x] 3.2 新增 `task_delivery_ready` 事件并打通 main/human/IPC 发送链路，使中间任务交付可被 UI 与测试回放
- [x] 3.3 清理旧 `main_finalize`、`outputText` 与 answer stream 的旧来源假设，保证 run 完成、失败、取消路径与新交付模型一致

## 4. Renderer 工作台与答复展示

- [x] 4.1 调整聊天执行 UI，使 direct human 无 plan 路径下仍能正常展示执行叙事、最终答复与关键检查器内容
- [x] 4.2 为 plan 运行增加任务交付查看能力，在时间线与右侧检查器中展示 `deliveryMarkdown`、业务任务交付与 synthesis 交付
- [x] 4.3 更新 assistant run 卡片、timeline 投影与相关展示逻辑，使其区分业务任务推进、task delivery 与 synthesis 最终答复

## 5. 文档、技能与规范同步

- [x] 5.1 重写 `doc/architecture/ai/README.md`、`runtime.md`、`event-contracts.md`、`glossary.md`、`extension-playbook.md`，补充新的 AI 架构图与 handoff/synthesis 流程图
- [x] 5.2 同步更新 `AGENTS.md` 与 `.codex/skills/ai-architecture/SKILL.md`，使默认入口、阅读顺序与约束统一到 human-led delivery 架构
- [x] 5.3 校对并落实现有 OpenSpec delta 对应的代码与文档命名，确保 canonical 文档、spec 和实现术语一致

## 6. 测试与报告收敛

- [x] 6.1 新增或重写 main runtime / human 用例，覆盖 direct human、plan handoff 链、synthesis human、blocked 后仍 synthesis 的关键场景
- [x] 6.2 调整测试报告与分析契约，增加 task delivery、final delivery source、synthesis 触发与交付 section 的观测信号
- [x] 6.3 运行并收敛受影响的 AI runtime / human / renderer 测试，更新相关测试文档与升级记录
