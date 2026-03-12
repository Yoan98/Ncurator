# NCurator-Desktop

**NCurator-Desktop** 是一个本地优先、注重隐私的桌面知识工作台。项目统一承载本地资料准备、混合检索、AI 对话、纯搜索和草稿审阅，不依赖云端文档处理链路。

## 当前能力

- **本地优先**：文档解析、嵌入、检索、索引和数据库存储全部在本机完成。
- **统一工作台**：同一会话中支持 `AI 对话` 与 `纯搜索` 两种模式。
- **混合检索**：基于 LanceDB 向量检索与 LanceDB FTS 全文检索，用 RRF 融合结果。
- **草稿审阅**：AI 编辑默认生成草稿与审阅结果，不在运行阶段直接写回真实文件。
- **范围约束**：支持 workspace、本地资料和网页资料的显式范围选择与审批边界。

## 技术栈

- **Runtime**：Electron v39
- **Frontend**：React 19、React Router DOM 7、Ant Design 5、Tailwind CSS 4、Less
- **AI Runtime**：LangChain JS、LangGraph JS
- **Embedding**：`@huggingface/transformers` v3（本地运行）
- **Storage / Search**：LanceDB v0.23、LanceDB FTS、Apache Arrow
- **Parsing**：`pdf-parse`、`mammoth`

## 架构概览

- **Renderer**：负责工作台 UI、时间线、检查器、审阅中心等展示逻辑。
- **Main**：负责资料准备、数据库访问、AI graph、审批和草稿提交流程。
- **Shared**：负责 IPC 契约、事件和跨进程共享实体。
- **Storage**：统一通过 `StorageService`、`LanceDbCore` 和各 `*Store` 访问 LanceDB。

## 工程文档入口

默认工程入口是 [doc/README.md](/Users/test/work-space/NCurator-Desktop/doc/README.md)。

建议阅读顺序：

1. [doc/README.md](/Users/test/work-space/NCurator-Desktop/doc/README.md)
2. [doc/architecture/README.md](/Users/test/work-space/NCurator-Desktop/doc/architecture/README.md)
3. 按任务进入 AI、数据库、目录规范、测试或类型治理文档

## 快速开始

### 先决条件

- Node.js（推荐 v18+）
- pnpm

### 安装

```bash
pnpm install
```

### 开发

```bash
pnpm dev
```

### 构建

```bash
pnpm build
```

## 许可证

[MIT](LICENSE)
