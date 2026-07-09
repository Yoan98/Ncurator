# NCurator-Desktop Architecture

## 1. 技术栈

### 核心环境

- Runtime: Electron v39
- Language: TypeScript v5
- Build: Electron-Vite v5
- Package Manager: pnpm

### Renderer

- React v19
- React Router DOM v7
- Ant Design v5
- Tailwind CSS v4 + Less

### Main

- LangChain JS
- LangGraph JS
- @huggingface/transformers v3
- SQLite + better-sqlite3
- LanceDB v0.23
- pdf-parse
- mammoth
- @node-rs/jieba

## 2. 整体架构

- 本地优先
  - 文档解析、嵌入、索引、检索和存储都在本地完成
- 存储分层
  - SQLite 是业务真相，保存会话、消息、AI run、审批、文档元数据、网页源、工作区状态和配置
  - LanceDB 只保存可重建的 `vector_chunk` 向量索引
  - SQLite schema 通过 migration 向前演进，LanceDB 向量表可按文档 generation 重建
- 混合检索
  - 同时使用向量搜索和 LanceDB FTS 召回
  - 使用 RRF 融合结果
- 进程分工
  - Renderer 负责 UI 展示与交互
  - Main 负责 AI 编排、数据库访问、资料处理和审阅流程
  - Workspace 文件索引中，Main 负责扫描、SQLite 任务状态、SQLite document 元数据和 LanceDB `vector_chunk` 写入，`worker_threads` 负责文件解析、split 和 embedding
  - Shared 负责 IPC 契约与跨进程共享类型

## 3. 核心模块

- AI Runtime
  - 负责 run 生命周期管理与 `human` 执行入口
- Storage
  - `SqliteCore` 负责 SQLite 连接、PRAGMA 和 migration
  - `LanceDbCore` 只负责 `vector_chunk` 表初始化、搜索和优化
  - 各 `*Store` 负责领域数据访问，业务状态一律写 SQLite
- Retrieval
  - 负责向量检索、全文检索和结果融合
  - 检索前先从 SQLite 读取当前 `document.active_generation_id`，LanceDB 只搜索有效 generation
- Draft Review
  - 负责草稿生成、审阅和最终提交前校验

## 4. 索引一致性

文件和网页索引使用 `generation_id`：

1. SQLite 将 document 标记为 indexing。
2. 写入新 generation 的 LanceDB chunks。
3. 写入成功后切换 SQLite `active_generation_id`。
4. 后台删除旧 generation。
5. 失败时不切换 active generation，旧索引继续可用。

## 5. 主链路

1. Renderer 发起请求
2. Main 根据任务类型进入 AI 或检索流程
3. AI Runtime 调用存储、检索和工具能力完成任务
4. 结果通过 IPC 与事件流回到 Renderer 展示
