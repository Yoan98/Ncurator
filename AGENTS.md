# NCurator-Desktop（AI 项目规则）

> 说明：本文件用于让 AI在后续生成/修改代码时遵循本项目的约束与约定。

## 1. 技术栈与版本

请严格遵守以下核心库及其版本进行开发，以确保代码兼容性：

### 核心环境

- **Runtime**: Electron **v39**
- **Language**: TypeScript **v5**
- **Build**: Electron-Vite **v5**
- **Package Manager**: pnpm

### 前端 (Renderer)

- **Framework**: React **v19**
- **Routing**: React Router DOM **v7**
- **UI Kit**: Ant Design **v5**
- **Styling**: Tailwind CSS **v4** + Less

### 后端逻辑 (Main Process)

- **Orchestration**: LangChain JS (Core/Community/TextSplitters) + LangGraph JS
- **Embedding**: @huggingface/transformers **v3** (本地运行)
- **Vector DB**: LanceDB **v0.23** (兼作向量搜索与全文搜索)
- **Search Engine**: LanceDB FTS (Native Full-Text Search)
- **Storage**: LanceDB (基于 Apache Arrow)
- **Parsers**: `pdf-parse` (PDF), `mammoth` (DOCX)
- **Tokenization**: `@node-rs/jieba` (中文分词)

## 2. 核心架构

- **本地优先**: 所有文档处理（解析、嵌入、搜索）均在本地完成，不依赖云端 API。
- **混合搜索**:
  1. **召回**: 同时利用 LanceDB 的向量搜索和 FTS 全文搜索。
  2. **排序**: 使用 **RRF (Reciprocal Rank Fusion)** 算法融合结果。
- **进程模型**:
  - **Main**: 负责繁重的计算（解析、嵌入、数据库操作）。
  - **Renderer**: 仅负责 UI 展示，通过 IPC 通信。

## 3. 文档引用

当涉及到数据库时，请阅读 `doc/database.md`
当涉及到 AI 架构（LangGraph 运行图、能力节点、事件流、工作区沙箱）时，请阅读 `doc/ai-architecture.md`
当涉及到 UI 样式时，请阅读 `doc/ui-style.md`

### 数据库操作约束（Main Process）

- 数据库表结构与索引以 `src/main/services/storage/core/LanceDbCore.ts` 的 `getTableConfigs()` 为准
- 业务代码不要直接操作 LanceDB 连接/表；新增/修改数据库行为优先通过 `src/main/services/storage/StorageService.ts` 暴露的各 `*Store`

## 4. Type 分类与存放位置

- **共享契约类型（跨进程）**：统一存放在 `src/shared/types.ts`（或 `src/shared/types/*`）。
  - 包含 IPC request/response、事件、跨进程共享实体。
  - Renderer 与 Main 共享的数据结构必须从这里导出，禁止在两侧重复定义同名业务类型。
- **Main 进程内部运行态类型**：存放在 `src/main/**/types.ts`。
  - 仅用于 Main 内部编排/运行时状态，不得反向复制到 shared。
- **Renderer 视图类型（ViewModel）**：存放在 `src/renderer/src/**/types.ts`。
  - 仅用于展示态/组件态，不得作为 IPC 契约真相来源。
- **Preload API 类型**：
  - `window.api` 的类型应以 preload 导出的类型为单一来源，避免在 `preload` 和 `renderer global.d.ts` 双份漂移维护。
- **外部边界解码类型**：
  - 数据库原始行、LLM 输出、`JSON.parse` 结果等边界输入的收敛类型，放在对应领域的 `adapters/codec/decoder` 模块中，避免散落在业务逻辑中。

## 5. TypeScript `any` / `unknown` 使用规范

- 禁止使用 `any` 与 `unknown`


## 6. UI/UX 注意事项

- **禁用 Modal.confirm**: 由于兼容性问题，项目中禁止使用 `Modal.confirm`、`Modal.info` 等静态方法。请使用 ContextHolder 方式或者自定义组件替代。
- **全局提示**: 涉及全局状态（如模型下载提示）的通知，应使用全局组件（如悬浮组件）在 `App.tsx` 或 `MainLayout` 中统一处理，避免在每个页面重复逻辑。
