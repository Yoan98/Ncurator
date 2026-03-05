## 1. 测试框架与目录基建

- [x] 1.1 新增 AI 测试专用 Vitest 配置与执行入口（区分 capability 与 human-live 套件）。
- [x] 1.2 建立测试目录骨架（suite、fixtures、reports）并与 `artifacts/ai-test-results` 对齐。
- [x] 1.3 增加测试运行命令与参数约定（单用例执行、按 suite 执行、输出目录覆盖策略）。

## 2. Main 测试 Harness 基础能力

- [x] 2.1 实现测试上下文工厂（runId、workspace、selectedDocumentIds、取消信号、审批策略注入）。
- [x] 2.2 实现事件采集器，统一收集 `tool_call`、`human_step`、`terminal_step`、`file_artifact` 等事件。
- [x] 2.3 实现 workspace 生命周期管理（临时目录创建、清理、路径隔离）。
- [x] 2.4 实现 fixture 校验器，执行前校验输入文件并在缺失时 fail-fast 输出缺失清单。

## 3. Capability Tool Suite（生产入口直连）

- [x] 3.1 建立 capability 用例基类流程（`setup -> run -> assert`）与公共断言工具。
- [x] 3.2 接入 docx 生产工具入口调用链，确保测试不复刻业务逻辑。
- [x] 3.3 实现首个 docx tool 用例（例如 `docx_apply_ops replace_text`）并断言编辑结果有效。
- [x] 3.4 实现 capability 用例结果分组输出（按 tool/case 独立通过失败状态）。

## 4. Human Live Suite（仅 human 子图）

- [x] 4.1 建立 human-live 用例执行器，直接调用 human graph runner（不经 main graph）。
- [x] 4.2 实现 live LLM 配置装载与校验（`base_url/model_name/api_key` 缺失即 fail-fast）。
- [x] 4.3 实现首个 human live 用例（读取 workspace 信息并生成或编辑 docx）。
- [x] 4.4 为 human live 用例实现审批策略注入（自动通过/风险拒绝）并验证阻塞路径。

## 5. 统一报告与 AI 分析输入契约

- [x] 5.1 输出标准化 `events.jsonl`（可按 runId/caseId 关联回放）。
- [x] 5.2 输出标准化 `assertions.json`（断言结果、失败证据、定位信息）。
- [x] 5.3 输出标准化 `metrics.json`（步骤数、失败码、耗时、工具调用与产物统计）。
- [x] 5.4 输出标准化 `summary.md`（结论、疑似根因、优化建议方向）。
- [x] 5.5 在报告中补齐 AI 分析键（`failure_category`、`suspected_root_cause`、`optimization_hints`）。

## 6. Fixture 与执行前置说明

- [x] 6.1 明确 docx 与 workspace 输入文件的约定目录与命名规则。
- [x] 6.2 在运行器输出中增加“执行前你需要准备什么”的清单提示。
- [x] 6.3 补充示例 fixture 与用例映射说明，便于后续与 Codex 对话扩展用例。

## 7. 验证与回归

- [x] 7.1 验证 capability 首个用例可重复执行，且报告结构稳定一致。
- [ ] 7.2 验证 human 首个 live 用例可执行，且可输出渐进式行为证据。
- [x] 7.3 验证缺失 fixture、缺失 LLM 配置、审批拒绝三类失败路径输出可读且可定位。
- [x] 7.4 执行 `pnpm lint` 与 `pnpm typecheck`，确认新增测试框架与类型契约一致。

## 8. 交付与后续扩展点

- [x] 8.1 交付首批可运行模板（1 个 capability 用例 + 1 个 human live 用例）。
- [x] 8.2 形成“新增一个 tool 测试用例”的最小操作说明（仅新增脚本，不改框架）。
- [x] 8.3 形成“新增一个 human live 任务用例”的最小操作说明（仅新增脚本，不改框架）。
