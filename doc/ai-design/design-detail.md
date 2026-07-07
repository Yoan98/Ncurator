# NCurator-Desktop AI 设计细节

本文定义 AI 领域中必须对齐的设计方向、职责边界、核心数据与关键 contract。整体架构、主流程和模块关系见 `architecture.md`；`human skill` 的能力设计见 `human-skill-design.md`；prompt 的通用设计方法见 `prompt-design.md`。

## 1. 设计不变量

- `human` 是当前唯一执行核心。
- `AiRunService` 只负责 run 生命周期，不承担任务求解。
- `brain` 是 `human` 内唯一推理节点。
- `learning`、`hand`、`context_budget`、`context_compaction` 默认都是确定性节点，不额外承担推理职责。
- `mouth` 只负责最终交付组织，不新增事实，不扩张产物。
- 跨层信息必须通过稳定 contract 暴露，不能直接穿透 `HumanState` 内部结构。
- 文档只维护设计方向、核心数据与稳定规则；阈值、常量、事件穷举和实现步骤以代码为准。

## 2. 关键流程

1. 用户输入启动一次 run。
2. runtime shell 初始化 `AiRunContext`、创建 `HumanTaskInput` 并启动 `human`。
3. `human` 先经过 `context_budget`，再进入 `brain` 决策。
4. `brain` 根据当前状态决定进入 `learning`、`hand` 或 `mouth`。
5. `learning` 负责加载 external skill，`hand` 负责执行工具，二者完成后都回到 `context_budget`。
6. `context_compaction` 只负责压缩当前 run 内较早历史，不承担长期记忆。
7. `mouth` 负责组织最终答复并收口 `HumanTaskOutput`。
8. runtime shell 统一整理 `AiRunState` 的完成、失败或取消结果。

## 3. Runtime Shell

### 职责边界

- run 入口只通过 `HumanTaskInput + emitAnswerEvents` 启动 `human`。
- run 出口只通过 `HumanTaskOutput` 收口最终结果，不读取 `HumanState` 内部字段。
- runtime 负责 transport、streaming、fallback、审批、事件派发、LLM IO 记录和最终状态整理。
- AI 调用层不做自动重试；provider / SDK `maxRetries` 固定为 `0`。
- `brain` 的 schema retry 仍保留，但它属于“模型已返回后结构不合法”的业务恢复，不属于 AI 调用重试。
- `brain`、`mouth` 与 conversation memory 的单次模型调用统一受 8 分钟硬超时保护，并把 timeout / cancel 真实传到底层请求。
- 同一 `session` 只保留一份最新的恢复快照；仅在 `timeout` 与 `network_error` 时保存，用于下一次 run 自动恢复语义上下文。

### 相关数据定义

#### `AiRunContext`

```ts
interface AiRunContext {
  // 当前 run 的唯一标识；事件、日志和 activity 都通过它关联到同一次运行。
  runId: string

  // 规范化后的工作区与参考资料范围；brain 与工具层据此判断默认资料边界。
  referenceScope: {
    workspace?: {
      // 工作区 ID。
      workspaceId: string
      // 工作区名称。
      workspaceName: string
      // 工作区根目录。
      rootPath: string
      // 工作区策略档位；为后续权限控制预留。
      policyProfile?: string
    }
    // 用户本轮显式选中的参考资料。
    selectedReferences: SelectedReference[]
    // 用户是否主动缩圈过资料范围。
    hasExplicitSelectedReferences: boolean
    // 是否已通过直接文档指代缩到具体文档。
    hasDirectDocumentNarrowing: boolean
    // 无显式资料时允许使用的默认知识范围。
    defaultKnowledgeScope: 'current_workspace' | 'unavailable'
  }

  // human 运行时保护参数的可选覆盖项。
  humanRuntimeOverrides?: {
    // 当前 human 允许的工具调用上限。
    hardActionLimit?: number
    // 当前 human 使用的模型上下文窗口。
    modelContextWindowTokens?: number
  }

  // 当前绑定的工作区；供 prompt 和工具直接读取基础信息。
  workspace?: {
    workspaceId: string
    workspaceName: string
    rootPath: string
    policyProfile?: string
  }

  // 节点入口统一调用的取消检查。
  checkCancelled: () => void

  // `brain` 的结构化模型调用入口。
  chatStructured<T>(input: {
    caller: string
    taskId?: string
    system: string
    user: string
    schema: z.ZodType<T>
    schemaName: string
    temperature?: number
  }): Promise<T>

  // `mouth` 的自由文本模型调用入口。
  chatText(input: {
    caller: string
    taskId?: string
    system: string
    user: string
    schemaName: string
    temperature?: number
    onTextDelta?: (text: string) => void
  }): Promise<string>

  // 统一派发运行事件。
  sendEvent: (event: AiRunEvent) => void

  // 可选记录完整 LLM IO。
  recordLlmIo?: (record: AiLlmIoRecord) => void

  // hand 执行前统一申请批量审批。
  requestApprovalBatch: (request: AiApprovalBatchRequest) => Promise<AiApprovalBatchResult>

  // 读取当前 run 使用的大模型配置；供需要底层模型能力的工具使用。
  getLlmConfig: () => Promise<LlmRuntimeConfig>

  // Workbench 内置浏览器网页操作能力；不存在时相关工具返回真实诊断错误。
  browserUseService?: BrowserUseService

  // 程序化网页抓取能力；供 web_crawl 抓取网页并返回正文与链接结果。
  webCrawlerService?: WebCrawlerService

  // 读取最近对话和会话摘要。
  loadConversationContext(limits?: {
    recentTurns?: number
    maxRecentTurnsChars?: number
    maxSummaryChars?: number
  }): Promise<{
    recentTurnsText: string
    conversationSummaryText: string
  }>

  // 读取当前会话的持久 conversation memory。
  loadConversationMemory(): Promise<ChatConversationMemory | null>

  // docx 运行时钩子；具体语义见 docx 设计文档。
  trackDocxOpen: (input: {
    docId: string
    sourcePath: string
    replaySession?: DocxReplaySession
  }) => void
  trackDocxChanges: (input: {
    previousDocId: string
    nextDocId: string
    op: DocxOp
    changedBlocks: DocxChangedBlock[]
    createdBlocks: DocxCreatedBlock[]
    replaySession?: DocxReplaySession
  }) => void
  resolveDocxOpenTarget: (sourcePath: string) => Promise<ResolvedDocxOpenTarget>
  beginDocxApplyRun: () => void
  applyDocxRunEdits: () => Promise<DocxApplyRecord[]>
  discardDocxApplyRun: () => void

  // 当前 workspace 级知识能力。
  documentsStore: DocumentsStore
  embeddingService: EmbeddingService
}
```

#### `AiRunState` 与跨层输出

```ts
interface AiRunState {
  // 当前 run 的唯一标识。
  runId: string
  // 当前会话标识。
  sessionId: string
  // run 级状态。
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  // 用户本轮原始输入。
  input: string
  // 失败路径上的错误信息。
  error?: string
  // 最终对用户输出的 markdown。
  finalDeliveryMarkdown?: string
  // run 结束时的结构化产物引用。
  finalArtifacts: AiArtifactRef[]
}

type AiArtifactRef = {
  // 表示一个真实存在的文件类产物。
  kind: 'file'
  // 产物由哪个能力域生成。
  capability: 'terminal_exec' | 'docx'
  // 文件绝对路径。
  path: string
  // 文件名。
  fileName: string
  // 创建还是更新。
  operation: 'created' | 'updated'
  // 若来自 docx 直接写回，则记录 applyId，供 UI 回退本次 AI 修改。
  applyId?: string
  // 面向 AI、日志和 UI 的简洁说明。
  summary: string
}

interface HumanTaskInput {
  // 当前 human 任务 ID；当前正式实现里与 runId 对齐。
  taskId: string
  // 派发给 human 的自然语言任务。
  userInput: string
}

interface HumanTaskOutput {
  // 返回给 runtime shell 的 taskId。
  taskId: string
  // 当前正式跨层输出状态。
  status: 'completed'
  // 最终 markdown 交付。
  deliveryMarkdown: string
  // 最终产物引用。
  artifacts?: AiArtifactRef[]
}

type ChatConversationMemory = {
  // 由后台 conversation.memory batch job 重写的跨任务滚动摘要。
  summary: string
  // 已纳入 summary 的最后一条 message；为 null 时表示尚未覆盖任何具体消息。
  coveredMessageId: string | null
  // covered message 的时间戳；当 message id 不存在时用于恢复边界。
  coveredTimestamp: number | null
  // 已纳入 summary 的消息数量。
  coveredMessageCount: number
  // memory 写入时间。
  updatedAt: number
}

conversation memory 不再在每轮 run 完成后同步更新。`ChatRunService` 在 run 成功完成后后台检查当前 session 的未 covered messages；只有累计达到 12 条 message 时才调用 `conversation.memory` 生成新的完整 summary，并把 covered 边界推进到该 batch 的最后一条 message。后台 job 失败不改变主 run 结果；如果 job 期间 memory 边界或 batch messages 已变化，本次 summary 不写入。

type ChatSessionResumeSnapshot = {
  // 上一次可恢复中断的失败原因。
  reason: 'timeout' | 'network_error'
  // 触发快照的 run。
  runId: string
  // 上一次中断时的用户输入。
  userInput: string
  // 上一次中断时沿用的资料范围。
  selectedReferences: SelectedReference[]
  // 上一次中断时沿用的工作区绑定。
  workspace?: WorkspaceRuntimeBinding
  // 仅包含恢复必需字段的最小 HumanState 片段。
  humanState: JsonObject
  // 最近一次失败信息。
  errorMessage: string
  // 快照更新时间。
  updatedAt: number
}
```

#### 运行失败与恢复规则

- `AiRunState.status='failed'` 时可额外带 `failureCode`，取值固定为 `timeout | network_error | error`。
- `run_failed` 事件只补两个最小字段：`code` 与 `resumeSnapshotSaved`。
- LLM activity 不扩字段面；失败时仅复用已有 `details.reason`，写入 `timeout | network_error | error`。
- `timeout` / `network_error`：保存或覆盖当前 session 的恢复快照。
- `completed`：清空恢复快照。
- 普通 `error` 或 `cancelled`：清空恢复快照，避免旧中断态残留。
- 新 run 命中恢复快照后，仍从 `context_budget -> brain` 重新开始；恢复的是语义上下文，不恢复旧 run 的工具计数、审批态、context budget cache 或 docx 运行态。
- 新 run 命中恢复快照后，会向 `brain` 注入 `decision_hint(code='run_resumed_after_interruption')`，`detail` 只包含 `reason: 'timeout' | 'network_error'`；该 hint 只说明当前是中断恢复态，并强调当前最新用户输入、当前 selected references、当前 workspace 是本轮唯一有效入口。

#### Assistant Process 事件协议

- Workbench assistant 过程流只消费稳定的 `assistant_process_*` 事件，不从 `human_step`、`tool_call_*` 或 `context_compaction_*` 推断 UI 过程。
- `assistant_process_thought` 表示可公开的 brain 决策摘要，来源是经过 prompt/schema 约束的 `thought.next`，用于 Workbench 常显思路文本；它不是模型原始 chain-of-thought。
- renderer 收到 `assistant_process_thought` 时应结束当前 thinking 展示，避免 hand 在审批或其他前置阻塞前尚未派发工具过程组时同时显示思考层与决策层。
- 后端负责按真实生命周期派发过程开始、完成与失败事件：run 启动后先派发 thinking；learning、hand 工具和 context compaction 开始前结束当前 thinking，完成后按需重新进入 thinking；进入 mouth 且等待最终文本返回时派发 finalizing 等待组，最终 markdown 首个 token 或完成事件到达后由 renderer 隐藏该等待组。
- `assistant_process_group_*` 表示用户可理解的过程组，`assistant_process_item_*` 表示组内可展开的工具句子；renderer 可将同一轮连续 hand 技能组聚合为一个执行层 header，但展开项仍来自稳定 item 事件。
- 事件的 `display` 字段只承载稳定展示意图，例如 thinking、learning skillId、toolName 与工具入参、compaction、finalizing；renderer 负责将这些展示意图映射为本地化文案、强调样式、展开收起和状态降权。
- legacy 运行事件仍可服务日志、审计、artifact 提取和兼容其他内部流程，但不得作为 Workbench assistant 过程 UI 的事实来源。

## 4. Human 总体

### 职责边界

- `human` 是 task 级 autonomous execution unit。
- 当前正式实现由 `context_budget / context_compaction / brain / learning / hand / mouth` 六个区域组成。
- `memory.thought` 只由 `brain` 的 `thought.todolist` 与 `thought.progressionSummary` 按需覆盖更新。
- `execution.currentThought` 只表示当前动作快照；正式过程历史由 `rounds` 承接。

### 相关数据定义

```ts
type HumanStage = 'context_budget' | 'context_compaction' | 'brain' | 'learning' | 'hand' | 'mouth'

type HumanStatus = 'running' | 'completed'

interface HumanTodoItem {
  // 用户目标下的一条任务项。
  item: string
  // 当前任务项状态。
  status: 'todo' | 'done' | 'obsolete'
}

interface HumanThought {
  // 每轮 brain 必填；描述当前判断和下一步推进。
  next: string
  // 可选；输出时全量覆盖 memory.thought.todolist。
  todolist?: HumanTodoItem[]
  // 可选；输出时全量覆盖 memory.thought.progressionSummary。
  progressionSummary?: string
}

interface HumanState {
  // 当前 task 的输入。
  task: HumanTaskInput
  // 当前 task 的执行态字段。
  execution: HumanExecution
  memory: {
    // 当前 run 内可展示的任务推进记忆。
    thought: HumanThought
    // 过程历史与 run 内压缩块。
    history: HumanMemoryHistory
  }
  skills: {
    // 已学习的 external skill 列表；builtin skill 不写入这里。
    learnedSkillIds: string[]
  }
  // task 完成后的内部结果快照。
  result?: HumanResult
  trace: {
    // 面向外部事件、审计和回放的轨迹步骤列表。
    steps: HumanTraceStep[]
  }
}
```

## 5. Brain

### 职责边界

- `brain` 是 `human` 内唯一推理节点，负责基于任务、历史、技能、参考范围和决策提示产出下一轮正式决策。
- `brain` 输出必须通过 `ctx.chatStructured` 与 schema 校验。
- `brain` 不直接执行工具，不直接组织最终答复。

### 相关数据定义

```ts
type BrainNextAction =
  | {
      // 下一跳先学习 external skill。
      action: 'learning'
      // 本轮希望学习的 skill id 列表。
      wantLearnSkillIds: string[]
    }
  | {
      // 下一跳执行工具调用。
      action: 'hand'
      // 本轮工具调用列表；系统按顺序串行执行。
      calls: ToolCallParam[]
    }
  | {
      // 下一跳直接进入 mouth。
      action: 'mouth'
      // 若收尾引用了资料或外部知识，则在这里显式列出。
      references?: Array<{
        label: string
        path: string
        resourceType: 'file' | 'web'
        usedFor: string
      }>
    }

interface HumanThoughtDecision {
  // 本轮正式任务推进思路。
  thought: HumanThought
  // 下一跳动作对象。
  nextAction: BrainNextAction
}
```

### 规则说明

- `brain` 的 prompt 只负责工作方式、thought 语义、动作路由语义和输出规则，不承载 runtime transport 细节。
- prompt 中工具输入/输出结构应直接来自真实 schema 的导出文本，不再手写一份并行结构说明。

## 6. Learning

### 职责边界

- `learning` 只负责装载本轮 `brain` 指定的 external skill，并更新有效 skill 集合。
- `learning` 不调用模型。
- builtin skill 始终可用，不进入 `learning`。

### 相关数据定义

```ts
interface HumanLearningOutcome {
  // 本轮原始请求学习的 skill 列表。
  requestedSkillIds: string[]
  // 本轮实际新加载成功的 skill 列表。
  loadedSkillIds: string[]
  // 本轮发现已经学过，因此跳过的 skill。
  skippedDuplicateSkillIds: string[]
  // 本轮发现未知，因此跳过的 skill。
  skippedUnknownSkillIds: string[]
  // 本轮因 active tool budget 等原因被移出的 skill。
  evictedSkillIds: string[]
  // 当前有效工具数。
  activeToolCount: number
}
```

### 规则说明

- `learnedSkillIds` 只记录 external 且已成功学习的 skill。
- 如果状态中出现 builtin skill，属于状态错误，不应在文档层定义兼容清洗。

## 7. Hand

### 职责边界

- `hand` 承接 `brain` 已明确决定的工具调用批次，执行工具并回写结果、历史与产物。
- `hand` 只按顺序串行执行 `calls`。
- `hand` 节点不额外承担推理职责；具体工具可按自身能力调用底层服务，例如内置浏览器工具可使用当前大模型完成 DOM 网页操作。
- `browser_use` 首次在同一 task 中执行前进入现有批量审批；同一 task 后续浏览器操作不重复审核。
- 工具结果过大统一通过 `hand_tool_result_too_large` decision hint 回到 brain，不在各工具中复制独立提示逻辑。

### 相关数据定义

```ts
interface ToolCallParam {
  // 要调用的工具名。
  toolName: string
  // 传给该工具的结构化参数。
  args: JsonObject
}

interface ToolCallDiagnostic {
  // 原始错误文本；优先保留 schema 校验或运行时返回的 message。
  message: string
}

interface ToolCallResult {
  // 工具名。
  toolName: string
  // 这次工具调用是否成功。
  ok: boolean
  // 工具返回的结构化数据。
  data?: JsonValue
  // 失败或特殊情况的诊断信息。
  diagnostic?: ToolCallDiagnostic
  // 资源上下文；用于运行归因、artifact 关联与后续分析。
  resourceContext?: ToolResourceContext
}

interface HumanHistoryToolResult {
  // 工具名。
  toolName: string
  // 这次工具调用是否成功。
  ok: boolean
  // 作为 history canonical evidence 保存的原始结构化返回。
  data?: JsonValue
  // 诊断信息的文本化摘要。
  diagnosticText?: string
  // 本次工具调用附带生成的 artifact 引用。
  artifactRefs?: AiArtifactRef[]
  // 资源上下文；用于运行归因与检索文本。
  resourceContext?: ToolResourceContext
}

type HumanDecisionHint =
  | {
      code: 'learning_no_effect'
      detail: {
        requestedSkillIds: string[]
        duplicateSkillIds: string[]
        unknownSkillIds: string[]
      }
    }
  | {
      code: 'terminal_approval_blocked'
      detail: {
        allowedCommands: string[]
        blockedCommands: string[]
        notes: Array<{
          command: string
          message: string
        }>
      }
    }
  | {
      code: 'hand_call_limit_exceeded'
      detail: {
        offendingToolNames: string[]
        callCount: number
        limit: number
      }
    }
  | {
      code: 'hand_docx_positioned_write_blocked'
      detail: {
        toolName: 'docx_edit'
        sourcePath?: string
        action?: string
        targetDescription: string
        diagnostic?: string
      }
    }
  | {
      code: 'hand_docx_edit_failed'
      detail: {
        toolName: 'docx_edit'
        sourcePath?: string
        action?: string
        error: string
        diagnostic?: string
      }
    }
  | {
      code: 'hand_tool_limit_near_exhausted'
      detail: {
        toolCallCount: number
        limit: number
      }
    }
  | {
      code: 'hand_tool_limit_exceeded'
      detail: {
        toolCallCount: number
        limit: number
      }
    }
  | {
      code: 'hand_tool_result_too_large'
      detail: {
        toolName: string
        estimatedTokens: number
        limit: number
      }
    }
  | {
      code: 'hand_tool_result_unusable'
      detail: {
        toolName: string
        reason: 'non_text_output'
        totalChars: number
        nulCount: number
        replacementCharCount: number
        replacementCharRatio: number
        controlCharCount: number
        controlCharRatio: number
        matchedSignatures: string[]
      }
    }
  | {
      code: 'brain_output_schema_invalid'
      detail: {
        issues: Array<{
          path: string
          message: string
        }>
      }
    }
  | {
      code: 'brain_todolist_incomplete'
      detail: {
        pendingItems: string[]
      }
    }
  | {
      code: 'hand_call_invalid'
      detail: {
        invalidCalls: Array<{
          callIndex: number
          toolName: string
          message: string
        }>
      }
    }
  | {
      code: 'hand_workspace_boundary_blocked'
      detail: {
        blockedCalls: Array<{
          callIndex: number
          toolName: string
          message: string
        }>
      }
    }
  | {
      code: 'hand_tool_runtime_failed'
      detail: {
        failedCalls: Array<{
          callIndex: number
          toolName: string
          message: string
        }>
      }
    }
```

### 规则说明

`tool result` 必须遵守稳定外层 contract：

```ts
// 1. 薄外层：只保留 toolName / ok / data / diagnostic / resourceContext
// 2. 真实内层：data 只保留工具真实业务数据，不重复外层字段
// 3. 渲染层：history / UI 单独维护白名单与格式控制
//
// 统一约束：
// - 不在正式 contract 中持久化 code
// - 不在正式 contract 中持久化 summary
// - ok 是唯一统一成功位
// - diagnostic.message 是统一失败摘要来源
// - 需要程序化分支时，应通过 decisionHint 或专门结构字段表达
```

- `hand` 失败时应优先保留原始校验/运行时错误文本。
- 影响下一轮 `brain` 决策的诊断信息，应通过 `decisionHint` 回流最小结构化事实。
- `terminal_run` 只负责执行 workspace 边界内的 shell command；直接执行资格由当前平台安全指令集决定，一条 command 被拆分后的每段都命中安全指令集时可直接执行，任一段未命中则必须先经用户审批。
- `terminal_run` 禁止用 terminal 读取或写入 Word / Excel / PPT / PDF 等结构化文档内容；若执行后返回明显非文本/二进制内容，工具必须省略原始输出，并通过 `hand_tool_result_unusable` 回流检测到的结构化特征。

## 8. Mouth

### 职责边界

- `mouth` 围绕 `task_goal` 组织最终用户交付，并回写 `HumanResult`。
- `mouth` 输出必须通过 `ctx.chatText`。
- `mouth` 必须忠实于整体状态；不引入新的事实来源。

### 相关数据定义

```ts
interface MouthOutput {
  // mouth 生成的正式 markdown。
  deliveryMarkdown: string
}

interface HumanResult {
  // human 内部结果目前只存在 completed 这一种终态。
  status: 'completed'
  // 对当前 task 完成情况的简短摘要。
  summary: string
  // 最终正式 markdown 交付。
  deliveryMarkdown: string
  // 最终透传的 artifact 列表。
  artifacts?: AiArtifactRef[]
}
```

### 规则说明

- `mouth` 优先吸收 `reference_scope`、`memory.thought`、结果导向 `history`、`deliveryGuidanceItems`、`file_changes` 与 `references`。
- `mouth` 必须在最终 markdown 中明确说明引用了哪些资料，以及这些资料支撑了交付中的哪些内容。
- `references` 的正式来源是 `brain(nextAction=mouth)` 的结构化输出；`mouth` 只消费和披露，不自行推断新的已引用来源。
- `references` 每项必须包含 `label / path / resourceType / usedFor`；`resourceType` 只能是 `file` 或 `web`，且 `path` 必须是对应类型下明确可打开的本地路径或网页 URL。
- `references` 渲染为 `kind=reference` 的 `ncurator://ref` markdown 链接，是证据引用样式和点击行为的唯一来源。
- `mouth` 输出任何可点击文件或网页链接时，都必须使用 `ncurator://ref` markdown 链接；非证据链接必须使用 `kind=normal`，文件链接只允许上下文中已有且路径明确的工作区内文件。
- `file_changes` 表示本轮 AI 实际修改过的文件，是最终答复中“修改了什么”的来源；它来自统一的 `AiFileChangeRecord` 投影，不表示读过或引用过的任意文件。
- human state 内部使用 `fileChanges` 保存本轮修改文件摘要；读过、检索过或仅引用过的文件不得进入该字段。

## 9. Context Budget 与 Context Compaction

### 职责边界

- `context_budget` 在每次进入 `brain` 前评估上下文预算，决定继续推理还是触发压缩。
- `context_compaction` 只压缩当前 run 内可压缩历史，并与上一轮 `rounds` 摘要滚动合并。
- 压缩块不持久化到 conversation memory。

### 相关数据定义

```ts
type HumanRoundExecution =
  | {
      // 执行前就被保护逻辑拦住。
      kind: 'pre_execution_blocked'
      decisionHint: HumanDecisionHint
    }
  | {
      // 本轮真正执行了 learning。
      kind: 'learning'
      learningOutcome: HumanLearningOutcome
      decisionHint?: HumanDecisionHint
    }
  | {
      // 本轮真正执行了 hand。
      kind: 'hand'
      calls: ToolCallParam[]
      toolResults: HumanHistoryToolResult[]
      decisionHint?: HumanDecisionHint
      artifactRefs?: AiArtifactRef[]
    }
  | {
      // 本轮真正执行了 mouth。
      kind: 'mouth'
      summary: string
      completed: boolean
    }

interface HumanRoundRecord {
  // round 序号。
  roundId: number
  // 本轮记录创建时间。
  createdAt: number
  // 本轮 brain 的正式判断。
  thought: HumanThoughtDecision
  // 本轮随后真正发生的执行结果。
  execution: HumanRoundExecution
}

interface HumanTaskRunMemory {
  // 当前 run 内未压缩的正式过程历史。
  rounds: HumanRoundRecord[]
  // 当前 run 内由 context_compaction 生成的历史压缩块。
  compactions: Array<{
    id: string
    kind: 'rounds'
    summary: string
    source: {
      roundIds: number[]
    }
    createdAt: number
    tokenEstimateBefore?: number
    tokenEstimateAfter?: number
  }>
}

interface HumanLoadedHistoryContext {
  filters: {
    query?: string
    startRoundId?: number
    endRoundId?: number
    limit?: number
  }
  // 根据 filters 实际取回的 round 列表。
  rounds: HumanRoundRecord[]
}

interface HumanExecution {
  // 当前 human 所在节点。
  stage: HumanStage
  // 当前 human 运行状态。
  status: HumanStatus
  // 当前动作快照。
  currentThought?: HumanThoughtDecision
  // 收敛或纠偏提示。
  decisionHint?: HumanDecisionHint
  // 最终交付必须吸收的额外说明项。
  deliveryGuidanceItems?: Array<{
    source: 'hand'
    text: string
  }>
  // 最近一次 hand 工具执行结果。
  lastToolResults?: ToolCallResult[]
  // 最近一次 learning 的真实执行结果。
  lastLearningOutcome?: HumanLearningOutcome
  // 最近一次进入 brain 前的上下文预算快照。
  contextBudget?: {
    evaluationId: string
    basis: 'initial' | 'usage_plus_delta' | 'post_compaction' | 'usage_unavailable'
    budgetTokens: number
    contextWindowTokens: number
    compactionTriggerTokens: number
    hasCompressibleHistory: boolean
    usageAvailable: boolean
    lastBrainInputTokens?: number
    deltaTokenEstimate?: number
  }
  // 运行时收集到的结构化交付物引用。
  artifacts: AiArtifactRef[]
  // brain 在决定 `mouth` 时声明的引用资料。
  references?: Array<{
    label: string
    path: string
    resourceType: 'file' | 'web'
    usedFor: string
  }>
}
```

## 10. Trace 与外部观测

### 职责边界

- `trace` 用于外部事件、审计和回放。
- 文档只保留外部可理解的稳定结构，不穷举全部运行事件枚举。
- `trace` 不驱动 Workbench assistant 过程 UI；该 UI 的跨层 contract 是 Runtime Shell 中定义的 `assistant_process_*` 事件协议。

### 相关数据定义

```ts
interface HumanTraceStep {
  // 当前 trace 的顺序号。
  step: number
  action: 'brain_decision' | 'learn_skill' | 'call_tool' | 'deliver_result'
  // 面向外部轨迹的一句话叙述。
  publicNarrative: string
  // 当前步骤结果状态。
  resultStatus?: 'ok' | 'error'
  // 若与 skill 有关，则记录 skillId。
  skillId?: string
  // 若与 tool 有关，则记录 toolName。
  toolName?: string
  // 当前步骤摘要；供内部调试与审计使用。
  summary: string
}
```

## 11. 不纳入文档维护的实现细节范围

- 上下文窗口、触发阈值、工具调用上限等常量值。
- 运行事件完整枚举与逐字段细节。
- 审批批次、terminal step、LLM IO 的实现级事件展开。
- 各节点内部的具体分支顺序、fallback 细节和渲染白名单实现。
- 代码层的 schema 全量穷举；文档只保留设计理解所需的核心 contract。
