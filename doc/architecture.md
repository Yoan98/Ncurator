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
- LanceDB v0.23
- pdf-parse
- mammoth
- @node-rs/jieba

## 2. 整体架构

- 本地优先
  - 文档解析、嵌入、索引、检索和存储都在本地完成
- 混合检索
  - 同时使用向量搜索和 LanceDB FTS 召回
  - 使用 RRF 融合结果
- 进程分工
  - Renderer 负责 UI 展示与交互
  - Main 负责 AI 编排、数据库访问、资料处理和审阅流程
  - Shared 负责 IPC 契约与跨进程共享类型

## 3. 核心模块

- AI Runtime
  - 负责 run 生命周期管理与 `human` 执行入口
- Storage
  - 负责 LanceDB 连接、表管理和领域数据访问
- Retrieval
  - 负责向量检索、全文检索和结果融合
- Draft Review
  - 负责草稿生成、审阅和最终提交前校验

## 4. 主链路

1. Renderer 发起请求
2. Main 根据任务类型进入 AI 或检索流程
3. AI Runtime 调用存储、检索和工具能力完成任务
4. 结果通过 IPC 与事件流回到 Renderer 展示
