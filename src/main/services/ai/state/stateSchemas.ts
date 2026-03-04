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
    // 当前 run 的唯一标识。
    runId: z.string(),
    // 会话 ID，用于历史读取与消息落库关联。
    sessionId: z.string(),
    // run 生命周期状态（main 全局）。
    status: z.enum(['running', 'completed', 'failed', 'cancelled']).default('running'),
    // 用户本轮输入。
    input: z.string(),
    // main graph 路由阶段唯一来源。
    mainStage: z
      .enum(['main_intent', 'main_context_enrich', 'main_plan', 'main_plan_exec', 'main_finalize'])
      .default('main_intent'),
    // 已执行的上下文补充轮次。
    contextRounds: z.number().default(0),
    // context_enrich 使用的任务目标。
    contextObjective: z.string().optional(),
    // 上下文补充证据摘要（intent/plan/finalize 共享）。
    contextEvidence: z.array(z.string()).default(() => []),
    // main_plan 生成并由 main_plan_exec 更新的任务列表。
    plan: z
      .array(
        z.object({
          // run 内唯一任务 ID。
          id: z.string(),
          // 任务标题（日志/UI）。
          title: z.string(),
          // 任务执行目标（human 直接输入）。
          objective: z.string(),
          // 任务状态。
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
    // main_plan_exec 串行游标，指向下一候选 pending task。
    dispatchCursor: z.number().default(0),
    // run 级错误文本。
    error: z.string().optional(),
    // finalize 产出的最终文本。
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
    // 当前任务 ID。
    taskId: z.string(),
    // 子任务模式（context/dispatch）。
    mode: z.enum(['context', 'dispatch']),
    // 当前任务执行目标。
    objective: z.string()
  })

  return new StateSchema({
    // 所属 runId（与 main 保持一致）。
    runId: z.string(),
    // 当前 human 任务输入契约。
    input: humanTaskInputSchema,
    // human 内部路由阶段（brain/tool_exec）。
    phase: z.enum(['brain', 'tool_exec']).default('brain'),
    // human 执行状态：running/completed/blocked。
    status: z.enum(['running', 'completed', 'blocked']).default('running'),
    // 当前累计步数。
    steps: z.number().default(0),
    // 最大步数保护阈值。
    maxSteps: z.number().default(6),
    // 传给模型的消息上下文（含 tool result）。
    messages: z
      .array(z.custom<BaseMessage>((value) => typeof value === 'object' && value !== null))
      .default(() => []),
    // 本步可用工具集合（capability + control）。
    activeTools: z
      .array(
        z.custom<StructuredToolInterface>((value) => typeof value === 'object' && value !== null)
      )
      .default(() => []),
    // 最近一条 AIMessage（tool call 来源）。
    lastAiMessage: z
      .custom<AIMessage>((value) => typeof value === 'object' && value !== null)
      .optional(),
    // 最近一次调用的工具名。
    lastToolName: z.string().optional(),
    // human 收敛摘要。
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
