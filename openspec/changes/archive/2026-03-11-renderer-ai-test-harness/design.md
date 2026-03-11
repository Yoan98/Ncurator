## Context

现有测试架构已经形成明确边界，且 Main/AI 用例已经迁移到新的顶层目录：

- `tests/main/ai/capability/**`：生产 tool 直连；
- `tests/main/ai/runtime/**`：Main/运行时跨模块链路；
- `tests/main/ai/human-live/**`：真实 human 子图；
- `tests/main/workspace/**`：workspace service / migration 领域测试。

但 renderer 的主要复杂度不在“单个函数是否正确”，而在以下组合面：

- preload API 调用与事件订阅；
- React 页面状态机与多面板联动；
- `approval_required / workspace_required / artifact / retrieval` 等运行时事件在 UI 上的映射；
- Electron 壳层下的真实行为，例如 `openPath`、`revealPath`、窗口启动、HashRouter 路由切换。

长期看，测试顶层更适合按运行边界拆为：

```text
tests/main      -> 直接打主进程/服务入口
tests/renderer  -> 直接打页面/组件入口
tests/e2e       -> 从用户入口打完整应用链路
```

在这个顶层之下，renderer 与完整应用链路再继续拆成：

```text
renderer contract   -> 快速、可控、确定性高
e2e deterministic   -> 真实 Electron，覆盖关键用户链路
e2e ai-live         -> AI 自主探索，非阻塞诊断
```

## Goals / Non-Goals

**Goals**

- 将测试顶层语言统一为 `main / renderer / e2e`，并让实际目录、脚本与报告命名保持一致。
- 让 renderer suite 继续产出统一报告契约，供后续 AI 读取失败断言、UI 证据并执行修复。
- 优先覆盖 `ChatPage` 的关键运行时交互，再逐步扩展到 `ImportPage`、`SearchPage` 等页面。
- 明确哪些测试属于确定性回归，哪些属于非阻塞 AI 探索，避免把不稳定 live 套件放入主门禁。

**Non-Goals**

- 不在本次直接实现具体测试脚本或依赖安装。
- 不要求将所有 renderer 页面一次性纳入 e2e。
- 不引入与现有报告体系完全割裂的另一套测试平台。
- 不把 renderer 测试写成与 preload 契约脱节的 ad-hoc 浏览器脚本。

## Decisions

### 1) 顶层按 `main / renderer / e2e` 分层，弱化 `integration` 这种模糊主目录名

**Decision**

新增目标测试根目录：

```text
tests/
  fixtures/
    main/
    renderer/
    e2e/
  harness/
    main/
    renderer/
    e2e/
  main/
    ai/
      capability/
      runtime/
      human-live/
    workspace/
      service/
      migration/
  renderer/
    chat/
      contract/
    import/
      contract/
    search/
      contract/
  e2e/
    chat/
      deterministic/
      ai-live/
    import/
      deterministic/
    search/
      deterministic/
  report/
    main-ai-capability/
    main-ai-runtime/
    main-ai-human-live/
    renderer-chat-contract/
    e2e-chat/
    e2e-chat-ai-live/
```

**Rationale**

- 顶层先回答“从哪一层入口打进去”，比长期使用 `integration` 这类模糊目录名更清楚。
- `tests/main/**`、`tests/renderer/**`、`tests/e2e/**` 可以清晰区分主进程、页面状态机和完整应用链路。
- `tests/report/**` 仍统一归档，便于 AI 横向消费。

### 2) `tests/main/**` 继续按业务域细分，避免退回到模糊的 `tests/ai/**` 平铺结构

**Decision**

- Main/AI 测试统一放入 `tests/main/ai/**`；
- 原本统称为 `integration` 的测试，应按真实业务域或语义重新命名，例如：
  - `tests/main/ai/runtime/**`
  - `tests/main/workspace/service/**`
  - `tests/main/workspace/migration/**`

**Rationale**

- `integration` 更像测试性质描述，不适合作为长期主目录。
- 目录应让人一眼知道“这是 AI runtime 还是 workspace migration”。

### 3) `renderer contract` 使用 `Vitest + jsdom + React Testing Library`

**Decision**

- `tests/renderer/**` 使用 `Vitest` 作为 runner；
- 环境默认使用 `jsdom`；
- 组件/页面交互使用 `React Testing Library` 和 `@testing-library/user-event`；
- 配合受控的 `DesktopApi` stub、脚本化事件回放器和路由/组件挂载工具；
- 目标是验证 renderer 页面在确定输入下的状态变迁、按钮使能、面板切换、错误提示和 IPC 调用参数；
- 该层不覆盖真实窗口生命周期、原生 shell 行为和 Electron 启动链路。

**Rationale**

- `ChatPage`、`ImportPage` 这类页面含有大量事件驱动逻辑，全部依赖 e2e 会导致运行慢且定位困难；
- preload API 已集中在 `src/preload/api.ts`，适合生成类型安全的 stub；
- 这层失败后，AI 更容易根据结构化断言和组件状态快照直接修改 renderer 逻辑。
- 相比直接上重型浏览器方案，`Vitest + jsdom + RTL` 与现有测试体系更一致，调试成本更低。

**Representative flows**

- Chat 页面在收到 `tool_call_result / human_step / file_artifact` 后右侧面板更新；
- `approval_required` 到达后，UI 显示可操作按钮并调用 `aiRunApprovalDecide`；
- `workspace_required` 到达后，UI 进入补充工作区流程；
- Import 页面加载失败、创建工作区、扫描/准备成功与失败的状态反馈。

补充约束：
- `Vitest Browser Mode` 可作为少数真实浏览器能力 case 的补充，不作为默认路线。

### 4) `e2e deterministic` 使用 `Playwright (Electron)` 负责真实 Electron 关键链路

**Decision**

- `tests/e2e/**` 使用 `Playwright` 的 Electron 自动化能力启动真实 Electron 应用；
- 使用真实 preload 与 renderer；
- 仅对关键用户链路做端到端回归，不追求把所有页面状态都搬到 e2e；
- 首批聚焦以下链路：
  1. Chat 启动一次 AI run，并渲染计划、步骤、右侧结果面板与产物区；
  2. Chat 命中 `approval_required` 后的 approve/deny 交互；
  3. Chat 命中 `workspace_required` 后的补充工作区流程；
  4. Import 页的 workspace create / scan / prepare 主链路；
  5. Search 页的 source scope 选择与结果展示。

**Rationale**

- 这些链路最接近真实用户价值，也是后续让 AI 自动修复最值得投入的回归面；
- 真实 Electron 能验证 preload 暴露、HashRouter 路由、AntD 交互与事件消费是否协同正常；
- 如果这层也采用统一报告，失败可直接反馈给 AI。
- `Playwright` 原生支持 trace、screenshot 等取证能力，适合后续 AI 读取失败证据后修复。

### 5) `e2e ai-live` 作为可选非阻塞套件，用于 AI 闭环修复

**Decision**

- `tests/e2e/<page>/ai-live/**` 建立在同一套 `Playwright (Electron)` e2e harness 之上，但执行模式是 AI 驱动探索而非固定脚本；
- 该 suite 默认不进入主 CI gate，可在本地或 nightly 运行；
- 它的输入不是“任意乱点”，而是带目标和限制的任务，例如：
  - “在聊天页触发一次审批并观察是否可继续执行”
  - “从 Import 页面创建工作区并完成一次 prepare”

**Rationale**

- AI 探索式 UI 测试存在天然波动，不适合作为主门禁；
- 但它对发现状态机缺陷、竞态和文案/按钮流转问题很有价值；
- 只有当它也输出结构化报告与 UI 证据时，AI 才能基于失败结果做有效修复。

### 6) 报告契约继续统一，但允许 renderer / e2e suite 附加 UI 证据

**Decision**

- renderer / e2e suite 继续输出：
  - `events.jsonl`
  - `assertions.json`
  - `metrics.json`
  - `signals.json`
  - `summary.md`
- 在此基础上允许附加：
  - `screenshots/*.png`
  - `trace/trace.zip`
  - `console.jsonl`
  - `dom/*.html`
  - `artifacts.json`

**Rationale**

- 这样 AI 不需要学习第二套报告协议；
- `metrics/signals` 仍负责横向对比，UI 附件负责定位细节；
- 对于 renderer 测试，仅有断言不够，必须保留失败时的可视和 DOM 证据。

**Additional signals**

renderer suite 的 `signals.json` 需要扩展可选字段，例如：

- `routeSequence`
- `userActionSequence`
- `ipcInvokeSequence`
- `selectorFailures`
- `consoleErrorCount`
- `screenshotRefs`

### 7) 为关键 renderer 交互补 automation contract，而不是让测试依赖脆弱文案

**Decision**

- 对 Chat/Import/Search 关键交互点建立稳定 selector 约束；
- 优先使用聚焦业务动作的 `data-testid` 或等价可定位属性，而不是依赖 AntD 内部 DOM 结构；
- selector 定义集中于 `tests/harness/renderer/selectors/**` 或等价位置，页面实现仅负责暴露稳定标识。

**Rationale**

- 当前 renderer 中大量反馈依赖文案与 AntD 结构，e2e 稳定性会比较差；
- 没有稳定 selector，AI 修复也很难做到“读报告 -> 精准定位交互点”；
- selector 应成为 UI 自动化契约的一部分，而不是测试代码的偶然实现细节。

## Directory and File Conventions

推荐目录与职责如下：

```text
tests/
  fixtures/
    main/
    renderer/
    e2e/
  harness/
    main/
    renderer/
      mount/
      selectors/
      events/
    e2e/
      electron/
      report/
      ai-live/
  main/
    ai/
      capability/
      runtime/
      human-live/
    workspace/
      service/
      migration/
  renderer/
    chat/
      contract/
        chat.approval-flow.test.ts
        chat.workspace-required.test.ts
        chat.right-panel-events.test.ts
    import/
      contract/
        import.workspace-create-feedback.test.ts
    search/
      contract/
        search.scope-selection.test.ts
  e2e/
    chat/
      deterministic/
        chat.plan-and-artifact.e2e.test.ts
        chat.approval-required.e2e.test.ts
        chat.workspace-required.e2e.test.ts
      ai-live/
        chat.approval-exploration.live.test.ts
        chat.workspace-recovery.live.test.ts
    import/
      deterministic/
        import.workspace-sync.e2e.test.ts
    search/
      deterministic/
        search.scope-results.e2e.test.ts
```

命名规则：

- renderer contract: `<page>.<flow>.test.ts`
- e2e deterministic: `<page>.<flow>.e2e.test.ts`
- e2e ai-live: `<page>.<goal>.live.test.ts`

## Migration Plan

### Phase 1: 目录与报告基建

- 建立 `tests/main/**`、`tests/renderer/**`、`tests/e2e/**` 目标目录骨架与独立说明；
- 新增 renderer / e2e 的 Vitest 入口与命令；
- 扩展 `tests/report/**` 以支持新的主目录命名；
- 为报告器增加 UI 附件写盘能力。

### Phase 2: Chat 关键路径优先

- 落地 `tests/renderer/chat/contract/**` 的 Chat 页面事件消费测试；
- 落地 `tests/e2e/chat/deterministic/**` 的 Chat 三条关键路径：
  - plan + artifact 渲染
  - approval required
  - workspace required
- 同步补齐 Chat 页所需稳定 selector。

### Phase 3: Import / Search 基线路径

- 添加 Import 的 workspace create / scan / prepare e2e；
- 添加 Search 的 source scope 选择与结果展示 e2e；
- 增补相应 fixture 与 IPC 脚本。

### Phase 4: AI 探索式 renderer 测试

- 将 AI 测试接入真实 renderer harness；
- 约束其为非阻塞运行，重点产出诊断证据；
- 形成“失败报告 -> AI 读取报告 -> 修复 -> 回归”的闭环操作说明。

## Risks / Trade-offs

- [Risk] 真实 Electron e2e 启动慢，回归成本上升  
  -> Mitigation: 用 renderer contract 覆盖高频状态机回归，e2e 只保留关键主链路。

- [Risk] AntD DOM 结构变动导致 selector 脆弱  
  -> Mitigation: 明确 automation selector 契约，避免依赖内部 className 或文案结构。

- [Risk] `e2e ai-live` 波动大，影响门禁稳定性  
  -> Mitigation: 默认非阻塞，只作为诊断与修复辅助，不替代确定性 suite。

- [Risk] 报告扩展后结构过于分裂  
  -> Mitigation: 保持核心五件套不变，UI 证据作为附加文件和可选 signal 字段。

## Documentation Updates

本次变更完成后，至少需要同步以下文档：

- `doc/test/architecture.md`
  - 补 `tests/main/**`、`tests/renderer/**`、`tests/e2e/**` 分层与执行命令
  - 补 main / renderer / e2e 三层职责边界
  - 补 UI 证据文件说明与 AI 使用建议
- `doc/project-structure.md`
  - 将 `tests/main/**`、`tests/renderer/**`、`tests/e2e/**` 纳入顶层测试目录规范
  - 说明 `tests/main/**`、`tests/renderer/**`、`tests/e2e/**` 与报告命名、脚本入口的映射
- `doc/test/architecture.md`
  - 作为唯一测试规范真相来源，补充当前目录如何映射到未来 `tests/main/ai/**`
  - 合并整体测试目录说明、main/renderer/e2e 边界、技术选型与迁移说明
