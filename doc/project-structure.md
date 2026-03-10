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

- AI 测试统一放在 `tests/ai/**`，并按 `fixtures / harness / suites` 分层。
- capability 用例放在 `tests/ai/suites/capability/**`。
- integration 用例放在 `tests/ai/suites/integration/**`。
- human-live 用例放在 `tests/ai/suites/human-live/**`。
- 结构化测试报告统一输出到 `tests/report/**`。
- 测试环境变量模板放根目录 `.env-example`，本地实际配置放根目录 `.env`。
