# AI Workbench 测试阶段 2 ToDo

## 规则

- 本文件中的所有任务全部完成并打勾后，才能创建 `todo-stage-3.md`
- 当前阶段只做阶段 2：`human` 核心能力
- 当前阶段不进入 `S01 ~ S08` 的全量 e2e
- 当前阶段不做全量 UI 回归
- 当前阶段不做 `intent / context / plan` 阶段内容

## ToDo

- [x] 补齐 `human` 单步闭环与基础交付用例
  - 至少覆盖：单步 `kb` 问答、简单任务独立完成、结构化交付
  - 目标目录：`tests/ai/backend/human/`

- [x] 补齐 `human` 多工具串联用例
  - 至少覆盖：`terminal -> docx`、`kb -> docx`、文档多步编辑与保存
  - 目标目录：`tests/ai/backend/human/`

- [x] 补齐 `human` 阻塞与审批收敛用例
  - 至少覆盖：`workspace_required`、审批上抛、阻塞后部分交付
  - 目标目录：`tests/ai/backend/human/`

- [x] 补齐 `human` 失败纠偏与 refinement 用例
  - 至少覆盖：工具失败后改道、多轮 refinement、目标不漂移
  - 目标目录：`tests/ai/backend/human/`

- [ ] 按模型对比基线复跑关键 `human` 样例并记录差异
  - 常用模型：`gpt-5`
  - 强模型：`gpt-5.2`
  - pair baseline 支持通过 `AI_LIVE_PRIMARY_MODEL_NAME / AI_LIVE_STRONG_MODEL_NAME` 切换；测试侧运行时显式选择 `primary` 或 `strong`
  - 对失败样例与 `golden cases` 记录 `primaryModel / strongModel / runMode / primaryScore / strongScore`
  - 当前进展：`human-single-step-kb-answer` 的 `gpt-5` 探针 `20260317-140339-612` 与 `gpt-5.2` 探针 `20260317-140645-949` 都已通过
  - 当前状态：pair baseline 已从“外部阻塞”进入“部分完成”，剩余关键 `human` 样例尚未补跑

- [ ] 跑完阶段 2 的 backend 测试并更新报告
  - 更新 `tests/report/ai/report.md`
  - 记录本阶段完成情况
  - 明确下一阶段进入 `intent / context / plan`
  - 输出下一阶段建议 `todolist`
  - 当前进展：mock backend 已于 `2026-03-17` 全量跑通，单步 KB 的 `gpt-5 / gpt-5.2` live pair 探针也已补齐；但阶段 2 仍未跑完剩余关键 `human` pair case

## 当前阶段完成标准

- 上述所有复选框都已打勾
- backend raw logs 已产出到 `tests/logs/ai/**`
- `tests/report/ai/report.md` 已更新
- 可以明确进入 `todo-stage-3.md`

## 当前进展

- 已完成并跑通：
  - `human-single-step-kb-answer`
  - `human-terminal-docx-handoff`
  - `human-blocked-on-workspace`
  - `human-approval-denied`
  - `human-self-correction-after-tool-failure`
  - `human-docx-iterative-edit`
- 已补齐：
  - backend live raw log 现已记录真实 `meta.runtime.modelName`
  - 关键 `human` case 已支持 `mock / live` 双模式
  - live 配置可用时默认直连模型
  - 阶段 2 mock backend 已重新全量跑通并刷新 raw logs
  - bare-origin 的 OpenAI 兼容 base URL 现已自动规范到 `.../v1`
  - 默认 pair baseline 已更新为 `gpt-5 / gpt-5.2`
  - `human-single-step-kb-answer` 已完成 `gpt-5 / gpt-5.2` live 双探针
- 当前阻塞：
  - 当前没有新的外部配置阻塞，但在双模型对比证据不足前，仍不能创建 `todo-stage-3.md`
- 当前仍待补：
  - 补跑 `human-docx-iterative-edit`、`human-terminal-docx-handoff`、`human-blocked-on-workspace` 的 `gpt-5 / gpt-5.2` 对比记录
  - 满足阶段 2 完成标准后，再输出正式的下一阶段 todolist
