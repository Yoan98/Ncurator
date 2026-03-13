## 1. 统一 metadata 契约

- [x] 1.1 在 `tests/harness` 下新增共享的 case metadata 类型、枚举和值域校验，覆盖 `retentionTier`、`lifecycle`、`runPolicy`、`capabilityArea` 等治理字段
- [x] 1.2 改造 `tests/harness/main/**` 的 case 入口，使 capability、runtime、human 用例都通过统一 metadata 输入声明必填治理字段
- [x] 1.3 改造 `tests/harness/renderer/**` 与 `tests/harness/e2e/**` 的 case 入口，使 renderer / e2e / ai-live 用例复用同一套核心 metadata 契约

## 2. 补齐当前 active case 的 metadata

- [x] 2.1 盘点当前 `tests/main/**` 下的 active case，并补齐 `description`、治理字段与能力归属，消除仅靠局部常量推断 metadata 的写法
- [x] 2.2 盘点当前 `tests/renderer/**` 与 `tests/e2e/**` 下的 active case，并补齐门禁角色、保留层级与运行策略
- [x] 2.3 为 catalog 生成增加 fail-fast 校验，确保缺失 metadata、重复 `caseId` 或非法枚举值时直接报错

## 3. 建立 catalog 真相源

- [x] 3.1 新增 catalog 生成脚本，基于当前测试源码输出 `tests/catalog/current-cases.json`
- [x] 3.2 基于同一份 catalog 数据生成 `tests/catalog/current-cases.md`，用于人工快速浏览
- [x] 3.3 在 catalog 中补齐 latest report、latest status、latest run time 等关联字段，并明确 active / archived / quarantined 的过滤结果

## 4. 调整报告契约与分析脚本

- [x] 4.1 调整报告写入与读取辅助逻辑，确保报告只承担历史执行证据职责，不再被当作当前 case inventory
- [x] 4.2 改造 `human-report-analyzer.mjs`、`human-batch-runner.mjs` 等现有脚本，使其通过 catalog 识别当前 human case 集
- [x] 4.3 排查其他通过目录扫描推断当前 case 集的测试脚本与汇总逻辑，统一切换到 catalog 输入

## 5. 重构测试文档与全局入口

- [x] 5.1 重构 `doc/testing/README.md` 与 `doc/testing/architecture.md`，移除手工 case 清单职责，保留架构与阅读导航
- [x] 5.2 新增 `doc/testing/case-governance.md`，定义 metadata、保留层级、生命周期、准入/降级/归档规则和 catalog 真相源关系
- [x] 5.3 更新 `doc/testing/phased-plan.md` 与 `doc/testing/upgrade-journal.md` 的引用方式，确保它们明确依赖 catalog 而不是报告目录推断当前 case 集
- [x] 5.4 同步更新 `doc/README.md`、`doc/reference/source-of-truth.md`、`doc/reference/change-checklist.md`、`AGENTS.md` 与 `.codex/skills/testing/SKILL.md`

## 6. 清理旧结构并完成验收

- [x] 6.1 根据 catalog 清理 stale report 目录、过时汇总文件、废弃 caseId 与失效测试文件，不保留旧路径兼容层
- [x] 6.2 为需要保留历史价值但不再 active 的 case 建立明确的 `archived` 或 `deprecated` 状态，而不是继续混入当前 case 集
- [x] 6.3 运行 catalog 生成、关键分析脚本与相关测试命令，验证 `proposal / design / specs` 中定义的新真相源链路已经闭合
