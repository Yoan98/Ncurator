# Human Harness

human graph 的消息与上下文设计约束。修改 `src/main/services/ai/human/**` 的 graph、消息写入、投影、compaction、resume、brain 上下文时必读。

---

## 1. Graph 流转

human graph 是单次 AI run 的 LangGraph 编排；**每轮调主模型前必过 `context_budget`**。节点只通过 `AiRunContext.appendMessageLog` 写 transcript，通过 `HumanRuntimeCache.messages` 维护 brain 侧运行时消息序。

### 1.1 流转图

```mermaid
flowchart TD
  START([START]) --> CB[context_budget]
  CB -->|超预算且可压缩| CC[context_compaction]
  CB -->|继续| BR[brain]
  CC --> CB
  BR -->|无 tool_calls| FD[finalizeDelivery → END]
  BR -->|有 tool_calls| DP[dispatch]
  DP -->|learn_skill| LN[learning]
  DP -->|update_plan| PN[plan]
  DP -->|其余工具| HN[hand]
  LN --> CB
  PN --> CB
  HN --> CB
```

**循环主干**：`context_budget → brain → dispatch → (learning | plan | hand) → context_budget`。

### 1.2 节点职责

原则：**谁产出事实，谁写对应 log**（详见第 2.2 节「写入分工」）。

| 节点 | 调模型 | 写 log | 改 runtime cache |
|------|--------|--------|------------------|
| `context_budget` | 否 | 首次进 brain 时写 `user` | 判定 compaction；不拼消息 |
| `context_compaction` | 是（压缩模型） | `compaction_checkpoint` | **整段替换** messages（第 5 节） |
| `brain` | 是（主模型） | `thinking_*`；**仅当有 `toolCalls`（或截断 / 内容安全）时写 `assistant`** | 有 tool 时 append assistant；**不** refresh build user |
| `dispatch` | 否 | 否 | 消费 `tool_calls` 队列，路由下一 stage |
| `learning` | 否 | `learning_*` + `tool` + **`skill_state_updated`** | 加载 skill 工具；**不**改 build user |
| `plan` | 否 | `tool` + `plan_updated` | 更新 state.plan；**不**改 build user |
| `hand` | 否 | `tool`（+ 可选 `images[]`）+ 审批后 `approval_batch_resolved` | append ToolMessage；`read_image` 后 append 多模态 HumanMessage |

交付收尾由 brain 内的 `finalizeDelivery` 完成（**不是**独立图节点）：docx/ppt 落盘 side effect → `finalizing_started` → **写交付 `assistant`（`toolCalls: []`）** → completed。
无 `tool_calls` 的正常交付路径上，**brain 不向 log 写 `assistant`**（流式 Answer 只走事件 / `partial_answer`）。

### 1.3 dispatch 路由

`dispatch` 是 **`tool_calls` 队列的唯一消费者**，严格按模型返回顺序处理：

| `toolName` | 目标节点 | 批处理 |
|------------|----------|--------|
| `learn_skill` | `learning` | 单次仅处理队首一条 |
| `update_plan` | `plan` | 连续同类 call 合并一批 |
| 其余 | `hand` | 连续同类 call 合并一批 |

`learning` / `plan` / `hand` 执行完后：`stage → context_budget`（不是直接回 brain）。
`brain` 在 schema 校验前对全部 call 做 `normalizeToolCallArgs`；`learn_skill` / `update_plan` 的参数校验由各节点负责。

### 1.4 启动与 cache 初始化

新 run 启动时：

1. 读该伙伴 `chat_session_message_log` → `projectMessageLogRecords` 先切最后一次 `context_cleared`，再得 tail + plan + checkpoint。
2. 拼 runtime messages：`[System] + projectBrainMessagesFromLog(...)`（第 6 节：多条 build user + interleaved tail）。
3. `graph.invoke` 从 `context_budget` 进入循环。

### 1.5 runtime cache 要点

| 字段 | 用途 |
|------|------|
| `messages` | brain 请求的 LangChain 消息序 |
| `currentUserMessageIndex` | 当前 run 的 build user 下标（同 run refresh；resume 时为末尾） |
| `currentUserLogAppended` | 本 run 是否已写 log `user` |
| `messageLogRecords` | 启动时快照；compaction 后刷新 |
| `lastBrainInputTokens` | 预算估算；compaction 后需 fresh usage |

---

## 2. 数据源

human harness 涉及的数据从哪来、到哪去。只有 **`chat_session_message_log`** 是 transcript 真相源（表名保留，行挂 `partner_id`）；其余存储与运行时注入见各小节。

### 2.1 总览

数据源写入与消费方总览见 [`doc/architecture.md`](../architecture.md) 「AI 运行时」「AI 数据源与消费方」。

- **伙伴消息记录**走 human harness。Composer 已删除搜索模式；不存在 `chat_search_turn`。
- **实现**：UI 对话轮次由 `chat_session_message_log` + `ai_run` 投影；技能由 `skill_state_updated` annotation 投影。

### 2.2 Transcript：`chat_session_message_log`

append-only 伙伴消息转录；模型上下文、UI、resume 均由此投影。Compaction 与 resume **只读、不改**已有行。

**表字段**

| 列 | 含义 |
|----|------|
| `partner_id` | 所属伙伴 |
| `run_id` | 写入时所属 AI run |
| `seq` | 伙伴内单调递增；checkpoint / 投影按 `seq` |
| `entry_json` | `ChatMessageLogEntry` |
| `created_at` | 写入时间 |

**写入入口**：graph 节点 → `AiRunContext.appendMessageLog` → `ChatMessageLogStore.appendBatch`（同 batch 内 `seq` 连续分配）。

#### 四种 `kind`

| `kind` | 存什么 | 谁写 |
|--------|--------|------|
| `user` | 用户原文 + `context` | **仅** `context_budget`（首次进 brain） |
| `assistant` | 文本 + `toolCalls[]`（交付另含 `linkAccess`） | **brain**（过程决策 / 截断 / 内容安全 fallback）或 **`finalizeDelivery`**（正常交付）；**同一轮交付正文不叠写** |
| `tool` | 工具反馈正文 + 可选 `images[]` | **`hand` / `plan` / `learning`**（执行结果；不写 assistant） |
| `annotation` | 过程与状态事件 | 见下表 |

#### `annotation` 事件

| `eventType` | `payload` | 投影用途 |
|-------------|-----------|----------|
| `thinking_started` / `thinking_completed` | `{}` | UI 过程层 |
| `learning_started` / `learning_completed` | `{ skillId }` | UI 过程层 |
| `skill_state_updated` | `{ learnedSkillIds: string[] }` | compact / resume 时写入 `<active_state>` 技能（**取最新一条**）；同 run 只驱动 bindTools |
| `plan_updated` | `{ plan: [{ title, status }] }` | compact / resume 时写入 `<active_state>` 计划 + UI 计划条 |
| `brain_user_snapshot` | `{ text: string }` | 当前 build user **最后一次发给模型的原文**；resume 还原历史 build user（取该 `user` 之后、下一条 `user` 之前的**最后一条**） |
| `compaction_checkpoint` | 见示例 | brain `<compacted_history>` + UI 压缩层 |
| `context_cleared` | `{}` | 切断点：投影只保留其后的行；切断前 checkpoint / 技能 / 计划不进下一轮 brain |
| `finalizing_started` | `{}` | 投影时**清空** plan |
| `approval_batch_resolved` | `{ batchId, items: [{ toolCallId, toolName, command, commandExplanation?, action, message? }] }` | UI Activity：走过审批的工具行图标 / 悬停揭示文案；`hand` 在审批决策后写入 |

#### `entry_json` 示例

**`user`** — 审计用，保存当轮 Composer 快照；brain **不直接**消费此条目（见第 2.5 节、第 3 节）。

```json
{
  "kind": "user",
  "content": "帮我把上周周报模板复制一份，填好本周内容。",
  "context": {
    "selectedReferences": [
      {
        "kind": "file",
        "name": "周报模板.docx",
        "absolutePath": "/Users/me/workspace/周报模板.docx",
        "kbAvailability": "indexed",
        "kbDocumentIds": ["doc-abc"]
      }
    ],
    "attachments": []
  }
}
```

**`assistant`（过程）** — brain 在有 `toolCalls` 时写入；`toolCalls` 非空。

```json
{
  "kind": "assistant",
  "content": "我先读取模板结构，再写入本周内容。",
  "toolCalls": [
    {
      "id": "call_01",
      "name": "learn_skill",
      "args": { "skillIds": ["docx-read"] }
    }
  ]
}
```

**`assistant`（交付）** — 仅 `finalizeDelivery`（或内容安全 fallback）写入；`toolCalls` 为空数组；正常交付含 `linkAccess` sidecar（不改写 `content`）。

```json
{
  "kind": "assistant",
  "content": "结论见 [周报模板](/Users/me/workspace/周报模板.docx)。",
  "toolCalls": [],
  "linkAccess": [
    {
      "href": "/Users/me/workspace/周报模板.docx",
      "resourceType": "file",
      "accessStatus": "accessible"
    }
  ]
}
```

**`tool`** — 模型可见的工具结果文本；图片只存 ref，不存 Base64。

```json
{
  "kind": "tool",
  "toolCallId": "call_02",
  "toolName": "docx_read_nodes",
  "ok": true,
  "content": "<file path=\"/Users/me/workspace/周报模板.docx\">…</file>",
  "images": [
    {
      "path": "/Users/me/AppData/Roaming/ncurator/partners/{id}/runtime/assets/read_image-cache/abc…-v1.webp",
      "mimeType": "image/webp",
      "sizeBytes": 81920,
      "width": 800,
      "height": 600
    }
  ]
}
```

**`annotation` 示例**

```json
{ "kind": "annotation", "eventType": "skill_state_updated", "payload": { "learnedSkillIds": ["docx-read", "docx-write"] } }
```

```json
{ "kind": "annotation", "eventType": "brain_user_snapshot", "payload": { "text": "<user_context>…</user_context>" } }
```

```json
{
  "kind": "annotation",
  "eventType": "plan_updated",
  "payload": {
    "plan": [
      { "title": "读取模板与上周周报", "status": "done" },
      { "title": "写入本周周报并落盘", "status": "todo" }
    ]
  }
}
```

```json
{
  "kind": "annotation",
  "eventType": "compaction_checkpoint",
  "payload": {
    "compactBlockId": "550e8400-e29b-41d4-a716-446655440000",
    "summary": "已完成模板读取与首轮 docx 编辑…",
    "coveredThroughSeq": 42,
    "sourceMessageCount": 18
  }
}
```

#### 写入分工与闭环

按「谁产出事实，谁写」落库；**禁止**为对称在多个节点重复写同一语义正文（尤其正常交付不得 brain + `finalizeDelivery` 各写一条空 `toolCalls` 的 `assistant`，否则续跑会出现连续重复 AI）。

| 节点 / 步骤 | 写入 `kind` / `eventType` | 说明 |
|-------------|---------------------------|------|
| `context_budget` | `user` | 本轮首次进 brain 时写；brain **不**写 `user`。若首轮先 compaction，则 compaction 返回后再写 |
| `brain`（有 tool_calls） | `thinking_started` → `assistant`（含 `toolCalls`）→ `thinking_completed` | 固化主模型过程决策；须在 hand/plan/learning **之前**落库 |
| `brain`（正常交付） | `thinking_started` → `thinking_completed` | **不**写 log `assistant`；Answer 草稿仅事件 / `partial_answer` |
| `brain`（截断） | 半截 `assistant` | `finish_reason=length`：先写再失败，可 resume |
| `brain`（内容安全） | `assistant`（`toolCalls: []`） | fallback 交付；走 `completeDelivery`，**不**再经 `finalizeDelivery` 叠写 |
| `dispatch` → `learning` | `learning_started` → `tool`（`learn_skill`）→ `learning_completed` → **`skill_state_updated`** | 成功写完整 `learnedSkillIds`；重复学习 / 失败只写 `tool` |
| `dispatch` → `plan` | `tool`（`update_plan`）+ `plan_updated` | 参数合法时同批写；**不**写 assistant |
| `dispatch` → `hand` | `tool`（+ 可选 `images[]`） | 每个 call 一条；审批拒绝写失败 `tool`；**不**写 assistant |
| `context_compaction` | `compaction_checkpoint` | 压缩摘要落库 |
| `finalizeDelivery` | `finalizing_started` → `assistant`（`toolCalls: []` + `linkAccess`） | 正常交付正文的**唯一** writer（落盘与链接访问检查之后）；清空 plan 投影 |

```text
用户发送
  → context_budget ──→ user（首次进 brain）
  → brain
       ├─ 有 tool_calls ──→ thinking_* + assistant(toolCalls)
       │     → dispatch → learning / plan / hand ──→ tool + annotation
       │     → context_budget → brain（循环）
       └─ 无 tool_calls ──→ thinking_*（不写 assistant）
             → finalizeDelivery ──→ finalizing_started + assistant（交付）
  → context_compaction ──→ compaction_checkpoint（预算触发时，插在进 brain 前）
```

同一次 `appendMessageLog([…])` 可 batch 多条（如 `plan` 的 `tool` + `plan_updated`），共享连续 `seq`。

### 2.3 Run 编排：`ai_run`

单次 AI run 的生命周期与 UI 运行态；**不是 transcript**，不参与 brain 上下文投影。

| 字段（要点） | 用途 |
|--------------|------|
| `status` | `running` / `waiting_approval` / `completed` / `failed` / `cancelled` |
| `input` | 本轮用户输入原文 |
| `partial_answer` / `partial_answer_role` | 流式 UI 草稿；**不参与** resume 与下次 brain |
| `final_answer` / `error` / `failure_code` | 终态展示（`process_interrupted` / `output_truncated` / `input_too_long` 等） |
| `pending_approval` | 等待批量审批 |
| `artifacts` | run 级产物引用（Workbench 展示） |
| `selectedReferences` / `attachments` | run 创建时 Composer 快照（与 log `user.context` 对应） |

**写入**：`ChatRunService` 创建/更新 run。
**读取**：Renderer 伙伴 snapshot、`activeRuns`、审批 UI。
**与 log 关系**：同一 `run_id` 关联 log 行；resume 时新建 run，读**该伙伴** log 投影（先切 `context_cleared`）。

### 2.4 文件域：`ai_file_change`

工具写文件产生的修改记录与 diff artifact；服务 Workbench 预览、红绿 diff、回退。

| 字段（要点） | 用途 |
|--------------|------|
| `run_id` / `partner_id` | 归属 |
| `path` / `fileName` / `operation` | 文件身份与操作类型 |
| `capability` | `text_file` / `docx` / `ppt` / `terminal_tool` 等 |
| `status` | `applied` / `failed` / `reverted` 等 |
| `changeCount` / `insertCount` / `deleteCount` | 改动统计 |
| `previewArtifactHash` 等 | diff 预览对象 |

**不进 brain prompt**；工具结果摘要已在 log 的 `tool.content` 中。
**run 失败不丢记录**：已 `applied` 的修改保持，供 Workbench 展示与回退。

### 2.5 运行时注入（不进库）

新 run 的 `<reference_scope>` 来自 **Composer 当前 `@` 引用与附件**，由 `buildBrainUserMessage` 渲染进 build user。工作地址列表不进 `reference_scope`，由系统提示词按设置页现表渲染。

| | log 里的 `user.context` | Composer → build user |
|--|-------------------------|------------------------|
| 作用 | 审计「当时用户说了什么、配了什么」 | 驱动**当前 run** brain 输入 |
| 同 run | 首条 build user 的 `<reference_scope>` | 来自发送时 Composer（仅 `@` 与附件） |
| resume | 每条 log `user` 各存各的 snapshot | **append** 新 build user 在末尾；`<reference_scope>` 用**当前** Composer |

同伙伴续跑：历史 build user 与 tail **不改写**；新诉求在**末尾**新 build user 的 `<task_goal>`（第 6 节）。清空临时记忆后（`context_cleared`）下次发送没有旧 assistant/tool，也没有旧 `compacted_history`。


---

## 3. 投影设计

只投影 **`chat_session_message_log`**。log 里的 `user` **不直接**作为 HumanMessage 发给 model；brain 永远消费 **build 后的 user**。

投影入口：`projectMessageLogRecords(records)` → `{ messages, plan, checkpoint }`。先找到最后一次 `context_cleared`，只投影其后的行，再跑现有 compaction（算法不改）。graph 再拼 System、build user 与 runtime cache。
Compaction / Resume / 前缀缓存 → 见第 4–6 节。

```mermaid
flowchart TD
  Log[(chat_session_message_log)]

  Log --> PM[projectMessageLogRecords]

  PM --> Tail[tail: assistant / tool]
  PM --> Meta[checkpoint / plan / skill 状态]

  Tail --> BrainMsg[Brain messages]
  Meta --> BuildUser[build user 块]
  BuildUser --> BrainMsg
  Sys[System prompt] --> BrainMsg

  Log --> ByRun[按 run_id 聚合]
  ByRun --> Bubbles[用户气泡 + 交付 assistant]

  Log --> ProcessScan[单 run 扫描]
  ProcessScan --> Process[过程层: Thought / tool / learning / compaction]

  Run[(ai_run)] -.不进 brain.-> Status[status / error / partial_answer]
  FC[(ai_file_change)] -.不进 brain.-> Diff[文件 diff UI]
```

### 3.1 投影产物

| 产物 | 消费方 | 规则 |
|------|--------|------|
| Brain messages | 主模型 | 第 3.2–3.3 节；第 4 节缓存；第 5–6 节 边界事件 |
| UI 对话轮次 | Renderer | 按 `run_id` 聚合 log 中的 `user` + 交付 `assistant` |
| UI 过程层 | Renderer | 单 run 的 log → `projectProcessGroups`（第 3.4 节） |
| 历史 user 审计 | UI / 测试 | log 中 `user` 条目（含 `context` 快照） |

### 3.2 Brain messages 标准形态

发给模型的消息由 **System + 若干 build user + tail（assistant/tool）** 组成；**log 裸 `user` 不得直接进入**。

**同 run 内（稳态）**——单条 build user 紧跟 System，tail 在其后：

```text
[System]
[User built]          ← 本 run 的 task_goal；plan/skill 更新时原地 refresh
[Assistant / Tool …]  tail（只许末尾 append）
```

**跨 run resume**——在**已有整段历史末尾**再 append 一条新的 build user；**不替换、不改写**前面的 build user 与 tail（第 6 节）。

```text
[System]
[User built]          ← run-1 的 task_goal（保持不变）
[Assistant / Tool …]  run-1 过程 + 更早历史
[User built]          ← run-2 续发，append 在末尾
```

| 段 | 含义 |
|----|------|
| System | 系统提示 |
| User built（首条） | 该 run 首次 user 诉求；同 run 内**不 refresh**；无 `<active_state>` |
| tail | assistant / tool / 多模态合成 HumanMessage |
| User built（续发） | 仅 resume / 新 run 时 **append 在整段末尾**；含最新 `<active_state>` |

**build user 块**（各字段来源见第 3.3 节）：

```text
<user_context>
  <task_goal>…</task_goal>
  <preference>…</preference>
  <reference_scope>…</reference_scope>
  <current_time>…</current_time>
  <compacted_history>…</compacted_history>   ← 仅 compaction 后
  <active_state>…</active_state>             ← 仅 compaction / resume（新 run）
</user_context>
```

**稳态行为**（同 run、未触发 第 5–6 节）：

- 首次 brain：`[System, User built]`（无 `<active_state>`），tail 为空；写入 `brain_user_snapshot`。
- brain → 工具 → 再 brain：tail 末尾 append；**当前 build user 一字不改**（技能/计划只在 tool 结果与 `bindTools` 中可见）。
- 前缀 `[System, User built, …已发送 tail]` 字节序不变 → 第 4 节缓存命中。System **跨 run 稳定**（无 `current_time`）。

### 3.3 稳态投影规则

从 log 投影 tail 与 build user 状态块的通用算法（compaction / resume 的重建见第 5–6 节）。

**tail（assistant / tool）**

1. 取该伙伴 log，按 `seq` 排序；先丢弃最后一次 `context_cleared` 及其之前的行。
2. 若有 checkpoint，只保留 `seq > coveredThroughSeq` 的行。
3. 丢弃 `kind=user` 与所有 `annotation`。
4. `assistant` → AIMessage；`tool` → ToolMessage。
5. `tool.images[]` 非空 → 在该 tool 后合成多模态 HumanMessage（第 3.5 节）。
6. `repairInterruptedToolCalls`：每个 AIMessage 的 `tool_call_id` 若无对应 ToolMessage，插入
   `Error: The run was interrupted before this tool call could be executed.`

**checkpoint 与摘要**：最新 `compaction_checkpoint` 的摘要**只**进 build user 的 `<compacted_history>`，不与 tail 重复（第 5 节写入规则）。

**build user 各块**

| 块 | 来源 |
|----|------|
| `<task_goal>` | 当前 run `input` |
| `<preference>` | 当前 run Composer |
| `<reference_scope>` | 当前 run Composer 的 `@` 与附件（第 2.5 节）；工作地址在 System |
| `<current_time>` | 当前 run `runStartedAt`（**只写当前 build user**；历史冻结文本不再改） |
| `<compacted_history>` | 最新 `compaction_checkpoint.summary`（无则省略；**仅 compact 后**） |
| `<active_state>` | **仅 compact / resume**：最新 `skill_state_updated` + 最后 `plan_updated`（`finalizing_started` 清空）。同 run 稳态不写。 |

annotation 扫描只用 `context_cleared` **之后**的 log；切断前 checkpoint / 技能 / 计划不进下一轮 brain。tail 用 checkpoint **截断后**的行。
历史 build user：**禁止**从 log `user` 重算；必须用该 user 之后最后一条 `brain_user_snapshot.text`。

**组装**

- **同 run 首次 brain**：`[System] + [User built]`（无 active_state）+ tail（可空）。
- **同 run 后续 brain**：build user 不变；tail append。
- **compaction**：重建当前 User built，写入 `<compacted_history>` + `<active_state>`。
- **resume 新 run**：`[System] + [冻结 User built₁] + …history tail… + [新 User built₂（含 active_state）]`（见第 6 节）。
- **`context_cleared` 之后下次发送**：`[System] + [新 User built]`，没有旧 assistant/tool，也没有旧 `compacted_history`。

**同 run 刷新**：固定首条 `currentUserMessageIndex`；compaction 整段替换见第 5 节。

**投影不做的事**：log 裸 `user`、`ai_run.partial_answer`、`ai_file_change` 不进 brain。

### 3.4 UI 投影

UI **不读** `ai_run.partial_answer` 作历史；对话与过程均从 log 投影。AI 伙伴气泡由 `projectAiConversationMessages` 生成。不存在搜索模式轮次。

#### 对话轮次（按 run 切分）

| UI 元素 | log 来源 | 规则 |
|---------|----------|------|
| 用户气泡 | `kind=user`，按 `run_id` | 展示 `content` + `context`（`@` 引用、附件） |
| 助手气泡 | 该 run 最后一条交付 `assistant`（`toolCalls: []`） | 经 `finalizeDelivery` 写入；展示 Markdown 正文 |
| 运行态 / 错误 | `ai_run` | `status`、`error`、`failure_code`、审批、流式草稿 |
| 文件改动 | `ai_file_change` | Workbench diff / 回退；不进对话正文 |

同一伙伴多 run：按 `run_id` + `seq` 排序；resume 产生新 run，用户可见**多条** user 气泡，对应 brain 侧多条 build user（第 6 节）。

#### 过程层（单 run）

`projectProcessGroups({ runId, records })` 扫描**该 run** 的 log 记录（使用 `seq` / `createdAt` 保证顺序与时间基）：

| log 信号 | UI 过程组 |
|----------|-----------|
| `thinking_started` … `thinking_completed` 之间的 `assistant` | Thought 文本流（`processThoughts`） |
| `compaction_checkpoint` | compaction 组（单独成行） |
| `tool`（排除 `update_plan`；**含** `learn_skill`） | tool 组；展示 toolName + 入参 snapshot；两次 Thought 之间在 UI 合并为 Activity 面板 |
| `plan_updated` | 计划条（非过程组；run snapshot 扫描 annotation） |
| `finalizing_started` | 清空计划条（不渲染过程层） |
| `learning_started` / `learning_completed` | 仅 harness / 状态注解；**不**投影为独立学习过程组 |

`update_plan` **不出** tool 过程组。`learn_skill` 与其它工具一样进入 Activity。

Live 运行中的 Thought 由 `assistant_process_thought` 事件写入 `processThoughts`（不依赖中途重投影 log）；凡 brain 本轮有正文且带 tool_calls（含全部不可执行），都必须发出该事件，避免流式缓冲被下一轮清空后正文从 UI 消失。伙伴恢复时再由 log 投影补齐。

#### 流式与终态

- brain 流式：`assistant_brain_stream_*` 事件；收到 tool 分片后归类为 Thought。
- 无 tool_calls 且流正常关闭 → Answer，触发 `finalizeDelivery`。
- 网络中断等：草稿仅 `ai_run.partial_answer`；**不进 log、不参与 resume**（第 6.5 节）。

### 3.5 多模态投影

图片**不进 ToolMessage**；log 的 `tool.images[]` 只存路径引用，brain 请求前再投影。

#### 写入（hand / read_image）

1. 工具执行成功 → `buildModelToolResultDelivery` 得文本 → 写 log `tool`（`content` + 可选 `images[]`）。
2. runtime cache：`ToolMessage` + 若有多图 → **紧随其后** `createImageReferenceMessage(images)`（合成 HumanMessage）。
3. `read_image`：本地源按 SHA-256 缓存为 `userData/partners/{id}/runtime/assets/read_image-cache/<hash>-v1.webp`；log 存缓存路径 ref。

#### 读路径（发给主模型）

`projectMessagesForMainModel(messages)` 在每次 brain 请求前执行：

1. 扫描含 `ncurator-image-ref:` 的多模态 HumanMessage。
2. 本地路径 → 临时读盘转 `data:` URL；`http(s)` 保留原 URL。
3. **配额裁剪**（减少前缀抖动）：
   - 最多保留 **600** 张 inline 图；
   - 本地 data URL 估算体积最多 **20 MiB**；
   - 数量超限：从最旧起按 ≥20 张批次 evict；
   - 体积超限：一次至少释放 10 MiB。
4. 被 evict 的位置保留文本占位，提示可再调 `read_image`。

log 投影 tail 时：`tool.images[]` 在对应 ToolMessage **之后** flush 为多模态 HumanMessage（与 runtime 一致）。

#### 约束摘要

| 项 | 值 |
|----|-----|
| `read_image` 单次 | 1–10 路径 |
| 源图上限 | 20 MiB / 8192 边 / 6400 万像素 |
| 请求图上限 | 64 万像素 / 1 MiB（webp 转换后） |
| ToolMessage 携带图片 | **不支持**；必须合成 HumanMessage |

---

## 4. 前缀缓存

主模型 provider 的前缀缓存要求：**多次请求中，已发送的前缀字节序一致**。
human harness 通过 **tail 只 append、resume 只 append 新 build user（历史 build user 取 `brain_user_snapshot` 冻结原文）、System 不含易变时间** 满足这一点。

### 4.1 什么算「前缀」

一次 brain 请求里，**本轮新内容之前**的全部消息，例如：

```text
[System] + [User built₁] + … + tail 已发送段 + （resume 时已有的 User built₂ 之前）
```

- System 跨 run **字节稳定**（platform / paths / 技能目录；**不含** `current_time`）。
- tail 只许 **末尾 append** assistant/tool。
- 同 run 内：**不改** 当前 build user；`<current_time>` 取本 run `runStartedAt`。
- resume：**append** 新 build user 在整段末尾；历史 build user / tail **一字不改**（来自冻结 snapshot，禁止重算）。

### 4.2 稳态下如何保持命中

| 操作 | 对前缀的影响 |
|------|--------------|
| brain → hand → 再 brain | 已发送段不变；tail 末尾 append；当前 build user 不变 |
| `update_plan` / `learn_skill` | 只改 state + tool 结果 + bindTools；**不改** build user |
| **resume** | 历史段 **不变**（冻结 snapshot）；末尾 **append** 新 build user（第 6 节） |

### 4.3 打破前缀缓存的操作

仅 **Compaction**（第 5 节）改写已建立的前缀：摘要写入 `<compacted_history>`，当前 user 写入当时的 `<active_state>`，tail 截断重建。

**resume / learn_skill / update_plan 不属于打破**：resume 只在末尾追加；同 run 内技能与计划不改写 user。
设计约束：除 compaction 外，不得 rewrite 已发送的 build user 与 tail；resume 不得从 log `user` 重拼可变块。

---

## 5. Compaction

同 run 内、进入 brain 前，因上下文预算触发的压缩。遵循第 3.2 节标准顺序；执行后 **整段替换** runtime messages，并 **打破第 4 节前缀缓存**。

### 5.1 触发

`context_budget` 节点判定（默认窗口 200k token）：

- 估计上下文 token > 窗口 × **80%**。
- 存在可压缩过程历史；可压缩段 ≥ 窗口 × **10%**。
- 仅 build user 自身超窗 → `input_too_long`，不 compaction、不写 log user。
- 无 LLM usage 返回时不触发（`llm_usage_unavailable`）。

### 5.2 压缩范围

- **纳入**：最后一条 AI **之前**的全部 assistant + tool。
- **保留 tail**：最后一条 AI **及其后**全部 tool 结果。
- **不压**：System、build user。

### 5.3 执行

1. 可压缩段 → compaction 模型 → 摘要。
2. log append `compaction_checkpoint`。
3. 整段替换：`[System, User built(compacted_history=摘要, active_state=当时技能/计划), …tail]`。
4. 写入 `brain_user_snapshot`；回到 `context_budget` → brain。

### 5.4 示例

压缩前：

```text
[System]
[User built]
[Assistant]  …
[Tool]       …
[Assistant]  …          ← 最后一条 AI
[Tool]       …
```

压缩后：

```text
[System]
[User built]   <current_time>…</current_time>
               <compacted_history>摘要…</compacted_history>
               <active_state>当时技能/计划</active_state>
[Assistant]    保留的最后一条 AI
[Tool]         其 tool 结果
```

log 行 append-only 保留；被覆盖段不再进入 tail。

---

## 6. Resume 机制

上一 run 未正常完成；用户在同伙伴 **继续发送消息**。不自动重试 failed run，**新建 run**，在**已有 brain 历史末尾 append 新 build user**。

### 6.1 触发

用户停止、网络错误、超时、`process_interrupted`（重启）、`output_truncated`、`runtime_limit`、其他失败。
重启：`failInterruptedRuns` 标记活动 run，不自动调模型。

### 6.2 核心规则

1. **log**：append 新 `user` 行在转录末尾（含 Composer `context` 快照）。
2. **brain**：在**已有** `[System, 冻结 User built₁, …tail…]` **末尾 append** `User built₂`（新 run 的 input + Composer + 最新 active_state + 本 run `current_time`）；**不替换** `User built₁`，**不改写**中间 tail。
3. 历史 `User built₁` = 该 `user` 之后最后一条 `brain_user_snapshot.text`（**禁止** `FromLogEntry` 式重算）。
4. 新诉求只出现在 **末尾** 那条 build user 的 `<task_goal>`；仍走 `buildBrainUserMessage`，不是裸 HumanMessage。
5. 符合 第 4 节：历史前缀不变 → 缓存可命中；打破仅 compaction。
6. **tools**：`bindTools` 按该伙伴切断点之后最新 `learnedSkillIds` 重绑（与 `User built₂` 的 `<active_state>` 技能对齐），不是冻住进程内 tool 对象。

### 6.3 示例

**续跑前**（run-1 中断后，该伙伴已有 log；brain 侧最后一轮发给模型的形态）：

```text
[System]                 ← 无 current_time
[User built]   task_goal=帮我把上周周报模板复制一份，填好本周内容
               （含 current_time；无 active_state，除非本 run 已经 compaction）
[Assistant]    …（含未闭合 tool_calls 时由 repair 补 ToolMessage）
[Tool]         …
[Tool]         Error: The run was interrupted…
```

**续跑后**（用户发送「继续把周报写完」；log 末尾多一条 `user`；brain **append** 新 build user）：

```text
[System]                 ← 与续跑前一致
[User built]   …         ← 冻结 snapshot 原文，不替换、不重算
[Assistant]    …
[Tool]         …
[Tool]         Error: The run was interrupted…
[User built]   task_goal=继续把周报写完                  ← append；reference_scope=当前 Composer
               current_time=本 run；compacted_history=…（若有）；active_state=最新技能/计划
```

log 侧（示意）：

```text
seq …  user      content=帮我把上周周报…
seq …  brain_user_snapshot  text=<user_context>…</user_context>   ← 最后发送原文
seq …  assistant / tool / …
seq N  user      content=继续把周报写完    context=当前 Composer   ← 新 append
```

### 6.4 构建步骤

1. 从 log 投影已有 tail（checkpoint 截断 + repair）。
2. 还原续跑前的历史 build user：每条可见 `user` → 对应最后一条 `brain_user_snapshot`（缺则失败）；System 重渲染但内容跨 run 稳定。
3. append `User built₂` = build（新 `input`、当前 Composer、annotation 投影的 compacted/active_state、本 run `current_time`）。
4. `context_budget` 将本轮 `user` 写入 log（若尚未写入）→ brain；brain 发送前写入/更新本轮 `brain_user_snapshot`。
5. `buildAvailableTools(learnedSkillIds)`：从最新 `skill_state_updated` 恢复技能后绑定工具。

### 6.5 边界

| 情况 | 行为 |
|------|------|
| 多次 resume | 每次 append 新 build user 在末尾；首条 `User built₁` 保留原始 task_goal |
| `output_truncated` / `runtime_limit` | 可继续；半截 assistant 已在 log/tail |
| `input_too_long` | 不写 log user，不调 brain |
| 编辑重发 | 删该 user + assistant + run + 该 run 的 log 行 |
| 伙伴隔离 | 只读本伙伴 log（先切 `context_cleared`） |
| `partial_answer` | 仅 UI 草稿，不参与 resume |
| 已落盘文件 | `ai_file_change` 不因 run 失败丢失 |

---

## 7. Skill 与 Plan

### 7.1 概念

| 概念 | 含义 |
|------|------|
| **Skill** | 能力包；`builtin` 默认可 bind；`external` 需 `learn_skill` 后才进入 bindTools |
| **Tool** | 具体执行入口；归属一个或多个 skill |
| **agent-control** | 内置 skill，承载 `learn_skill`、`update_plan`、`read_image` |

skill / tool 的 prompt **只声明边界**，不写固定调用顺序（细节见 `tool-design.md` 第 1 节）。

### 7.2 learn_skill 流程

```text
brain 返回 learn_skill
  → dispatch → learning
  → learning_started（annotation）
  → 加载 skill 工具定义到 cache
  → tool 反馈（loaded / duplicate / unknown / 超限）
  → learning_completed（annotation）
  → skill_state_updated（annotation，完整 learnedSkillIds 快照）
  → context_budget → brain   （bindTools 用最新 learnedSkillIds；不改 build user）
```

**active tool 上限**：`HUMAN_MAX_ACTIVE_TOOLS = 30`（含 builtin / agent-control 工具）。新 skill 超限时 **FIFO 淘汰**最早学习的 external skill，写 tool 反馈说明 `evicted=…`。

| 结果 | log | brain |
|------|-----|-------|
| 新 skill 加载成功 | `tool` + `skill_state_updated` | 下轮 bindTools 含新工具；**不改** build user |
| 重复 / unknown / 超限 | 仅 `tool` | 技能块不变 |
| 审批 / 取消 | 按 hand 规则 | — |

### 7.3 update_plan 流程

```text
brain 返回 update_plan
  → dispatch → plan
  → 校验 UPDATE_PLAN_SCHEMA
  → tool 反馈 + plan_updated（同 batch）
  → state.memory.plan 更新
  → context_budget → brain   （不改 build user；计划在 tool 结果中可见）
```

计划项：`{ title, status }`，`status ∈ todo | doing | done`。
扫描 `context_cleared` 之后的 log：**最后**一条 `plan_updated` 生效；`finalizing_started` 后投影清空 plan。

参数非法：写失败 `tool`，plan 不变，回 dispatch 继续队列。

### 7.4 bindTools 集合

每轮 brain 前 `buildAvailableTools`：

- 始终包含 **agent-control** 三工具；
- 加上 `state.skills.learnedSkillIds` 对应 skill 的全部 tool；
- 受 active tool 上限约束（第 7.2 节）。

### 7.5 read_image（agent-control）

- 一次 1–10 路径；不调用第二模型。
- 成功：`tool` + `images[]` ref；runtime append 多模态 HumanMessage（第 3.5 节）。
- 不预判主模型是否支持 vision；由 provider 处理。
- 缓存与 evict 规则见第 3.5 节。

---

## 8. 交付与失败

### 8.1 Thought 与 Answer

| 阶段 | UI 角色 | log |
|------|---------|-----|
| brain 流式中、尚无 tool_calls | Answer 草稿（可转 Thought） | **尚未**写 `assistant` |
| 收到 tool_calls 分片 | Thought | 本轮结束由 **brain** 写 `assistant` + `toolCalls` |
| 无 tool_calls、流正常关闭 | Answer → 交付 | **仅** `finalizeDelivery` 写交付 `assistant`（brain 本轮不写 log `assistant`） |

**判定顺序**：Provider 无 `finish_reason` 时，仍等流关闭后再按完整响应判定。
Main **不**强制计划全部 `done` 才允许交付。

与第 2.2 节一致：过程 `assistant` 与交付 `assistant` 语义不同、writer 不同，**同一轮交付不得双写**。

### 8.2 finalizeDelivery

无 tool_calls 时 brain 调用（交付正文的**唯一**正常 log writer）：

```text
applyDeliverySideEffects
  → docx/ppt 落盘、汇总 ai_file_change
  → finalizing_started（annotation，清空 plan 投影）
  → 扫描交付 markdown 链接、去重检查访问，写入 `linkAccess` sidecar（不改写正文）
  → append 交付 assistant（toolCalls: []，含 linkAccess）
  → ai_run.status = completed
```

交付正文进 log **与** `ai_run.final_answer`；Workbench 展示 artifacts / file changes。
brain 在进入本路径前**不得**再 `appendMessageLog(assistant)`，否则续跑 `projectBrainMessagesFromLog` 会出现连续重复 AI。

### 8.3 内容安全

`content_filter` / 内容安全错误：

- 写 fallback 交付 `assistant`（说明限制 + 已保存文件列表 + 重试提示）；
- run 仍尽量 `completed`，已 `applied` 的文件变更保留。

### 8.4 失败与可恢复

| 场景 | `failure_code` / 行为 | log / brain |
|------|------------------------|-------------|
| 用户停止 | `user_cancelled` | 已写段保留；repair 悬空 tool_calls |
| 应用重启 | `process_interrupted` | 活动 run 标记 failed；不自动调模型 |
| 输出截断 | `output_truncated` | 写半截 `assistant` 后失败；可 resume |
| 图递归上限 | `runtime_limit` | 可 resume |
| 当前 user 超窗 | `input_too_long` | **不写** log user，不调 brain |
| 网络 / provider | `recoverable` 类 | 可 resume |
| 审批拒绝 | hand 写失败 `tool` | 继续 dispatch / brain |

**Resume**（第 6 节）：新建 run；log append `user`；brain append 新 build user；不自动重试 failed run。

### 8.5 与存储的关系

| 数据 | run 失败后 |
|------|------------|
| `chat_session_message_log` | append-only，已写行保留 |
| `ai_file_change`（`applied`） | 保留，Workbench 可预览/回退 |
| `ai_run.partial_answer` | 仅 UI 草稿，丢弃不参与恢复 |
| docx apply 事务 | 失败 run discard；成功 apply 已在 finalize 前提交 |

---

## 附录：关键代码索引

| Concern | 路径 |
|---------|------|
| Graph | `src/main/services/ai/human/graph/humanGraph.ts` |
| Log 投影 | `src/main/services/ai/human/memory/transcript.ts` |
| 多模态 | `src/main/services/ai/human/memory/multimodal.ts` |
| Build user | `src/main/services/ai/human/prompts/brain.ts` |
| Build user 冻结 | `src/main/services/ai/human/memory/brainUserSnapshot.ts` |
| Compaction | `src/main/services/ai/human/node/contextCompactionNode/` |
| Log 存储 | `src/main/services/storage/domains/ChatMessageLogStore.ts` |
| Resume | `src/main/services/ai/ChatRunService.ts` |
| 交付 | `src/main/services/ai/human/node/brainNode/finalizeDelivery.ts` |
| UI 过程投影 | `src/renderer/src/components/workbench/messageLogProjection.ts` |
| 工具 registry | `src/main/services/ai/human/tools/registry.ts` |
