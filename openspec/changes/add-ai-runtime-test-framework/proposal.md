## Why

当前 AI 架构已完成主流程搭建，但缺少可复用、可回归、可自动化扩展的测试框架，导致后续能力迭代难以稳定评估。现在需要尽快建立统一测试基线，让 Codex 能持续生成测试用例、执行测试并基于结果给出修复建议。

## What Changes

- 新增 AI 架构测试框架，统一覆盖 `tool`、`human`、`main context enrich`、`plan` 四类效果测试。
- 新增场景化测试用例契约（case/fixture）与执行器（runner），支持批量回归与结果归档。
- 新增测试结果标准输出（结构化 JSON + 可读摘要），为自动修复建议提供稳定输入。
- 新增分层断言能力：契约断言、事件流断言、效果评分断言。
- 明确测试扩展机制，支持后续低成本新增能力族测试而不改主测试框架。
- 新增 `doc/ai-testing.md` 作为测试规范基线，并新增对应 Codex skill，确保 AI 测试任务执行前先读取测试规范。

## Capabilities

### New Capabilities

- `ai-test-harness`: 定义 AI 测试运行器、用例 DSL、夹具注入、结果报告与失败分类标准。
- `ai-runtime-effect-evaluation`: 定义四类 AI 架构效果评测（tool、human、context enrich、plan）的场景与验收指标。

### Modified Capabilities

- 无

## Impact

- 受影响代码：
  - `src/main/services/ai/**`（增加测试入口与可测试性注入点）
  - `src/shared/types.ts`（如需补充测试结果契约类型）
  - `package.json`（新增 AI 测试脚本）
  - 新增测试目录与工件目录（如 `tests/ai/**`、`artifacts/ai-test-results/**`）
  - `doc/ai-testing.md`（测试规范文档）
  - `.codex/skills/ai-testing/SKILL.md`（测试 skill）
- 受影响系统：
  - AI 运行时回归验证流程
  - CI/本地测试执行流程
  - Codex 自动化生成测试与修复建议链路
- 依赖影响：
  - 新增或启用 Node 侧测试依赖（以 Vitest 为主）
