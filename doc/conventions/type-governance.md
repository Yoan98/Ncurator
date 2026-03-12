# NCurator-Desktop 类型治理

## 1. 目标

- 保持 Main / Renderer / Shared 的类型边界清晰
- 避免跨层重复定义业务类型
- 对数据库行、LLM 输出和 JSON 解析结果做边界收敛

## 2. 类型放置规则

- **共享契约类型（跨进程）**
  - 放在 `src/shared/types.ts` 或 `src/shared/types/*`
- **Main 内部运行态类型**
  - 放在 `src/main/**/types.ts`
- **Renderer 视图类型（ViewModel）**
  - 放在 `src/renderer/src/**/types.ts`
- **Preload API 类型**
  - 以 preload 导出的类型为单一来源
- **外部边界解码类型**
  - 放在对应领域的 `adapters/codec/decoder` 模块

## 3. 强约束

- 禁止使用 `any`
- 禁止使用 `unknown`
- Renderer 与 Main 共享的数据结构必须从 shared 导出
- 不把 Renderer 展示态类型当成 IPC 契约真相源
