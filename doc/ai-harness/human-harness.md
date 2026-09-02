# Human Harness

human graph 的消息与上下文设计约束。修改 `src/main/services/ai/human/**` 的 graph、消息写入、投影、compaction、resume、brain 上下文时必读。

---

## 1. Graph 流转

<!-- TODO：细化 -->
<!-- human graph 节点：context_budget / context_compaction / brain / dispatch / learning / plan / hand -->
<!-- 流转图 + 各节点职责（谁写 log、谁改 runtime cache、谁调模型） -->
<!-- dispatch 路由：learn_skill → learning；update_plan → plan；其余 → hand -->
<!-- 每轮 brain 前必过 context_budget -->

---

## 2. 数据源

human harness 涉及的数据从哪来、到哪去。只有 **`chat_session_message_log`** 是 transcript 真相源；其余存储与运行时注入见各小节。

### 2.1 总览

```text
写入：用户发送 → graph 节点 → chat_session_message_log
                              └→ 工具写文件 → ai_file_change

读取：
  chat_session_message_log ──投影──→ brain / UI 对话 / UI 过程   （见 §3）
  ai_run ──────────────────→ UI 运行态、审批、流式草稿           （不进 brain）
  ai_file_change ──────────→ Workbench 改动 / 回退               （不进 brain）
  Composer ──注入──────────→ 新 run 的 reference_scope           （不进 log，见 §2.5）
```

- **AI 会话**走 human harness；**搜索模式**用独立存储，不写 `chat_session_message_log`。
- **目标态**：UI 对话轮次由 log 投影；技能由 `skill_state_updated` annotation 投影；移除 `chat_message` 与 `chat_session_skill_state`（重构前代码仍可能读写旧表，以本文为准对齐）。

### 2.2 Transcript：`chat_session_message_log`

append-only 会话转录；模型上下文、UI、resume 均由此投影。Compaction 与 resume **只读、不改**已有行。

**表字段**

| 列 | 含义 |
|----|------|
| `session_id` | AI 会话 |
| `run_id` | 写入时所属 AI run |
| `seq` | 会话内单调递增；checkpoint / 投影按 `seq` |
| `entry_json` | `ChatMessageLogEntry` |
| `created_at` | 写入时间 |

**写入入口**：graph 节点 → `AiRunContext.appendMessageLog` → `ChatMessageLogStore.appendBatch`（同 batch 内 `seq` 连续分配）。

#### 四种 `kind`

| `kind` | 存什么 | 典型写入时机 |
|--------|--------|--------------|
| `user` | 用户原文 + `context` | 本轮首次进入 brain 前（`context_budget`） |
| `assistant` | 文本 + `toolCalls[]` | 每轮 `brain`；最终交付 |
| `tool` | 工具反馈正文 + 可选 `images[]` | `hand` / `plan` / `learning` |
| `annotation` | 过程与状态事件 | 见下表 |

#### `annotation` 事件

| `eventType` | `payload` | 投影用途 |
|-------------|-----------|----------|
| `thinking_started` / `thinking_completed` | `{}` | UI 过程层 |
| `learning_started` / `learning_completed` | `{ skillId }` | UI 过程层 |
| `skill_state_updated` | `{ learnedSkillIds: string[] }` | brain `<active_state>` 技能（**取最新一条**） |
| `plan_updated` | `{ plan: [{ title, status }] }` | brain `<active_state>` 计划 + UI 计划条 |
| `compaction_checkpoint` | 见示例 | brain `<compacted_history>` + UI 压缩层 |
| `finalizing_started` | `{}` | 投影时**清空** plan |

#### `entry_json` 示例

**`user`** — 审计用，保存当轮 Composer 快照；brain **不直接**消费此条目（见 §2.5、§3）。

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
    "attachments": [],
    "workspace": { "rootPath": "/Users/me/workspace", "name": "默认工作区" }
  }
}
```

**`assistant`** — 过程 Thought 或最终交付；带工具决策时 `toolCalls` 非空。

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
      "path": "/Users/me/workspace/.ncurator/runtime/assets/read_image-cache/abc…-v1.webp",
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

#### 写入闭环

| 节点 | 写入 `kind` / `eventType` | 说明 |
|------|---------------------------|------|
| `context_budget` | `user` | 本轮首次确定进入 brain 时写一条；若首轮先 compaction，则在 compaction 返回后再写 |
| `brain` | `thinking_started` → `assistant` → `thinking_completed` | 每轮 brain 一次；`finish_reason=length` 时先写半截 `assistant` 再失败 |
| `brain`（交付） | `assistant`（`toolCalls: []`） | 经 `finalizeDelivery` 写最终交付正文 |
| `brain`（内容安全） | `assistant` | fallback 交付正文 |
| `dispatch` → `learning` | `learning_started` → `tool`（`learn_skill`）→ `learning_completed` → **`skill_state_updated`** | 学习成功写完整 `learnedSkillIds` 快照；重复学习 / 失败只写 `tool` |
| `dispatch` → `plan` | `tool`（`update_plan`）+ `plan_updated` | 参数合法时同批写 tool 反馈与计划快照 |
| `dispatch` → `hand` | `tool` | 每个 tool call 一条；审批拒绝时写失败 `tool` |
| `context_compaction` | `compaction_checkpoint` | 压缩模型产出摘要后落库 |
| `finalizeDelivery` | `finalizing_started` → `assistant` | 交付前清空 plan 投影；写最终 assistant |

```text
用户发送
  → context_budget ──→ user（首次进 brain）
  → brain ──→ thinking_* + assistant
  → dispatch → learning / plan / hand ──→ tool + annotation
  → context_budget → brain（循环）
  → finalizeDelivery ──→ finalizing_started + assistant（交付）
  → context_compaction ──→ compaction_checkpoint（预算触发时）
```

同一次 `appendMessageLog([…])` 可 batch 多条（如 `plan` 节点的 `tool` + `plan_updated`），共享连续 `seq`。

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
| `selectedReferences` / `attachments` / `workspace` | run 创建时 Composer 快照（与 log `user.context` 对应） |

**写入**：`ChatRunService` 创建/更新 run。  
**读取**：Renderer session snapshot、`activeRuns`、审批 UI。  
**与 log 关系**：同一 `run_id` 关联 log 行；resume 时新建 run，读**全 session** log 投影。

### 2.4 文件域：`ai_file_change`

工具写文件产生的修改记录与 diff artifact；服务 Workbench 预览、红绿 diff、回退。

| 字段（要点） | 用途 |
|--------------|------|
| `run_id` / `session_id` | 归属 |
| `path` / `fileName` / `operation` | 文件身份与操作类型 |
| `capability` | `text_file` / `docx` / `ppt` / `terminal_tool` 等 |
| `status` | `applied` / `failed` / `reverted` 等 |
| `changeCount` / `insertCount` / `deleteCount` | 改动统计 |
| `previewArtifactHash` 等 | diff 预览对象 |

**不进 brain prompt**；工具结果摘要已在 log 的 `tool.content` 中。  
**run 失败不丢记录**：已 `applied` 的修改保持，供 Workbench 展示与回退。

### 2.5 运行时注入（不进库）

新 run 的 `<reference_scope>` 来自 **Composer 当前配置**（工作区、`@` 引用、附件），由 `buildBrainUserMessage` 渲染进 build user。

| | log 里的 `user.context` | Composer → build user |
|--|-------------------------|------------------------|
| 作用 | 审计「当时用户说了什么、配了什么」 | 驱动**当前 run** brain 输入 |
| resume / 新 run | 保留在 log，供 UI 与测试核对 | **始终用当前 Composer**，不复用历史 user 的 context |
| `<task_goal>` | log `user.content` 存当轮原文 | build user 用**当前 run** 的 `input` |

因此：同 session 续跑时，历史 assistant/tool 从 log 投影，但 `@` 范围可以换（例如 run-2 改选另一份文件），以 Composer 为准。

---

## 3. 投影设计

只投影 **`chat_session_message_log`**。log 里的 `user` **不直接**作为 HumanMessage 发给 model；brain 永远消费 **build 后的 user**。

投影入口：`projectMessageLogRecords(records)` → `{ messages, plan, checkpoint }`；graph 再拼 System、build user 与 runtime cache。  
Compaction / Resume / 前缀缓存 → 见 §4–§6。

### 3.1 投影产物

| 产物 | 消费方 | 规则 |
|------|--------|------|
| Brain messages | 主模型 | §3.2–3.3；§4 缓存；§5–§6 边界事件 |
| UI 对话轮次 | Renderer | 按 `run_id` 聚合 log 中的 `user` + 交付 `assistant` |
| UI 过程层 | Renderer | 单 run 的 log → `projectProcessGroups`（§3.4） |
| 历史 user 审计 | UI / 测试 | log 中 `user` 条目（含 `context` 快照） |

### 3.2 Brain messages 标准形态

**唯一合法顺序**：

```text
[System]              buildBrainSystemPrompt
[User built]          buildBrainUserMessage（ncurator_current_user 标记）
[Assistant / Tool …]  tail
```

| 段 | 含义 |
|----|------|
| System | 系统提示；可每轮重建，内容稳定 |
| User built | 每个 run **一条**；每轮 brain 前**原地刷新**（不 append 第二条 user） |
| tail | 仅 `assistant` / `tool` / 多模态合成 HumanMessage；**不含** log 裸 `user` |

**build user 块**（各字段来源见 §3.3 表）：

```text
<user_context>
  <task_goal>…</task_goal>
  <preference>…</preference>
  <reference_scope>…</reference_scope>
  <compacted_history>…</compacted_history>   ← 可选
  <active_state>…</active_state>
</user_context>
```

**稳态行为**（同 run、未触发 §5–§6 时）：

- 首次 brain：tail 为空，仅 `[System, User built]`。
- brain → 工具 → 再 brain：新 assistant/tool **append 在 tail 末尾**；brain 前 **replace** 原 build user（plan 更新反映到 `<active_state>`）。
- 前缀结构与 tail 已发送段保持稳定，以利 §4 前缀缓存；compaction 与 learn_skill 会打破（§4）。

### 3.3 稳态投影规则

从 log 投影 tail 与 build user 状态块的通用算法（compaction / resume 的重建见 §5–§6）。

**tail（assistant / tool）**

1. 取 session log，按 `seq` 排序；若有 checkpoint，只保留 `seq > coveredThroughSeq` 的行。
2. 丢弃 `kind=user` 与所有 `annotation`。
3. `assistant` → AIMessage；`tool` → ToolMessage。
4. `tool.images[]` 非空 → 在该 tool 后合成多模态 HumanMessage（§3.5）。
5. `repairInterruptedToolCalls`：每个 AIMessage 的 `tool_call_id` 若无对应 ToolMessage，插入  
   `Error: The run was interrupted before this tool call could be executed.`

**checkpoint 与摘要**：最新 `compaction_checkpoint` 的摘要**只**进 build user 的 `<compacted_history>`，不与 tail 重复（§5 写入规则）。

**build user 各块**

| 块 | 来源 |
|----|------|
| `<task_goal>` | 当前 run `input` |
| `<preference>` | 当前 run Composer |
| `<reference_scope>` | 当前 run Composer（§2.5） |
| `<compacted_history>` | 最新 `compaction_checkpoint.summary`（无则省略） |
| 已学习技能 | 最新 `skill_state_updated.learnedSkillIds` |
| 计划进度 | 全 session log 顺序扫描：最后 `plan_updated`；`finalizing_started` 清空 |

annotation 扫描用**完整** log；tail 用 checkpoint **截断后**的行。

**组装**

```text
brainMessages = [System] + [User built] + tail
```

**同 run 刷新**：固定 `currentUserMessageIndex`，brain 前 replace build user；新 assistant/tool 只 append tail。不从 log 全量重建（§5 compaction 的整段替换除外）。

**投影不做的事**：log 裸 `user`、`ai_run.partial_answer`、`ai_file_change` 不进 brain。

### 3.4 UI 投影

<!-- TODO：对话轮次：log 按 run 切分 -->
<!-- TODO：projectProcessGroups：thinking / learning / tool / compaction -->

### 3.5 多模态投影

<!-- TODO：tool.images[] → 合成 HumanMessage → projectMessagesForMainModel -->

---

## 4. 前缀缓存

主模型 provider 的前缀缓存（prefix cache）要求：**多次请求中，发给 AI 的前缀字节序一致**，才能命中缓存。  
human harness 通过 §3.2 的固定顺序与 append-only tail 满足这一点。

### 4.1 什么算「前缀」

一次 brain 请求中，按顺序发送：

```text
[System] + [User built] + tail 中「本轮新 append 之前」的全部消息
```

- **tail 只许在末尾增长**（append assistant/tool），不得在中间插入或改写已发送段。
- **User built 只占固定槽位**（`currentUserMessageIndex`），每轮 brain 前 **replace** 整段内容，不追加第二条 user HumanMessage。

因此：同 run 内多轮 tool 循环时，上一轮已发给模型的 `[System, User built, …旧 tail]` 字节序不变，provider 可复用缓存。

### 4.2 稳态下如何保持命中

| 操作 | 对前缀的影响 |
|------|--------------|
| brain → hand → 再 brain | 旧 tail 不变；仅 append 新 tool/assistant |
| `update_plan` | replace build user 的 `<active_state>` 计划行；**不**改 tail |
| resume（用户续发新消息） | 见 §6：新诉求进 build user 的 `<task_goal>`；历史 tail 投影段不变 |

### 4.3 打破前缀缓存的操作

仅以下两类会改变已建立的前缀语义，**视为打破缓存**：

| 操作 | 原因 |
|------|------|
| **Compaction**（§5） | `<compacted_history>` 写入摘要；tail 截断重建；前缀内容变化 |
| **learn_skill**（§7） | `<active_state>` 技能列表变化；写 `skill_state_updated` 后 replace build user |

其他 replace build user 的字段（如 plan 进度、`task_goal` 在 resume 时更新）不改变「打破」判定：**打破仅指 compaction 与 learn_skill**。  
设计约束：除 §4.3 两类外，不得重写 tail 已发送段或追加第二条 user HumanMessage。

---

## 5. Compaction

同 run 内、进入 brain 前，因上下文预算触发的压缩。遵循 §3.2 标准顺序；执行后 **整段替换** runtime messages，并 **打破 §4 前缀缓存**。

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
3. 整段替换：`[System, User built(compacted_history=摘要), …tail]`。
4. 回到 `context_budget` → brain。

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
[User built]   <compacted_history>摘要…</compacted_history>
[Assistant]    保留的最后一条 AI
[Tool]         其 tool 结果
```

log 行 append-only 保留；被覆盖段不再进入 tail。

---

## 6. Resume 机制

上一 run 未正常完成；用户在同 session **继续发送消息**。不自动重试 failed run，而是 **新建 run**，从 log 投影后再走 graph。

### 6.1 触发

用户停止、网络错误、超时、`process_interrupted`（重启）、`output_truncated`、`runtime_limit`、其他失败。  
重启时 `failInterruptedRuns` 标记活动 run，**不**自动调模型。

### 6.2 用户续发：log 与 brain 各发生什么

用户新输入会 **append 到 log 末尾**（新 `user` 行，含当轮 Composer `context` 快照）。  
但 brain **不会**在 messages 数组 tail 后再加一条裸 HumanMessage——新诉求必须进 **build user** 的 `<task_goal>`（§3.2 固定槽位）。

```text
log（转录 append 在末尾）:
  … 历史 assistant / tool / annotation …
  [user] content="继续把周报写完"  context=当前 Composer 快照   ← 新 run 写入

brain messages（新 run 首次 brain，仍 §3.2 顺序）:
  [System]
  [User built]   task_goal=继续把周报写完        ← 来自新 run input，走 build
                 reference_scope=当前 Composer
                 compacted_history=…  active_state=…
  [Assistant/Tool …]  checkpoint 后历史 + repair 补全
```

要点：

- **log 末尾**多一条 `user` → 审计与 UI 对话轮次。
- **brain 上**没有「第三条 user 消息」；新话在 build user 的 `<task_goal>`，位置仍在 System 之后、tail 之前。
- 历史 tail 投影段不变；**不**属于 §4.3 的缓存打破（打破仍仅 compaction / learn_skill）。

### 6.3 构建步骤

1. 读全 session `chat_session_message_log`；checkpoint 截断；`repairInterruptedToolCalls`。
2. `context_budget` append 本轮 `user` 到 log（若尚未写入）。
3. 组装 `[System, User built(新 task_goal + Composer), …tail]`。
4. 进入 brain。

### 6.4 边界

| 情况 | 行为 |
|------|------|
| 多次 resume | 首条 log `user` 保留原始任务；每次续发 append 新 `user`，对应新 run 的 `<task_goal>` |
| `output_truncated` / `runtime_limit` | 可继续对话；半截 assistant 已在 log |
| `input_too_long` | 不写 log user，不调 brain |
| 编辑重发 | 删该 user + assistant + run + 该 run 的 log 行 |
| session 隔离 | 只读本 session log |
| `partial_answer` | 仅 UI 草稿，不参与 resume |
| 已落盘文件 | `ai_file_change` 不因 run 失败丢失 |

---

## 7. Skill 与 Plan

<!-- TODO：learn_skill → learning 节点 → tool 反馈 + skill_state_updated -->
<!-- TODO：update_plan → plan 节点 → tool 反馈 + plan_updated -->
<!-- TODO：active tool 上限与 FIFO → 新 skill_state_updated -->
<!-- TODO：agent-control：learn_skill / update_plan / read_image -->

---

## 8. 交付与失败

<!-- TODO：Thought vs Answer；finalizeDelivery -->
<!-- TODO：终态 assistant 写 log；failure 写 ai_run -->

---

## 附录：关键代码索引

| Concern | 路径 |
|---------|------|
| Graph | `src/main/services/ai/human/graph/humanGraph.ts` |
| Log 投影 | `src/main/services/ai/human/memory/transcript.ts` |
| Build user | `src/main/services/ai/human/prompts/brain.ts` |
| Compaction | `src/main/services/ai/human/node/contextCompactionNode/` |
| Log 存储 | `src/main/services/storage/domains/ChatMessageLogStore.ts` |
| Resume | `src/main/services/ai/ChatRunService.ts` |
| UI 过程投影 | `src/renderer/src/components/workbench/messageLogProjection.ts` |
