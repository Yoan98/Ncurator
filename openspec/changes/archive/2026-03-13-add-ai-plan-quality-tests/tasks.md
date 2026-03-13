## 1. Planner contract 基线

- [x] 1.1 为 `main-ai-runtime` 新增受治理的 planner contract case，覆盖 summary task 泄漏、objective 完整性与非法 planner 输出 fail-fast
- [x] 1.2 为 planner contract case 补齐 selected scope 保真断言，并确保结果通过现有 report/case catalog 链路落盘

## 2. Plan runtime 质量用例

- [x] 2.1 新增受治理的 runtime case，覆盖三步 handoff 链与中途阻塞后仍进入 synthesis 的行为
- [x] 2.2 新增 mixed-scope plan runtime case，验证 objective、交付与 synthesis 保持范围语义
- [x] 2.3 如现有 harness 信号不足，最小化补齐 runtime plan quality 断言所需的测试支撑

## 3. Live 质量采样与治理收口

- [x] 3.1 为 `main-ai-runtime` 增加首个 non-gating/batch-only 的 live plan quality 用例或最小 harness 支撑
- [x] 3.2 更新 `doc/testing/phased-plan.md` 与 `doc/testing/upgrade-journal.md`，补充 plan quality 阶段输入口径与本轮落地记录
- [x] 3.3 运行 plan quality 相关测试、生成 catalog，并回写任务完成状态
