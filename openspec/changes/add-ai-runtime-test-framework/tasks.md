## 1. 测试基础设施与目录骨架

- [ ] 1.1 在项目中新增 AI 测试目录骨架（`tests/ai/cases`、`tests/ai/fixtures`、`artifacts/ai-test-results`）。
- [ ] 1.2 为 Main 进程 AI 测试新增统一运行入口与命令脚本（如 `ai:test`、`ai:test:watch`）。
- [ ] 1.3 建立测试运行上下文与依赖注入容器，确保测试可在本地稳定执行。

## 2. 用例 DSL 与夹具机制

- [ ] 2.1 定义 AI 测试用例 DSL schema，覆盖 `suite/input/setup/mocks/expects/score` 关键字段。
- [ ] 2.2 实现用例加载与前置校验，非法 DSL 在执行前失败并输出结构化错误。
- [ ] 2.3 实现 fixture 装载与隔离策略，避免不同用例之间共享隐式状态。

## 3. 测试运行器与断言框架

- [ ] 3.1 实现统一测试运行器（按 suite 执行、并发控制、失败收敛）。
- [ ] 3.2 实现契约断言、事件流断言与效果评分断言三类断言器。
- [ ] 3.3 实现结构化失败分类（如 `tool_contract_error`、`context_effect_low`）并附带修复锚点。

## 4. Tool 效果测试落地

- [ ] 4.1 为 `local_kb_retrieval` 建立契约与门禁测试（scope、limit、关键事件）。
- [ ] 4.2 为 `terminal_exec` 建立边界与审批测试（workspace、approval、step trace）。
- [ ] 4.3 为 `docx` 建立门禁与核心操作返回结构测试。

## 5. Human 效果测试落地

- [ ] 5.1 建立 human 循环测试（`brain -> tool_exec -> brain`）及收敛动作校验。
- [ ] 5.2 建立可恢复失败继续探索测试（`failed`、`invalid_input`）。
- [ ] 5.3 建立不可恢复失败阻塞测试（`workspace_required`、`approval_denied`）与 `maxSteps` 边界测试。

## 6. Main Context 与 Plan 效果测试落地

- [ ] 6.1 建立 context enrich A/B 对照测试（有无 context enrich）。
- [ ] 6.2 建立 context 效果指标计算（成功率、阻塞率、证据有效性）。
- [ ] 6.3 建立 plan 结构合法性与执行链路可观测测试（含关键事件顺序断言）。

## 7. 报告产物与回归门槛

- [ ] 7.1 产出标准化测试报告：`latest.json`（机器可读）与 `latest.md`（人工可读）。
- [ ] 7.2 为四类 suite 配置可调门槛与退化判定规则。
- [ ] 7.3 在测试失败时输出失败分类、退化指标与建议修复入口信息。

## 8. 测试规范文档与 Skill 约束

- [ ] 8.1 在 `doc/` 新增 AI 测试规范文档，覆盖分层测试、目录约定、用例契约与结果输出规则。
- [ ] 8.2 在 `.codex/skills/` 新增 AI 测试 Skill，并要求 AI 测试任务先阅读测试规范文档。
- [ ] 8.3 在 `AGENTS.md` 文档引用章节补充 AI 测试文档入口，保证规范可发现性。

## 9. 验证与收口

- [ ] 9.1 运行 `lint` 与 `typecheck`，修复测试框架接入引发的问题。
- [ ] 9.2 执行至少一轮完整 AI 测试套件，确认四类 suite 可运行并产出报告。
- [ ] 9.3 对齐 OpenSpec 文档与实现范围，确保 proposal/design/specs/tasks 一致。
