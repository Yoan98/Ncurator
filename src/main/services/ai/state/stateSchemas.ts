import type { AIMessage, BaseMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { StateSchema } from '@langchain/langgraph'
import { z } from 'zod/v4'
import type { HumanTaskInput, JsonObject, JsonValue } from '../../../../shared/types'

export const createMainRunStateSchema = () => {
  const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(jsonValueSchema),
      z.record(z.string(), jsonValueSchema)
    ])
  )
  const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema)

  return new StateSchema({
    // 当前运行实例 ID（一次 ai-run-start 对应一个 runId）。
    runId: z.string(),
    // 对话会话 ID，用于加载历史与回写消息。
    sessionId: z.string(),
    // 运行总体状态，由 main 控制推进与收敛。
    status: z.enum(['running', 'completed', 'failed', 'cancelled']).default('running'),
    // 当前用户输入（本次 run 的原始目标）。
    input: z.string(),
    // main graph 当前阶段，作为主路由唯一来源。
    mainStage: z
      .enum([
        'main_context_gate',
        'main_context_dispatch',
        'main_plan',
        'main_dispatch',
        'main_finalize'
      ])
      .default('main_context_gate'),
    // 已执行的 context 补充轮次。
    contextRounds: z.number().default(0),
    // gate 的三态判定结果。
    contextDecision: z.enum(['need_context', 'to_plan', 'direct_finalize']).optional(),
    // gate 生成的 context 子任务目标，供 context_dispatch 调 human 时使用。
    contextTaskObjective: z.string().optional(),
    // 上下文证据摘要列表（用于后续 gate/plan/finalize）。
    contextEvidence: z.array(z.string()).default(() => []),
    // 可直接收敛时的答案草稿。
    directAnswerDraft: z.string().optional(),
    // 计划任务列表（main_plan 生成，main_dispatch 更新状态）。
    plan: z
      .array(
        z.object({
          // 任务唯一标识（run 内唯一）。
          id: z.string(),
          // 面向 UI/日志的短标题。
          title: z.string(),
          // 任务的可执行目标描述（human 真正执行依据）。
          objective: z.string(),
          // 可选能力提示，不做硬路由。
          kindHint: z.enum(['local_kb_retrieval', 'terminal_exec', 'docx']).optional(),
          // 任务生命周期状态。
          status: z.enum(['pending', 'running', 'completed', 'failed']),
          // 已尝试次数。
          attempts: z.number(),
          // 失败原因（仅 failed 时通常有值）。
          error: z.string().optional(),
          // 结构化结果码。
          resultCode: z
            .enum([
              'ok',
              'failed',
              'workspace_required',
              'approval_denied',
              'bounded_loop_error',
              'invalid_input'
            ])
            .optional(),
          // 结果摘要文本。
          resultMessage: z.string().optional(),
          // 结果结构化数据。
          resultData: jsonObjectSchema.optional()
        })
      )
      .default(() => []),
    // dispatch 串行游标，指向下一候选 pending task。
    dispatchCursor: z.number().default(0),
    // task 级 slot 状态（key=taskId）。
    taskSlots: z.record(z.string(), z.record(z.string(), jsonValueSchema)).default(() => ({})),
    // 大对象引用仓（slot 仅保存 ref + summary）。
    slotArtifacts: z.record(z.string(), jsonObjectSchema).default(() => ({})),
    // 最近一次 human 执行步数，供上层观察。
    humanStepIndex: z.number().default(0),
    // run 级错误文本。
    error: z.string().optional(),
    // 最终输出文本（finalize 产出）。
    outputText: z.string().optional()
  })
}

export const createHumanRunStateSchema = () => {
  const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(jsonValueSchema),
      z.record(z.string(), jsonValueSchema)
    ])
  )
  const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema)
  const humanTaskInputSchema: z.ZodType<HumanTaskInput> = z.object({
    // 当前运行实例 ID（来自 ai-run-start，与 main run 对齐）。
    runId: z.string(),
    // 会话 ID，用于历史消息读取与事件关联。
    sessionId: z.string(),
    // main 分配的任务 ID（在本次 run 内唯一）。
    taskId: z.string(),
    // 子任务模式：context=补充上下文，dispatch=执行计划任务。
    mode: z.enum(['context', 'dispatch']),
    // 任务标题（主要用于日志/UI 展示）。
    title: z.string(),
    // 任务可执行目标（human 执行的直接依据）。
    objective: z.string(),
    // 可选能力提示，仅辅助规划，不做硬路由。
    kindHint: z.enum(['local_kb_retrieval', 'terminal_exec', 'docx']).optional(),
    // 可选文档范围限制（仅在这些文档范围内检索）。
    selectedDocumentIds: z.array(z.string()).optional(),
    // 可选工作区绑定（terminal/docx 等需要文件系统边界的工具依赖该字段）。
    workspace: z
      .object({
        // 工作区唯一标识。
        workspaceId: z.string(),
        // 工作区根目录绝对路径。
        rootPath: z.string(),
        // 可选策略配置名（审批/边界策略可按 profile 区分）。
        policyProfile: z.string().optional()
      })
      .optional(),
    // 当前任务可读写的 slot 快照（key 为 `slot:xxx`）。
    slotState: jsonObjectSchema,
    // 大对象引用仓（slot 可只写 ref + summary，正文放这里）。
    slotArtifacts: z.record(z.string(), jsonObjectSchema).optional()
  })

  return new StateSchema({
    // 当前运行实例 ID（与 main runId 对齐）。
    runId: z.string(),
    // 会话 ID（用于历史和事件关联）。
    sessionId: z.string(),
    // 当前 human 子任务输入契约。
    input: humanTaskInputSchema,
    // human 内部阶段路由：brain -> tool_exec -> slot_commit -> exit。
    phase: z.enum(['brain', 'tool_exec', 'slot_commit', 'exit']).default('brain'),
    // human 终态（running/completed/blocked）。
    terminalState: z.enum(['running', 'completed', 'blocked']).default('running'),
    // 当前已执行步数。
    steps: z.number().default(0),
    // human 最大步数保护阈值。
    maxSteps: z.number().default(6),
    // 传给模型的对话消息（包含 tool result message）。
    messages: z
      .array(z.custom<BaseMessage>((value) => typeof value === 'object' && value !== null))
      .default(() => []),
    // 当前可见工具集合（全量 capability tools + control tools）。
    activeTools: z
      .array(z.custom<StructuredToolInterface>((value) => typeof value === 'object' && value !== null))
      .default(() => []),
    // toolName -> capability 的映射，用于事件与结果归类。
    capabilityByTool: z
      .record(z.string(), z.enum(['local_kb_retrieval', 'terminal_exec', 'docx']))
      .default(() => ({})),
    // 最近一条 AIMessage（tool call 来源）。
    lastAiMessage: z
      .custom<AIMessage>((value) => typeof value === 'object' && value !== null)
      .optional(),
    // 最近一次 ToolNode 产出的消息列表。
    lastToolMessages: z
      .array(z.custom<BaseMessage>((value) => typeof value === 'object' && value !== null))
      .default(() => []),
    // 最近一次调用的工具名。
    lastToolName: z.string().optional(),
    // 最近一次工具参数快照。
    lastToolArgs: jsonObjectSchema.optional(),
    // 本步声明的输入依赖槽位。
    consume: z.array(z.templateLiteral(['slot:', z.string().min(1)])).default(() => []),
    // 本步声明的输出槽位。
    produce: z.array(z.templateLiteral(['slot:', z.string().min(1)])).default(() => []),
    // 本步声明的必须产出槽位。
    expect: z.array(z.templateLiteral(['slot:', z.string().min(1)])).default(() => []),
    // tool_exec 归一后的待提交结果载荷。
    pendingPayload: jsonObjectSchema.optional(),
    // 当前 task 的 slot 状态。
    slotState: z.record(z.string(), jsonValueSchema).default(() => ({})),
    // 当前 task 的大对象引用仓。
    slotArtifacts: z.record(z.string(), jsonObjectSchema).default(() => ({})),
    // 本次 human 执行新增/更新的 slot 增量。
    slotDelta: jsonObjectSchema.default(() => ({})),
    // human 结果摘要。
    summary: z.string().default(''),
    // human 结果码。
    resultCode: z
      .enum([
        'ok',
        'failed',
        'workspace_required',
        'approval_denied',
        'bounded_loop_error',
        'invalid_input'
      ])
      .default('failed'),
    // human 结构化结果数据。
    resultData: jsonObjectSchema.optional()
  })
}
