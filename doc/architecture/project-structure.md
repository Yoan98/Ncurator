# NCurator-Desktop 目录规范

## 1. 目标

- 让文件位置可预测，降低“逻辑散落”和跨层耦合。
- 保证 Main/Renderer/Shared 边界清晰，便于后续扩展与重构。

## 2. 顶层目录职责

```text
src/
  main/                  # Electron Main 进程
    ipc/                 # IPC 注册与桥接入口
    services/            # 业务域服务（AI / storage / model / ingestion / vector / llm）
    utils/               # Main 全局可复用工具（无业务归属的公共逻辑）
    types/               # Main 进程内类型
  preload/               # 预加载层（window.api 暴露）
  renderer/src/          # React 渲染层
    pages/               # 页面级组件
    components/          # 通用组件
    services/            # 前端服务与请求封装
    types/               # 视图模型类型
    utils/               # 前端工具函数
  shared/                # 跨进程共享契约与类型
doc/                     # 项目规则/架构文档
  architecture/          # 当前架构与系统边界
  conventions/           # 工程约定、类型治理、UI 规范
  testing/               # 测试架构、阶段计划与持续汇总
  reference/             # 阅读路径、canonical source、变更清单
.codex/skills/           # 技能定义
tests/                   # 自动化测试（AI 测试等）
.env                     # 本地环境变量（不入库）
.env-example             # 环境变量模板（入库）
```

## 3. Main 目录放置规则

### 3.1 services

- 业务编排、业务状态流转、领域内适配层放在 `src/main/services/**`。
- 按领域拆分目录，不同领域通过清晰接口交互。

### 3.2 utils

- Main 范围复用、与单一业务域弱耦合的公共逻辑放在 `src/main/utils/**`。
- 示例：事件封装、通用循环控制、能力节点共享工具函数。
- 不把强业务语义的流程编排放在 `utils`。

### 3.3 AI 能力目录

- Tool 实现按能力分组放在 `src/main/services/ai/tools/<capability>/`。
- Graph 编排放在 `src/main/services/ai/graph/**`，不内嵌 capability 具体执行细节。
- 运行态 State Schema 统一放在 `src/main/services/ai/state/stateSchemas.ts`。
- 能力间共享且可复用的辅助逻辑，优先抽到 `src/main/utils`。
- AI 运行时事件封装（如 `file_artifact` 事件）放在 `src/main/services/ai/events/**`。
- 纯控制流工具（如 `boundedLoop`）放在 `src/main/utils/**`。

## 4. 测试目录放置规则

- 测试顶层优先按运行边界分为 `tests/main/**`、`tests/renderer/**`、`tests/e2e/**`。
- `tests/main/**` 用于 Main 进程/服务入口测试；建议继续按业务域细分，如 `ai / workspace / storage / web-source`。
- `tests/main/ai/capability/**` 放 AI tool/capability 级测试。
- `tests/main/ai/runtime/**` 放 AI runtime、prompt contract、scope contract 等测试。
- `tests/main/ai/human/**` 放 human 子图真实模型测试。
- `tests/main/<domain>/service/**` 放真实后端业务服务测试。
- `tests/main/<domain>/migration/**` 放迁移与清理边界测试。
- `tests/renderer/**` 放页面/组件 contract 测试，不直接承载完整应用链路。
- `tests/e2e/**` 放完整 Electron 应用链路测试；AI 探索式 UI 测试建议放在 `tests/e2e/<page>/ai-live/**`。
- 共享测试输入优先放在 `tests/fixtures/**`，共享 harness 优先放在 `tests/harness/**`。
- 结构化测试报告统一输出到 `tests/report/**`。
- 测试环境变量模板放根目录 `.env-example`，本地实际配置放根目录 `.env`。
- 测试相关文档统一放在 `doc/testing/**`，默认入口是 `doc/testing/README.md`。

补充说明：
- Main/AI 测试现已统一放入 `tests/main/**`。
- 后续新增测试应继续放入 `tests/main/**`、`tests/renderer/**`、`tests/e2e/**`，不要再引入 `tests/ai/**`。
