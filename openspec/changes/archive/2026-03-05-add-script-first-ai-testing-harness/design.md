## Context

当前项目已具备 `docx/terminal/local_kb_retrieval` 工具能力与 `human graph` 运行链路，但缺少可复用、可回放、可比较的自动化测试体系。现状问题是测试依赖人工操作，且难以保证“测试调用的是生产代码”这一关键约束。  
本次设计聚焦两个方向：  
1. capability 按 tool 粒度测试（一个 tool 一个测试用例）；  
2. human 子图真实运行测试（不经过 main graph，使用真实模型配置）。  

约束条件：
- 不做 E2E；
- 不引入 DSL，采用脚本优先；
- 测试必须直接调用生产入口，不复制业务逻辑；
- 每个测试用例需要明确前置动作（如 docx fixture 放置）；
- 输出结果需支持后续 AI 自动分析与优化建议生成。

## Goals / Non-Goals

**Goals:**
- 建立脚本式测试框架（Vitest + Main 测试 harness），支持 capability 与 human 两类测试套件。
- 对 capability 实现 tool 级用例模型，支持 docx 工具链、terminal 工具、kb 检索工具的独立与组合验证。
- 对 human 实现 live 测试模型，验证“渐进式解决问题”能力（失败恢复、策略切换、完成收敛）。
- 定义统一测试输入规范（fixture/workspace/config）与统一输出规范（events/assertions/metrics/summary）。
- 让后续与 Codex 的对话可以持续补充新用例，而无需重建框架。

**Non-Goals:**
- 不覆盖 Renderer/UI 流程与端到端自动化。
- 不重构生产运行时主链路（main graph/human graph/capability 实现）。
- 不在本次引入新的业务能力（仅围绕测试架构建设）。

## Decisions

### 1) 采用 Vitest 作为统一脚本测试执行框架

**Decision**
- 使用 Vitest 承载所有 AI 测试脚本与断言执行；
- 测试入口按 suite 分层：`capability` 与 `human-live`；
- 每次运行产物落地到 `artifacts/ai-test-results/<suite>/<case>/<timestamp>/`。

**Rationale**
- Vitest 与 TypeScript 兼容性高，脚本可读性与调试体验稳定；
- 便于后续由 Codex 自动生成/补充测试用例文件。

**Alternatives considered**
- 自定义 DSL：对复杂逻辑（分支、审批、事件序列）表达能力不足，维护成本高。
- Playwright/E2E-first：不符合当前“先分离测试”的目标。

### 2) 引入 Main 测试 Harness，但只做注入和编排，不承载业务逻辑

**Decision**
- 增加测试 harness 统一提供：
  - 测试 run 上下文构造；
  - 事件采集；
  - approval 策略注入；
  - workspace 与 fixture 生命周期管理；
  - 报告写盘；
- Harness 只调用生产代码入口，不实现业务替代逻辑。

**Rationale**
- 统一基础设施可降低每个测试用例的样板代码；
- 能保证测试行为可复用、可审计、可对比。

**Alternatives considered**
- 每个用例自行拼装上下文：重复代码多，规范难统一，输出格式容易漂移。

### 3) Capability 测试直接调用生产 tool 入口，强制“一个 tool 一个用例”

**Decision**
- capability 用例直接调用生产入口：
  - `buildDocxCapabilityTools`
  - `buildTerminalCapabilityTools`
  - `buildRetrievalTools`
- 每个 tool 至少一个独立测试用例；组合流程单独作为集成用例；
- 用例结构固定为 `setup -> run -> assert`。

**Rationale**
- 直接验证生产逻辑，避免“测试通过但线上失败”的逻辑偏差；
- 一 tool 一用例更利于定位故障与增量扩展。

**Alternatives considered**
- 通过 mock 包装工具层：会掩盖真实路径问题（事件、边界、审批、产物）。

### 4) Human live 测试只跑 human graph，并使用真实 LLM 配置

**Decision**
- human 测试直接调用 `createHumanGraphRunner`；
- 不经过 main graph，以便聚焦单任务执行质量；
- 采用真实模型配置（`base_url/model_name/api_key`）运行；
- approval 策略可配置（`auto-approve` 或 `deny-on-risk`）以覆盖不同场景。

**Rationale**
- 目标是评估 human 的渐进决策能力，而非主流程编排；
- 与生产人机执行路径一致，结果更具参考价值。

**Alternatives considered**
- 使用 mock model：无法验证真实模型波动下的策略切换与收敛能力。

### 5) 固定 fixture 前置动作与目录契约，避免“测试环境不确定”

**Decision**
- 约定 fixture 输入目录（例如 `tests/fixtures/docx/`、`tests/fixtures/workspace/`）；
- 每个测试用例声明所需输入文件与目标 workspace；
- runner 在执行前完成 fixture 校验，不满足则直接 fail-fast 并输出缺失清单；
- docx 类用例必须显式声明源文件路径与输出路径策略。

**Rationale**
- 用户可明确知道执行前要准备哪些文件；
- 保证测试可重复与可移植。

**Alternatives considered**
- 隐式自动生成全部输入：与真实业务文档差距大，降低测试价值。

### 6) 定义统一报告契约，面向 AI 二次分析

**Decision**
- 每个 case 输出以下文件：
  - `events.jsonl`：完整事件流；
  - `assertions.json`：断言结果与证据；
  - `metrics.json`：步骤数、失败码、耗时、产物统计；
  - `summary.md`：结论、疑似根因、建议方向；
- 报告字段包含固定分析键：`failure_category`、`suspected_root_cause`、`optimization_hints`。

**Rationale**
- 结构化输出可直接喂给 AI 做问题归因和改进建议；
- 便于跨版本对比和回归监控。

**Alternatives considered**
- 仅控制台文本输出：不利于后续自动化分析与持续积累。

## Risks / Trade-offs

- [Risk] live 模型测试存在随机性，结果可能波动  
  -> Mitigation: 区分 `deterministic` 与 `live` 套件，live 用例支持多次运行与统计阈值判定。

- [Risk] fixture 缺失导致大量“无效失败”  
  -> Mitigation: 执行前统一做 fixture 校验并输出缺失文件清单。

- [Risk] 测试直接调用生产代码，失败影响定位复杂  
  -> Mitigation: 强制输出完整事件流与断言证据，按 tool/case 维度隔离报告。

- [Risk] 引入测试 harness 后出现与生产环境差异  
  -> Mitigation: harness 仅做上下文注入与采集，不重写业务逻辑；关键入口与生产保持同源调用。

## Migration Plan

1. 搭建 Vitest 测试入口与测试 harness 基础模块（上下文、事件采集、workspace/fixture、报告器）。
2. 先落地 capability 基线用例（首个 docx tool 用例），验证“直接调用生产代码 + 报告输出”链路。
3. 落地 human live 基线用例（单目标任务），验证真实 LLM 配置接入与评估指标输出。
4. 增加 fixture 校验与执行前检查机制，明确“用户必须提前准备的文件”反馈。
5. 逐步扩展更多 tool 用例与 human 任务用例，形成可持续新增能力。

Rollback strategy:
- 若新框架不稳定，可仅保留测试入口与报告结构，暂时下线 live suite；
- 若 harness 设计不满足需求，可回滚到最小脚本执行方案，但保持测试调用生产入口这一约束不变。

## Open Questions

- fixture 目录是否需要区分“团队共享样例”与“用户本地私有样例”两套路径？
- human live 用例的通过阈值采用单次判定，还是采用 N 次运行通过率判定？
- live 测试中的审批策略是否默认全自动放行，还是按用例声明风险级别？
- 是否需要在报告中增加“与上次运行对比”字段，作为 AI 建议优先级依据？
