# NCurator-Desktop 目录规范

## 1. 目标

- 让文件位置可预测，减少跨层耦合和逻辑散落。
- 保持 `Main / Renderer / Shared` 边界清晰。
- 让工程文档、测试与代码目录都能快速找到对应入口。

## 2. 顶层目录职责

```text
src/
  main/                  # Electron Main 进程
  preload/               # 预加载层
  renderer/src/          # React 渲染层
  shared/                # 跨进程共享契约与类型
doc/                     # 项目当前文档，canonical 文档默认放在根目录
.codex/skills/           # 技能定义
tests/                   # 自动化测试
.env                     # 本地环境变量（不入库）
.env-example             # 环境变量模板
```

## 3. `src/main` 放置规则

### `services/`

- 业务编排、领域服务、领域适配层放在 `src/main/services/**`。
- 不同领域按目录拆分，通过清晰接口交互。

### `utils/`

- 放 Main 侧全局复用、但不属于某个单一业务域的公共逻辑。
- 不把强业务语义的编排流程放到 `utils`。

### AI 目录

- AI 运行入口与中性基础设施放在 `src/main/services/ai/*` 根目录。
- run state 与 run 级收口逻辑放在 `src/main/services/ai/run/**`。
- 会话记忆更新逻辑与记忆 prompt 放在 `src/main/services/ai/memory/**`。
- AI 级别通用 helper 放在 `src/main/services/ai/utils/**`。
- Human graph、memory、node、prompts、state、tools 放在 `src/main/services/ai/human/**`。
- `shared/**` 只放 Human 跨阶段共享逻辑。
- `memory/**` 放 stable memory patch、history prompt builder，以及与 `roundHistory / loadedHistoryContext` 相关的共用逻辑。
- `node/brainNode/**` 放推理、决策 contract 和脑节点特有逻辑。
- `node/learningNode/**` 放 skill 详情加载与学习态更新。
- `node/handNode/**` 放工具调用执行、`toolUsePlan` 校验与 `watchHint` 生成。
- `node/mouthNode/**` 放最终交付生成与结果收口。
- `node/utils/**` 只放少量跨 node 共用、且无单一归属的中性逻辑。
- `prompts/**` 放 `human` 的 `brain` / `mouth` 提示词，以及 `watchHint` 渲染等少量共享 prompt 片段。
- Tool 实现按实现域归位放在 `src/main/services/ai/human/tools/**`，例如 `docx/**`、`kb/**`、`terminal/**`、`internal/**`。
- `skills.ts` 与 `tools/registry.ts` 负责维护 builtin/external skill 与 tool 的映射；skill 级筛选或装配逻辑放在 registry / loader，不要求给每个 skill 单独建目录。
- Docx 审阅相关服务放在 `src/main/services/ai/human/tools/docx/review/**`。
- Human 的运行态 state schema 放在 `src/main/services/ai/human/state/schema.ts`。

## 4. `src/renderer` 放置规则

- 页面级组件放 `pages/**`。
- 通用组件放 `components/**`。
- 前端服务与请求封装放 `services/**`。
- 仅 Renderer 使用的展示态类型放 `types/**`。
- 通用前端工具放 `utils/**`。

## 5. `src/shared` 放置规则

- IPC request/response
- 运行事件
- 跨进程共享实体

凡是 Main 与 Renderer 都会消费的数据结构，必须从 `src/shared/**` 导出，不能在两侧各自重复维护。

- 只给 `main`、`ai`、`human` 单侧使用的类型与常量，不要放进 `src/shared/**`。

## 6. 测试目录规则

- `tests/harness/**` 只放可复用的测试基础设施，不承载旧 suite 治理逻辑或旧分析文档契约。
- `tests/fixtures/**` 只放长期复用的输入样本，不混入运行产物。
- `tests/ai/**` 只放 AI formal tests。
- `tests/unit/**` 放长期保留、但不进入 formal test-plan 的 unit / helper / schema / prompt 类测试。
- `tests/workbench/**` 按 workbench PRD 模块组织正式测试。
- `tests/settings/**` 按 settings PRD 模块组织正式测试。
- `tests/kb-search/**` 预留给检索链路测试；`tests/temp/**` 仅放按需临时排查用例。
- `tests/logs/**` 只放每次运行的原始日志；raw logs 之外不再维护测试专用正式分析目录。
- 测试目录统一使用 kebab-case，运行产物不得反向成为测试发现入口。

## 7. 文档目录规则

- `doc/` 下的 canonical 文档默认直接放在根目录。
- 文档阅读路径默认由 `AGENTS.md` 维护。
- canonical 文档、阅读路径和同步清单都在 `doc/` 根目录维护。
- `doc/ai-design/` 用于 AI 总体架构、实现规范、数据契约与数据流转、skill 设计、prompt 设计，以及未来重构规划。
- `doc/prd/` 用于按产品模块维护用户可见功能规格与验收标准，例如 `workbench.md` 与 `settings.md`。
- 用户可见功能行为变更时，应优先同步 `doc/prd/**`，再同步代码实现与测试。
- `doc/test-plan/` 用于维护各类测试计划文档。
- 测试计划按测试域与产品面拆分，例如 `doc/test-plan/ai-test.md`、`doc/test-plan/workbench-test.md`、`doc/test-plan/settings-test.md`。
- 长期维护的正式测试用例，必须先在 `doc/test-plan/**` 中定义，再落到 `tests/**` 正式目录。
