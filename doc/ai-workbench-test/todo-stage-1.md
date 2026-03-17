# AI Workbench 测试阶段 1 ToDo

## 规则

- 本文件中的所有任务全部完成并打勾后，才能创建 `todo-stage-2.md`
- 当前阶段只做阶段 1：`tool` 能力打底
- 当前阶段不进入 `S05 ~ S08` 的全量 e2e
- 当前阶段不做全量 UI 回归
- 当前阶段不做 `human` 独立阶段内容
- 当前阶段不做 `intent / context / plan` 阶段内容

## ToDo

- [x] 补齐 `docx` 复杂能力用例
  - 至少覆盖：结构读取、复杂混合编辑、表格更新、保存预览校验、多轮回滚、异常输入
  - 目标目录：`tests/ai/backend/tools/docx/`

- [x] 补齐 `terminal` 复杂能力用例
  - 至少覆盖：读取工作区材料、多段命令、产物识别、边界拦截、审批、拒绝、失败、取消
  - 目标目录：`tests/ai/backend/tools/terminal/`

- [x] 补齐 `kb` 能力用例
  - 至少覆盖：`hybrid / vector / fts`、source scope 过滤、无结果返回
  - 目标目录：`tests/ai/backend/tools/kb/`

- [x] 固化模型对比基线与记录字段
  - 常用模型：`gpt-5`
  - 强模型：`gpt-5.2`
  - 支持通过 `AI_LIVE_PRIMARY_MODEL_NAME / AI_LIVE_STRONG_MODEL_NAME` 切换 pair baseline
  - 明确后续 report / case 记录中的 `primaryModel / strongModel / runMode / primaryScore / strongScore`

- [x] 跑完阶段 1 的 backend 测试并更新报告
  - 更新 `tests/report/ai/report.md`
  - 记录本阶段完成情况
  - 明确下一阶段是 `human` 独立阶段
  - 输出下一阶段建议 `todolist`

## 当前阶段完成标准

- 上述所有复选框都已打勾
- backend raw logs 已产出到 `tests/logs/ai/**`
- `tests/report/ai/report.md` 已更新
- 可以明确进入 `todo-stage-2.md`

## 本阶段结果

- 阶段 1 已完成，范围限定在 `backend/tools`
- 本阶段新增并跑通：
  - `docx` 用例 `4` 条
  - `terminal` 用例 `5` 条
  - `kb` 用例 `3` 条
- 当前已可进入 `doc/ai-workbench-test/todo-stage-2.md`
