# 测试文档索引

本目录用于把“测试架构设计”“AI 阶段化测试计划”“AI 测试结果汇总”彻底拆开，避免混写在一篇文档里。

## 1. 目录与职责

```text
doc/test/
  README.md                 # 总入口
  architecture.md           # 测试架构设计（稳定规则）
  ai-phased-plan.md         # AI阶段化测试计划（推进顺序）
  ai-upgrade-journal.md     # 每轮AI测试汇总 + 阶段专题结论（持续追加）
```

- [README.md](/Users/test/work-space/NCurator-Desktop/doc/test/README.md)
  - 总入口与阅读路线
- [architecture.md](/Users/test/work-space/NCurator-Desktop/doc/test/architecture.md)
  - 测试架构设计与工程规则
  - 覆盖：分层、目录约定、harness、报告契约、命令、扩展规则
- [ai-phased-plan.md](/Users/test/work-space/NCurator-Desktop/doc/test/ai-phased-plan.md)
  - AI 阶段化测试计划（阶段顺序、门禁条件、推进规则）
- [ai-upgrade-journal.md](/Users/test/work-space/NCurator-Desktop/doc/test/ai-upgrade-journal.md)
  - AI 能力测试的持续汇总总文档（每轮测试完成后追加）
  - 包含各阶段专题结论（`tool capability` 已并入）

## 2. 推荐阅读顺序

1. 先读 [architecture.md](/Users/test/work-space/NCurator-Desktop/doc/test/architecture.md) 了解测试架构与边界。
2. 再读 [ai-phased-plan.md](/Users/test/work-space/NCurator-Desktop/doc/test/ai-phased-plan.md) 确认当前阶段计划与门禁。
3. 查看 [ai-upgrade-journal.md](/Users/test/work-space/NCurator-Desktop/doc/test/ai-upgrade-journal.md) 的最新阶段记录与专题结论，确认风险与推进决策。

## 3. 维护规则

- 新增或调整测试分层、harness、报告契约：只改 `architecture.md`。
- 调整 AI 阶段顺序、进入/退出门槛：只改 `ai-phased-plan.md`。
- 阶段专项结论（例如 `tool capability` 能力边界）：统一写入 `ai-upgrade-journal.md` 对应阶段记录。
- 每次完成 AI 相关测试后，必须追加到 `ai-upgrade-journal.md`，作为后续 AI 继续升级的统一输入。

## 4. 追加汇总的最小要求

每次追加至少包含：

1. 日期与阶段
2. 执行命令与报告路径
3. 通过率/失败面
4. 关键边界或显式缺口
5. 是否允许进入下一阶段
6. 下一轮优先级

## 5. 当前统一工作台相关入口

- Renderer contract：
  - `pnpm test:renderer`
  - 重点覆盖统一工作台模式切换、时间线/检查器、草稿审阅恢复与逐块确认
- Main 关键链路：
  - `pnpm exec vitest --config vitest.ai.config.mts run tests/main/ai/runtime/docx.draft-review-commit.test.ts`
  - 重点覆盖最新草稿读取、统一审阅就绪、部分接受后提交、冲突阻止提交与提交后清理
- Deterministic E2E：
  - `pnpm exec electron-vite build`
  - `pnpm exec vitest --config vitest.e2e.config.mts run tests/e2e/**/deterministic`
  - 重点覆盖 workbench 纯搜索、AI 执行时间线、统一审阅、部分接受后提交与冲突提示
