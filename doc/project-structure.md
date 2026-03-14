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
doc/                     # 项目当前文档，全部平铺在根目录
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

- Graph 编排放在 `src/main/services/ai/graph/**`。
- Main 节点放在 `src/main/services/ai/node/main/**`。
- Human 节点放在 `src/main/services/ai/node/human/**`。
- Tool 实现按能力分组放在 `src/main/services/ai/tools/<capability>/**`。
- 运行态 state schema 统一放在 `src/main/services/ai/state/stateSchemas.ts`。

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

## 6. 测试目录规则

- `tests/harness/**` 只放可复用的测试基础设施，不承载旧 suite 治理逻辑或旧 report 契约。
- `tests/fixtures/**` 只放长期复用的输入样本，不混入运行产物。
- `tests/ai/**` 按 `backend` / `e2e` 和能力域拆分，是当前 AI 测试的主目录。
- `tests/kb-search/**` 预留给检索链路测试；`tests/other/**` 仅放临时或待定用例。
- `tests/logs/**` 只放每次运行的原始日志；`tests/report/**` 放事实汇总稿与 Codex 后置分析文档。
- 测试目录统一使用 kebab-case，运行产物不得反向成为测试发现入口。

## 7. 文档目录规则

- `doc/` 下的所有文档都直接放在根目录，不再使用子目录嵌套。
- `doc/README.md` 是默认阅读入口。
- canonical 文档、阅读路径和同步清单都在 `doc/` 根目录维护。
