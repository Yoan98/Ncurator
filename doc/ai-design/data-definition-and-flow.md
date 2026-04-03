# NCurator-Desktop AI 数据定义与流转图

## 1. 总览

本设计分为 `director` 与 `human` 两层：

- `director` 负责 run 级编排、计划调度和最终汇总。
- `human` 负责单任务闭环执行。
- 节点行为、技术实现约束与跨层规则见 `implementation-spec.md`。
- 本文只定义状态、契约与数据流转，不展开架构动机与阅读导引。

### 1.1 `AiRunContext`

`AiRunContext` 是运行时注入给 `director` 与 `human` 的只读上下文，不持久化进 `DirectorState` 或 `HumanState`。

```ts
interface AiRunContext {
  // 当前 run 的唯一标识。
  runId: string
  // 当前会话标识，用于关联历史与消息落盘。
  sessionId: string
  // 当前绑定的工作区。
  // 正常 workbench 发送前会先完成工作区选择；这里保留 optional 仅用于内部防御式兜底。
  workspace?: {
    // 工作区唯一标识。
    workspaceId: string
    // 工作区名称，用于 AI 可读上下文。
    workspaceName: string
    // 工作区根路径，后续本地相对路径都以它为基准。
    rootPath: string
    // 可选的策略配置。
    policyProfile?: string
  }
  // 唯一的“用户选择的参考资料”文本投影。
  // 固定包含当前工作区背景、默认 KB 搜索范围说明、参考资料类型说明、当前用户选择列表和对应的 kbDocumentIds。
  selectedContextText: string
}
```

## 2. `director` 数据定义

### `DirectorState`

```ts
interface DirectorState {
  // 当前 run 的唯一标识。
  runId: string
  // 当前会话标识，用于关联消息和历史记录。
  sessionId: string
  // director 层运行状态。
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  // 用户本轮原始输入。
  input: string
  // director 当前所在节点。
  directorStage:
    | 'director_intent'
    | 'director_context_human'
    | 'director_plan'
    | 'director_plan_exec'
    | 'director_direct_human_exec'
    | 'director_synthesis_human'
    | 'director_complete'
  // 已经进行过多少轮上下文补充。
  contextRounds: number
  // 当前上下文补充阶段派发给 context human 的任务目标。
  contextObjective?: string
  // context 阶段得到的关键证据摘要。
  contextEvidence: string[]
  // 计划任务列表，每一项都是后续派发给 human 的任务。
  plan: DirectorPlanTask[]
  // 当前指向下一项待派发任务的游标。
  dispatchCursor: number
  // run 级错误信息。
  error?: string
  // director 最终对用户输出的 markdown。
  finalDeliveryMarkdown?: string
  // run 结束时可供系统继续消费的结构化交付物引用。
  finalArtifacts: AiArtifactRef[]
}

interface DirectorPlanTask {
  // 计划任务 ID。
  id: string
  // 任务短标题，主要用于日志和 UI。
  title: string
  // 派发给 human 的任务输入。
  userInput: string
  // 任务状态。
  // ready 表示尚未派发；completed 表示已经完成当前可交付内容。
  status: 'ready' | 'running' | 'completed'
  // 该任务的正式交付内容。
  // 在 plan 链路中，通常是供后续任务与 synthesis 使用的 task_handoff 文档。
  deliveryMarkdown?: string
  // 该任务已经产生的结构化交付物引用。
  artifacts?: AiArtifactRef[]
}

type AiArtifactRef =
  | {
      // artifact 类型；文件类产物。
      kind: 'file'
      // 产物由哪个能力域生成。
      capability: 'terminal_exec' | 'docx'
      // 文件绝对路径。
      path: string
      // 文件名。
      fileName: string
      // 这次操作是创建新文件还是更新已有文件。
      operation: 'created' | 'updated'
      // 产物角色；例如 preview / draft / committed。
      artifactRole?: 'preview' | 'draft' | 'committed'
      // 若来自 draft review，则记录 reviewId。
      reviewId?: string
      // 若是 docx draft，则记录 draft documentId。
      draftDocumentId?: string
      // 若是 docx draft，则记录 draft snapshotId。
      draftSnapshotId?: string
      // 面向 AI 和日志的简洁说明。
      summary: string
    }
  | {
      // artifact 类型；draft review 聚合结果。
      kind: 'draft_review'
      review: {
        // review 唯一标识。
        reviewId: string
        // 本次 review 涉及的文档数。
        documentCount: number
        // 本次 review 涉及的修改数。
        changeCount: number
      }
      // 面向 AI 和日志的简洁说明。
      summary: string
    };

interface HumanTaskInput {
  // 当前 human 任务 ID。
  taskId: string
  // 派发给当前 human 的自然语言任务输入。
  userInput: string
}

interface HumanRunDispatchOptions {
  // 当前 human 结果要按哪种交付模式组织。
  deliveryMode?: 'user_answer' | 'task_handoff' | 'context_note'
}
```

## 3. `human` 数据定义

### `HumanState`

```ts
type HumanStage = 'brain' | 'learning' | 'hand' | 'mouth'
type HumanStatus = 'running' | 'completed'
type MemoryOpField = 'facts' | 'evidences' | 'openQuestions'

interface HumanState {
  // 当前 human 任务输入。
  task: HumanTaskInput
  runtime: {
    // 当前 human 所在节点。
    stage: HumanStage
    // 当前 human 运行状态。
    status: HumanStatus
  }
  brainMemory: {
    inside: {
      // 只允许 brain 通过 memoryOps 更新。
      // 已确认事实，必须能追溯到 evidences。
      facts: BrainFact[]
      // 只允许 brain 通过 memoryOps 更新。
      // 对工具结果的提炼摘要，不存放大段原始输出。
      evidences: BrainEvidence[]
      // 只允许 brain 通过 memoryOps 更新。
      // 当前仍影响推进的问题。
      openQuestions: string[]
    }
    outside: {
      // 由 learning / hand / runner 更新。
      // 技能目录，只放少量摘要信息，供 brain 判断要不要学习。
      skillCatalog: SkillCatalogItem[]
      // 由 learning / runner 更新。
      // 已学习的 external skill 列表；builtin skill 不写入这里。
      learnedSkillIds: string[]
      // 由 brain 输出后原样推进写入，供回看和审计。
      brainDecisions: BrainDecisionRecord[]
    }
  }
  // 过程历史与按需加载的旧历史上下文。
  processMemory: HumanProcessMemory
  // 最近一次 hand 工具执行计划完成后的结果数组。
  lastToolUseResults?: ToolCallResult[]
  // 最近一次 learning 的真实执行结果。
  lastLearningOutcome?: HumanLearningOutcome
  // 最近一次 brain 输出的当前决策快照。
  // learning / hand / mouth 通过它读取当前 nextAction。
  lastBrainDecision?: LastBrainDecision
  // 收敛或纠偏提示；例如 toolUsePlan 非法、learning 无实际效果、记忆编辑失败。
  watchHint?: HumanWatchHint
  // 运行时收集到的结构化交付物引用；由 hand 写入、mouth 透传。
  runtimeArtifacts: AiArtifactRef[]
  // 最终任务结果，只由 mouth 写入。
  result?: HumanResult
  trace: {
    // 执行轨迹，仅用于审计和回放。
    steps: HumanTraceStep[]
  }
}
```

### `brainMemory.inside`

```ts
interface BrainEvidence {
  // evidence 唯一标识。
  id: string
  // 这条 evidence 来源于哪个工具。
  toolName: string
  // 对原始工具结果的高价值提炼。
  summary: string
  // 指向原始结果或日志位置的引用。
  rawRef?: string
  // 当前固定为 tool_result，表示来源是工具执行结果。
  sourceType: 'tool_result'
}

interface BrainFact {
  // fact 唯一标识。
  id: string
  // 由 evidence 推断出来的事实摘要。
  summary: string
  // 支撑该 fact 的 evidence 引用列表。
  evidenceIds: string[]
}
```

### `brainMemory.outside`

```ts
interface SkillCatalogItem {
  // skill 唯一标识。
  skillId: string
  // skill 对应的工具实现域。
  familyId: 'terminal' | 'kb' | 'docx' | 'internal'
  // skill 来源；builtin 始终可用，external 需要 learning。
  source: 'builtin' | 'external'
  // skill 可用方式。
  availability: 'always_on' | 'learnable'
  // 是否计入 active tool budget。
  countsTowardToolBudget: boolean
  // skill 标题。
  title: string
  // skill 的简要说明。
  summary: string
  // 该 skill 可提供的工具名列表。
  toolNames: string[]
  // 这个 skill 适合在什么情况下使用。
  whenToUse: string
}
```


### `lastBrainDecision`、`brainDecisions` 与 `processMemory`

```ts
interface LastBrainDecision {
  // 本轮 brain 对 brainMemory.inside 的增量更新操作。
  memoryOps: BrainMemoryOp[]
  // 本轮 brain 的正式决策内容。
  decision: BrainDecision
  // 当前是否已经具备最终交付所需的信息、证据和产物。
  readyToDeliver: boolean
  // 下一跳动作对象。
  // action 决定下一跳，附带该动作所需的数据。
  nextAction: BrainNextAction
}

interface BrainDecisionRecord extends LastBrainDecision {
  // 本条历史 brain 决策的写入时间。
  createdAt: number
}

interface HumanHistoryToolResult {
  // 对应的工具名。
  toolName: string
  // 该工具是否成功执行。
  ok: boolean
  // 标准化结果码。
  code: ToolCallResult['code']
  // 统一渲染后的结果主文案，供历史 prompt 直接复用。
  summary: string
  // 对工具 data 的轻量预览文本。
  dataPreview?: string
  // 对 diagnostic 的轻量预览文本。
  diagnosticText?: string
  // 该工具结果直接产出的结构化 artifact 引用。
  artifactRefs?: AiArtifactRef[]
}

type HumanRoundExecution =
  | {
      // 这轮在真正进入执行前就被系统阻断。
      kind: 'pre_execution_blocked'
      // 阻断原因。
      watchHint: HumanWatchHint
    }
  | {
      // 这轮执行的是 learning。
      kind: 'learning'
      // learning 的真实 outcome。
      learningOutcome: HumanLearningOutcome
      // learning 结束后若需要纠偏，则给出 watchHint。
      watchHint?: HumanWatchHint
    }
  | {
      // 这轮执行的是 hand。
      kind: 'hand'
      // 本轮 hand 执行计划。
      toolUsePlan: ToolUsePlan
      // 归一化后的工具结果数组。
      toolResults: HumanHistoryToolResult[]
      // hand 结束后若需要纠偏，则给出 watchHint。
      watchHint?: HumanWatchHint
      // 本轮 hand 直接产出的 artifact 引用。
      artifactRefs?: AiArtifactRef[]
    }
  | {
      // 这轮执行的是 mouth。
      kind: 'mouth'
      // mouth 产出的结果摘要。
      summary: string
      // mouth 是否把任务收敛到完成态。
      completed: boolean
    }

interface HumanRoundRecord {
  // round 历史序号；按 brain 决策轮次递增。
  roundId: number
  // 本轮写入时间。
  createdAt: number
  // 这轮 brain 的正式决策快照。
  decision: LastBrainDecision
  // 这轮实际发生的执行结果。
  execution: HumanRoundExecution
}

interface HumanLoadedHistoryContext {
  filters: {
    // 仅回看指定 roundId 列表。
    roundIds?: number[]
    // 仅回看指定 execution kind。
    executionKinds?: Array<'pre_execution_blocked' | 'learning' | 'hand' | 'mouth'>
    // 仅回看包含指定工具名的 hand 轮次。
    toolNames?: string[]
    // 仅回看命中过指定 watchHint code 的轮次。
    watchHintCodes?: HumanWatchHint['code'][]
    // 单次最多加载多少轮。
    limit?: number
  }
  // 经过过滤后真正加载进 prompt 的 round 记录。
  rounds: HumanRoundRecord[]
}

interface HumanProcessMemory {
  // 最近几轮过程历史。
  roundHistory: HumanRoundRecord[]
  // 最近一次 history_recall 主动加载出来的旧历史。
  loadedHistoryContext?: HumanLoadedHistoryContext
}

type BrainNextAction =
  | {
      // 进入 learning 节点。
      action: 'learning'
      // 本轮希望补充学习的 skill 列表。
      wantLearnSkillIds: string[]
    }
  | {
      // 进入 hand 节点。
      action: 'hand'
      // 本轮需要执行的工具计划；单轮只能选一种 mode。
      toolUsePlan: ToolUsePlan
    }
  | {
      // 进入 mouth 节点。
      action: 'mouth'
    };

type BrainMemoryOp =
  | {
      // 增量新增 facts 项。
      op: 'add'
      field: 'facts'
      value: BrainFact
    }
  | {
      // 按索引编辑 facts 项。
      op: 'edit'
      field: 'facts'
      index: number
      value: BrainFact
    }
  | {
      // 增量新增 evidences 项。
      op: 'add'
      field: 'evidences'
      value: BrainEvidence
    }
  | {
      // 按索引编辑 evidences 项。
      op: 'edit'
      field: 'evidences'
      index: number
      value: BrainEvidence
    }
  | {
      // 增量新增 openQuestions 项。
      op: 'add'
      field: 'openQuestions'
      value: string
    }
  | {
      // 按索引编辑 openQuestions 项。
      op: 'edit'
      field: 'openQuestions'
      index: number
      value: string
    }
  | {
      // 按索引删除 inside 中的某一项。
      op: 'remove'
      field: MemoryOpField
      index: number
    }

interface BrainDecision {
  // 对本轮决策的短摘要。
  summary: string
  // 做出该决策的原因。
  reason: string
  // 期望这一步带来的结果。
  expectedOutcome: string
}

interface ToolCallParam {
  // 要调用的工具名。
  toolName: string
  // 工具调用参数。
  args: JsonObject
}

interface ToolUsePlan {
  // 并行读取或串行执行。
  mode: 'parallel' | 'serial'
  // 本轮要执行的工具调用列表。
  calls: ToolCallParam[]
}
```



### `lastToolUseResults`、`lastLearningOutcome`、`processMemory` 与 `result`

```ts
interface ToolCallResult {
  // 本次调用的工具名。
  toolName: string
  // 工具是否成功执行。
  ok: boolean
  // 工具结果码。
  code:
    | 'ok'
    | 'failed'
    | 'workspace_required'
    | 'approval_denied'
    | 'invalid_input'
  // 工具返回的结构化数据。
  data?: JsonValue
  // 对失败原因的结构化归因，帮助下一轮 brain 恢复。
  diagnostic?: ToolCallDiagnostic
}

interface ToolCallDiagnostic {
  // 失败归因类型。
  kind:
    | 'workspace_required'
    | 'invalid_input'
    | 'approval_denied'
    | 'path_unavailable'
  // 若失败原因能归约到缺字段，则给出最小字段名列表。
  missingArgs?: string[]
}

interface HumanLearningOutcome {
  // 本轮 learning 请求的原始 skill 列表。
  requestedSkillIds: string[]
  // 这轮真正新加载成功的 external skill。
  loadedSkillIds: string[]
  // 因已存在或 builtin 而被跳过的 skill。
  skippedDuplicateSkillIds: string[]
  // 因未识别而被跳过的 skill。
  skippedUnknownSkillIds: string[]
  // 因 active tool budget 收缩而被淘汰的旧 skill。
  evictedSkillIds: string[]
  // 本轮结束后的 active tool 数。
  activeToolCount: number
}


type HumanWatchHint =
  | {
      code: 'learning_no_effect'
      detail: {
        // 本轮请求的全部 skill。
        requestedSkillIds: string[]
        // 因重复或 builtin 而没有实际生效的 skill。
        duplicateSkillIds: string[]
        // 当前 runtime 无法识别的 skill。
        unknownSkillIds: string[]
      }
    }
  | {
      code: 'learning_tool_budget_exceeded'
      detail: {
        // 触发 budget 检查时请求的 skill。
        requestedSkillIds: string[]
        // 当前 active tool 数。
        activeToolCount: number
        // 允许的最大 active tool 数。
        limit: number
      }
    }
  | {
      code: 'hand_plan_invalid'
      detail: {
        // 当前非法计划声明的 mode。
        mode: 'parallel' | 'serial'
        // 非法原因。
        reason: 'parallel_requires_read_only' | 'parallel_limit_exceeded'
        // 导致非法的工具列表。
        offendingToolNames: string[]
        // 当前计划的调用数。
        callCount?: number
        // 对应的并行上限。
        limit?: number
      }
    }
  | {
      code: 'hand_tool_limit_exceeded'
      detail: {
        // 当前累计工具调用数。
        toolCallCount: number
        // 允许的临时 hardActionLimit。
        limit: number
      }
    }
  | {
      code: 'brain_invalid_mouth_transition' | 'memory_invalid_op'
      // 这类 hint 当前不需要额外 detail 字段。
      detail: {}
    };

interface MouthOutput {
  // 面向用户或后续任务的一句简洁摘要。
  summary: string
  // 正式交付 markdown；允许为空，由 runner 做 fallback。
  deliveryMarkdown?: string
}

interface HumanResult {
  // human 最终状态。
  status: 'completed'
  // 最终结果摘要。
  summary: string
  // 最终对用户交付的 markdown。
  deliveryMarkdown?: string
  // 运行时附加的结构化交付物引用。
  artifacts?: AiArtifactRef[]
}

interface HumanTaskOutput {
  // 本次 human 执行所对应的任务 ID。
  taskId: string
  // 本次任务的最终状态。
  status: 'completed'
  // 任务结果摘要。
  summary: string
  // 正式交付 markdown。
  deliveryMarkdown?: string
  // 运行时附加的结构化交付物引用。
  artifacts?: AiArtifactRef[]
}

interface HumanTraceStep {
  // 当前步骤编号。
  step: number
  // 当前步骤动作类型。
  action:
    | 'brain_decision'
    | 'learn_skill'
    | 'call_tool'
    | 'deliver_result'
  // 面向外部轨迹的叙述。
  publicNarrative: string
  // 当前步骤的结果状态。
  resultStatus?: 'ok' | 'error'
  // 若本步与 skill 有关，则记录 skillId。
  skillId?: string
  // 若本步与 tool 有关，则记录 toolName。
  toolName?: string
  // 当前步骤摘要。
  summary: string
}
```


### `tool_call_result` 事件与结构化模型日志

```ts
interface ToolCallResultEvent {
  // 事件类型。
  type: 'tool_call_result'
  // 所属 run。
  runId: string
  // 若来自 human 子任务，则带 taskId。
  taskId?: string
  // 本次工具调用的唯一标识。
  toolCallId: string
  // 对应工具名。
  toolName: string
  // 轻量时间线展示使用的输出预览。
  outputPreview: IpcJsonValue
  // 标准化后的工具结果，供后续 AI 或排障直接消费。
  result?: ToolCallResult
  // 工具调用完成时间。
  completedAt: number
  // 若调用失败，补充错误文本。
  error?: string
}

interface AiActivityDetails {
  // 本次 activity 对应的 callId。
  callId?: string
  // 谁发起了这次 activity；例如 human.brain。
  caller?: string
  // 本次结构化输出使用的 schema 名称。
  schemaName?: string
  // 本次调用使用的模型名。
  model?: string
  // 调用耗时。
  durationMs?: number
  // 结构化输出方法。
  method?: 'jsonSchema' | 'jsonMode' | 'promptJson' | 'scripted'
  // 使用的底层 transport。
  transport?: 'completions' | 'responses'
  // 最终选择的 profile。
  profile?:
    | 'completions:jsonSchema'
    | 'completions:jsonMode'
    | 'completions:promptJson'
    | 'responses:jsonSchema'
    | 'responses:promptJson'
    | 'scripted'
  // 这次调用可尝试的 fallback profile 链。
  fallbackChain?: Array<
    | 'completions:jsonSchema'
    | 'completions:jsonMode'
    | 'completions:promptJson'
    | 'responses:jsonSchema'
    | 'responses:promptJson'
    | 'scripted'
  >
  // 若出现 fallback 或失败，补充原因。
  reason?: string
}

interface AiLlmIoRecord {
  // 本次结构化调用的唯一标识。
  callId: string
  // 所属 run。
  runId: string
  // 若来自 human 子任务，则带 taskId。
  taskId?: string
  // 调用方；例如 human.brain 或 human.mouth。
  caller: string
  // 使用的 schema 名称。
  schemaName: string
  // 使用的模型名。
  model: string
  // 最终 system prompt。
  system: string
  // 最终 user prompt。
  user: string
  // 结构化输出结果。
  output?: JsonValue
  // 结构化输出方法。
  method?: 'jsonSchema' | 'jsonMode' | 'promptJson' | 'scripted'
  // 使用的底层 transport。
  transport?: 'completions' | 'responses'
  // 最终选择的 profile。
  profile?:
    | 'completions:jsonSchema'
    | 'completions:jsonMode'
    | 'completions:promptJson'
    | 'responses:jsonSchema'
    | 'responses:promptJson'
    | 'scripted'
  // 本次调用可尝试的 fallback profile 链。
  fallbackChain: Array<
    | 'completions:jsonSchema'
    | 'completions:jsonMode'
    | 'completions:promptJson'
    | 'responses:jsonSchema'
    | 'responses:promptJson'
    | 'scripted'
  >
  // 开始时间。
  startedAt: number
  // 完成时间。
  completedAt: number
  // 调用总耗时。
  durationMs: number
  // 本次调用状态。
  status: 'completed' | 'failed'
  // 若失败或触发 fallback，补充原因。
  reason?: string
}
```


## 4. 数据流转图

下面的图按阶段拆开，每张图只表达一段数据读写。

### `director` 直接路径：`direct human`

```mermaid
flowchart LR
    U["用户输入"]
    S1[("DirectorState.input / directorStage")]
    MI["director_intent"]
    MD["director_direct_human_exec"]
    H["human 输出结果"]
    S2[("DirectorState.finalDeliveryMarkdown / finalArtifacts")]
    S3[("DirectorState.status / error")]

    U -->|写入 input| S1
    S1 -->|读取 input + directorStage| MI
    MI -->|回写 directorStage| S1
    S1 -->|默认路径读取 input| MD
    MD -->|派发 taskId + userInput + deliveryMode=user_answer| H
    H -->|返回 taskId + status + summary + deliveryMarkdown + artifacts| MD
    MD -->|写入最终交付| S2
    S2 -->|进入收尾| S3
```

### `director` 阶段一：输入进入 `context / plan`

```mermaid
flowchart LR
    U["用户输入"]
    S1[("DirectorState.input / directorStage")]
    MI["director_intent"]
    S2[("DirectorState.contextObjective / contextRounds / contextEvidence")]
    MC["director_context_human"]
    MP["director_plan"]
    S3[("DirectorState.plan / dispatchCursor")]

    U -->|写入 input| S1
    S1 -->|读取 input + directorStage| MI
    MI -->|回写 directorStage| S1
    S1 -->|复杂任务时读取 input| MC
    S2 -->|读取旧 context 状态| MC
    MC -->|回写 contextRounds + contextEvidence + directorStage| S2
    S1 -->|读取 input| MP
    S2 -->|读取 contextEvidence| MP
    MP -->|写入 plan + dispatchCursor + directorStage| S3
```

### `director` 阶段二：计划派发、结果回写、最终收尾

```mermaid
flowchart LR
    S3[("DirectorState.plan / dispatchCursor")]
    ME["director_plan_exec"]
    H["human 输出结果"]
    MS["director_synthesis_human"]
    S4[("DirectorState.finalDeliveryMarkdown / finalArtifacts")]
    MX["director_complete"]
    S5[("DirectorState.status / error")]

    S3 -->|读取当前游标任务| ME
    ME -->|派发 taskId + userInput| H
    H -->|返回 taskId + status + summary + deliveryMarkdown + artifacts| ME
    ME -->|回写当前任务结果 + 更新 dispatchCursor| S3
    S3 -->|全部完成或阻塞后读取所有任务结果| MS
    MS -->|写入最终交付| S4
    S4 -->|进入收尾| MX
    MX -->|写入 run 终态| S5
```

### `human` 阶段一：`brain` 读取输入并产出决策

```mermaid
flowchart LR
    T[("task")]
    BM[("brainMemory")]
    PM[("processMemory.roundHistory / loadedHistoryContext")]
    LBD[("lastBrainDecision")]
    BD[("brainMemory.outside.brainDecisions")]
    WH[("watchHint")]
    B["brain"]
    TR[("trace.steps")]

    T -->|读取 taskId + userInput| B
    BM -->|读取 inside + outside| B
    PM -->|读取上一轮焦点与历史链| B
    WH -->|存在时读取收敛提示| B
    B -->|通过 memoryOps 回写 inside| BM
    B -->|写入新的当前决策快照| LBD
    B -->|追加新的 BrainDecisionRecord| BD
    B -->|追加 brain 执行轨迹| TR
```

### `human` 阶段二：`learning` 路径的数据流转

```mermaid
flowchart LR
    LBD[("lastBrainDecision.nextAction.wantLearnSkillIds")]
    L["learning"]
    BM[("brainMemory.outside.learnedSkillIds / skillCatalog")]
    LLO[("lastLearningOutcome")]
    PM[("processMemory.roundHistory")]
    WH[("watchHint")]
    TR[("trace.steps")]
    B["brain"]

    LBD -->|读取 wantLearnSkillIds| L
    L -->|首次学习时写回 learnedSkillIds| BM
    L -->|写入本轮真实 learning outcome| LLO
    L -->|追加 learning round| PM
    L -->|整轮无新 skill 或 budget 超限时写入| WH
    L -->|追加 learning 执行轨迹| TR
    L -->|返回下一轮 brain| B
```

### `human` 阶段三：`hand` 路径的数据流转

```mermaid
flowchart LR
    LBD[("lastBrainDecision.nextAction.toolUsePlan")]
    H["hand"]
    LTR[("lastToolUseResults")]
    PM[("processMemory.roundHistory / loadedHistoryContext")]
    A[("runtimeArtifacts")]
    WH[("watchHint")]
    TR[("trace.steps")]
    B["brain"]

    LBD -->|读取 toolUsePlan| H
    H -->|写入本轮工具结果数组| LTR
    H -->|追加 hand round 或 loaded history| PM
    H -->|从工具结构化输出提取并回写 artifacts| A
    H -->|plan 非法或超过累计工具调用临时上限时写入| WH
    H -->|追加 hand 执行轨迹| TR
    H -->|返回下一轮 brain| B
```

### `human` 阶段四：`mouth` 路径的数据流转

```mermaid
flowchart LR
    T[("task")]
    BM[("brainMemory")]
    PM[("processMemory.roundHistory")]
    LBD[("lastBrainDecision")]
    A[("runtimeArtifacts")]
    WH[("watchHint")]
    M["mouth"]
    R[("result")]
    TR[("trace.steps")]

    T -->|读取 taskId + userInput| M
    BM -->|读取 facts / evidences / openQuestions| M
    PM -->|读取上一轮完整闭环| M
    LBD -->|读取当前最终决策| M
    A -->|读取已收集的结构化 artifacts| M
    WH -->|必要时整理为交付提示| M
    M -->|输出 summary + deliveryMarkdown；runner 回写 completed result，并透传 artifacts| R
    M -->|追加 mouth 执行轨迹| TR
```
