## Context

当前测试体系已经具备三类基础资产，但它们彼此之间还没有形成稳定的真相源链路：

- `tests/**` 已经是实际可运行 case 的唯一代码来源，并且多数用例已经内嵌了 `caseId`、`scenarioTags`、`taskGoal/objective`、`requiredFixtures` 等局部 metadata。
- `tests/report/**` 已经积累了结构化报告、批次汇总和 UI 证据，但目录中混有历史 case、重命名后残留目录和一次性汇总文件，不能继续被当作“当前测试全集”。
- `doc/testing/**` 已经拆出了架构、阶段计划和升级日志，但缺少一份清晰定义“测试用例如何进入、保留、降级、废弃”的治理文档，也缺少一个 AI 可直接读取的当前 case catalog。

这次改动是一个跨 `tests/**`、`tests/harness/**`、`tests/report/**`、`scripts/**`、`doc/testing/**` 与 `AGENTS.md` 的横切重构。因为用户明确允许删除与重构，设计可以采用硬切换方式，不为旧目录、旧命名和旧汇总格式保留兼容层。

## Goals / Non-Goals

**Goals:**

- 建立“测试源码 metadata -> 当前 case catalog -> 历史报告产物”的单向真相源链路。
- 为 `main / renderer / e2e` 三类 suite 建立统一的 case metadata 契约，并支持后续 AI 自动枚举当前 case。
- 把测试文档重构成“规则文档”和“生成目录”两类信息，避免手工维护当前 case 清单。
- 为长期保留、覆盖扩展、临时诊断、live 评估、已归档 case 建立统一生命周期与保留分层。
- 让分析脚本、批次脚本和后续 AI 都通过 catalog 识别 current cases，而不是零散扫描 `tests/report/**`。

**Non-Goals:**

- 不在本次设计中扩展新的业务测试能力范围，例如新增更多 Chat、Import、Search 或 AI runtime case。
- 不保留对旧报告目录命名、旧汇总 Markdown 或旧 caseId 的兼容读取。
- 不把 `doc/testing/**` 做成新的 case inventory；文档只描述规则，不重复持有当前测试清单。

## Decisions

### 1. 用“源码声明 + 生成目录”取代“手写清单 + 目录猜测”

决策：

- 当前有效测试用例的唯一真相源是 `tests/**` 中的 case 定义。
- 每个可运行 case 都必须显式声明统一 metadata。
- 通过一个 catalog 生成步骤，把源码 metadata 与 latest report 关联后输出到 `tests/catalog/**`。

生成产物分两层：

- `tests/catalog/current-cases.json`
  - AI 与脚本的 machine-readable 真相源。
- `tests/catalog/current-cases.md`
  - 面向人工快速浏览的投影文件。

catalog 中每条 case 至少包含：

- `suite`
- `caseId`
- `title`
- `description`
- `scenarioTags`
- `taskGoal`
- `expectedOutcome`
- `requiredFixtures`
- `retentionTier`
- `lifecycle`
- `runPolicy`
- `capabilityArea`
- `sourceFile`
- `latestReport`
- `latestStatus`
- `latestRunAt`

选择理由：

- 手工维护清单一定会再次漂移。
- 当前代码里已经有大部分基础 metadata，追加统一约束的成本低于长期维护第二份文档。
- catalog 可以把“当前有效 case”和“历史报告证据”稳定分开，AI 读取顺序会更清晰。

备选方案：

- 继续手工维护 `doc/testing/cases.md`。
  - 放弃原因：很快再次和源码、报告脱节。
- 直接把 `tests/report/**` 当 inventory。
  - 放弃原因：目录天然混入 stale case 与历史汇总，无法表达 active / archived 边界。

### 2. 统一 metadata 契约，并在 suite 入口层强制声明

决策：

- `main`、`renderer`、`e2e` 三类 case 的运行 helper 都要收敛到统一的 metadata 输入。
- 不要求所有 suite 使用完全相同的运行函数，但必须共享同一组 metadata 核心字段和枚举值。
- 缺失 metadata 的 case 视为不合规 case，catalog 生成与 drift 检查必须 fail-fast。

实现边界上，metadata 统一收口到测试 harness 侧的共享类型与 helper，而不是散落在各个 analyzer 里推断。

推荐结构：

- `tests/harness/core/caseMetadata.ts`
  - 定义核心 metadata 类型、枚举与校验。
- `tests/harness/main/**`
  - main suite 入口把 metadata 与运行参数拼装后写入报告。
- `tests/harness/renderer/**`
  - renderer suite 入口复用同一 metadata 核心类型。
- `tests/harness/e2e/**`
  - e2e suite 入口复用同一 metadata 核心类型。

关键枚举建议：

- `retentionTier`
  - `canonical`
  - `coverage`
  - `diagnostic`
  - `live-eval`
  - `archived`
- `lifecycle`
  - `active`
  - `quarantined`
  - `deprecated`
  - `archived`
- `runPolicy`
  - `gating`
  - `non_gating`
  - `manual`
  - `batch_only`

选择理由：

- 统一 metadata 后，新增 case 时就能先回答“为什么保留它”，而不是等文档事后补救。
- 生命周期和保留层级是你想做“长期收敛”的关键，没有这些字段，catalog 只能是文件索引，不能变成治理工具。

备选方案：

- 把治理字段单独放在 `tests/catalog/*.yaml` 手工维护。
  - 放弃原因：还是会形成第二真相源。
- 只要求 `caseId + tags`，其他由分析脚本猜测。
  - 放弃原因：无法稳定区分长期保留 case 与一次性诊断 case。

### 3. 报告目录只表达历史执行，不再承担当前 case inventory

决策：

- `tests/report/**` 继续作为历史执行证据目录保留。
- report contract 增加与 catalog 稳定关联的字段，但不再把“是否存在目录”解释为“当前 case 仍有效”。
- stale case report 目录允许清理、迁移或整组删除；catalog 是 current truth，report 是 historical evidence。

报告消费顺序改为：

1. 读取 `tests/catalog/current-cases.json`
2. 确认 case 当前是否 active / quarantined / archived
3. 再跳转到该 case 的 latest report 或 batch summary

分析器脚本需要同步调整：

- `human-report-analyzer.mjs`
- `human-batch-runner.mjs`
- 其他按 suite 扫描目录推断 case 集的脚本

选择理由：

- 当前 report 目录已经出现 source case 少于 report case 的情况，继续依赖它只会扩大误判。
- 报告应该是证据层，而不是配置层或 inventory 层。

备选方案：

- 给 report 目录增加 tombstone 文件表示废弃。
  - 放弃原因：仍然把 report 目录当配置面，复杂度高且没有必要。
- 保留旧目录并额外做过滤规则。
  - 放弃原因：用户已经明确允许硬切换，不值得继续背兼容债。

### 4. 文档重构为“规则层”和“历史层”，不再承担当前 case 清单

决策：

- `doc/testing/README.md`
  - 只做阅读导航。
- `doc/testing/architecture.md`
  - 只写 suite 分层、harness、报告契约、配置入口。
- `doc/testing/case-governance.md`（新增）
  - 写 metadata、保留层级、生命周期、准入/降级/归档规则、catalog 真相源关系。
- `doc/testing/phased-plan.md`
  - 只写 AI 阶段顺序、门禁、推进条件。
- `doc/testing/upgrade-journal.md`
  - 只写按时间倒序追加的执行历史、风险与推进决策。

必要同步项：

- `doc/README.md`
- `doc/reference/source-of-truth.md`
- `doc/reference/change-checklist.md`
- `AGENTS.md`
- `.codex/skills/testing/SKILL.md`

选择理由：

- 文档最容易漂移的部分不是规则，而是“当前有哪些 case”。把这部分迁出文档后，文档才能长期稳定。
- 现有 `architecture / phased-plan / upgrade-journal` 三分法本身是合理的，缺的是治理文档和 case catalog，不需要把历史记录继续塞回架构文档。

备选方案：

- 保留现有文档结构，只在 `README.md` 新增 case 列表。
  - 放弃原因：仍然会重复维护，并且把导航文档变成内容文档。

### 5. 用硬迁移清理旧 case、旧目录和旧汇总

决策：

- 不建立旧 caseId 到新 caseId 的兼容映射层。
- 以 catalog 生成为分界线，catalog 中不存在的 case 一律视为历史目录或待清理对象。
- 允许一次性删除 stale report 目录、过时 batch 产物、旧汇总 Markdown 与已废弃的测试文件。

迁移过程中的最低要求：

- 删除或归档前，要能从源码和 catalog 判断该 case 已不再 active。
- 对仍有价值但不再 active 的 case，优先标记为 `archived`，而不是继续混在 active case 集里。

选择理由：

- 当前问题本质上就是旧目录、旧名字、旧汇总一直叠加而没有清边界。
- 如果继续保留兼容层，新的 catalog 仍会不断被历史债污染。

备选方案：

- 保留旧目录并在文档中声明“不推荐使用”。
  - 放弃原因：对 AI 没有约束力，仍然会被扫描和误读。

## Risks / Trade-offs

- [Risk] 一次性引入统一 metadata 后，短期内会暴露大量现有 case 缺字段问题
  - Mitigation：先定义最小必填字段和默认枚举，再分 suite 逐步补齐；catalog 生成对缺字段 fail-fast。
- [Risk] 删除 stale 报告目录后，部分历史调查链接会失效
  - Mitigation：把需要长期保留的历史结论转写到 `upgrade-journal.md` 或 batch compare 文档，再删除目录。
- [Risk] `human` 与 `renderer/e2e` 当前 metadata 细节不同，强行统一可能导致 helper 过度抽象
  - Mitigation：统一核心 metadata，保留 suite-specific 扩展字段；只在 catalog 层约束交集字段。
- [Risk] catalog 生成脚本如果过度依赖正则扫描源码，后续重构容易脆弱
  - Mitigation：优先让 case helper 接收显式 metadata 对象，并围绕 helper 入口提取，而不是长期依赖松散源码模式匹配。
- [Risk] 不保兼容意味着当前脚本或人工习惯会在短期内失效
  - Mitigation：在同一 change set 内同时完成 catalog、文档入口、skill、AGENTS 和脚本迁移，避免半新半旧状态。

## Migration Plan

1. 定义统一 metadata 类型、枚举和值域，并让 `main / renderer / e2e` 三类 harness 接受同一核心 metadata。
2. 为当前 active case 补齐 metadata，生成第一版 `tests/catalog/current-cases.json` 与 `tests/catalog/current-cases.md`。
3. 改造报告写入与分析脚本，使其通过 catalog 识别 current cases，并补齐 latest report 关联逻辑。
4. 重构 `doc/testing/**`，新增治理文档，精简导航文档，保留阶段计划与升级日志的单一职责。
5. 清理 stale report 目录、旧汇总文件、废弃 case 文件与失效 caseId。
6. 同步更新 `doc/reference/*`、`AGENTS.md` 与 `.codex/skills/testing/SKILL.md`。

回滚策略：

- 这是一次仓库内的结构重构，不设计运行时灰度。
- 若 catalog 生成或 metadata 收敛过程中发现结构设计错误，应在 change 内直接调整后再进入 implementation，不保留旧结构双写。

## Open Questions

- `current-cases.md` 是否需要完全自动生成，还是允许保留少量人工补充说明。
- `live-eval` 是否单独再细分为 `batch-baseline` 与 `compare-only`，还是先保持一个层级，避免过早复杂化。
