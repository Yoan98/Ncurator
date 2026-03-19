import { StateSchema } from '@langchain/langgraph'
import { z } from 'zod/v4'
import { HUMAN_STEP_ACTIONS, HUMAN_STEP_RESULT_STATUSES, RUNTIME_SKILL_IDS } from '../../../../shared/constants'
import {
  type HumanTaskInput,
  type JsonObject,
  type JsonValue
} from '../../../../shared/types'

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
      .enum([
        'main_intent',
        'main_context_human',
        'main_plan',
        'main_plan_exec',
        'main_direct_human_exec',
        'main_synthesis_human',
        'main_complete'
      ])
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
          // 任务正式交付 markdown。
          deliveryMarkdown: z.string().optional(),
          // 结果结构化数据。
          resultData: jsonObjectSchema.optional()
        })
      )
      .default(() => []),
    // main_plan_exec 串行游标，指向下一候选 pending task。
    dispatchCursor: z.number().default(0),
    // run 级错误文本。
    error: z.string().optional(),
    // direct human / synthesis human 产出的最终交付。
    finalDeliveryMarkdown: z.string().optional(),
    // 产生最终交付的任务 ID。
    finalDeliveryTaskId: z.string().optional(),
    // 本地资料使用状态。
    localSourceStatus: z.enum(['used', 'not_used', 'insufficient']).optional(),
    // 本地资料使用或不足说明。
    localSourceSummary: z.string().optional()
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
    taskId: z.string(),
    objective: z.string()
  })
  const runtimeSkillIdSchema = z.enum(RUNTIME_SKILL_IDS)
  const humanStepActionSchema = z.enum(HUMAN_STEP_ACTIONS)
  const humanStepResultStatusSchema = z.enum(HUMAN_STEP_RESULT_STATUSES)
  const humanFactSchema = z.object({
    id: z.string(),
    summary: z.string(),
    evidenceIds: z.array(z.string())
  })
  const evidenceRefSchema = z.object({
    id: z.string(),
    kind: z.enum(['tool_result', 'user_input', 'prior_delivery']),
    summary: z.string(),
    toolName: z.string().optional(),
    sourceRef: z.string().optional()
  })
  const humanFocusSchema = z.object({
    current: z.string().optional()
  })
  const humanActionSpecSchema = z.discriminatedUnion('type', [
    z.object({
      type: z.literal('activate_capability'),
      skillId: runtimeSkillIdSchema,
      rationale: z.string(),
      publicNarrative: z.string()
    }),
    z.object({
      type: z.literal('invoke_tool'),
      toolName: z.string(),
      args: jsonObjectSchema,
      rationale: z.string(),
      publicNarrative: z.string()
    })
  ])
  const humanStepRecordSchema = z.object({
    step: z.number(),
    action: humanStepActionSchema,
    publicNarrative: z.string(),
    resultStatus: humanStepResultStatusSchema.optional(),
    skillId: runtimeSkillIdSchema.optional(),
    toolName: z.string().optional(),
    summary: z.string()
  })
  const humanObservationSchema = z.discriminatedUnion('kind', [
    z.object({
      id: z.string(),
      kind: z.literal('capability_activated'),
      skillId: runtimeSkillIdSchema,
      summary: z.string()
    }),
    z.object({
      id: z.string(),
      kind: z.literal('tool_result'),
      toolName: z.string(),
      ok: z.boolean(),
      code: z.enum([
        'ok',
        'failed',
        'workspace_required',
        'approval_denied',
        'bounded_loop_error',
        'invalid_input'
      ]),
      summary: z.string(),
      data: jsonValueSchema.optional()
    })
  ])
  const observationBatchSchema = z.object({
    summary: z.string(),
    observations: z.array(humanObservationSchema).default(() => [])
  })
  const reasonAnalysisSchema = z.object({
    summary: z.string()
  })
  const humanActionBatchSchema = z.object({
    summary: z.string(),
    actions: z.array(humanActionSpecSchema).default(() => [])
  })
  const watchdogHintSchema = z.object({
    level: z.enum(['warn', 'stop']),
    summary: z.string(),
    signs: z.array(z.string()).default(() => []),
    shouldConverge: z.boolean().default(false)
  })
  const humanOutcomeSchema = z.object({
    status: z.enum(['completed', 'blocked']),
    summary: z.string(),
    payload: jsonObjectSchema.optional(),
    presentation: z
      .object({
        markdown: z.string()
      })
      .optional(),
    provenance: z
      .object({
        localSourceStatus: z.enum(['used', 'not_used', 'insufficient']).optional(),
        localSourceSummary: z.string().optional()
      })
      .optional()
  })

  return new StateSchema({
    task: z.object({
      taskId: z.string(),
      objective: z.string()
    }).default(() => humanTaskInputSchema.parse({ taskId: '', objective: '' })),
    progress: z.object({
      phase: z.enum(['reasoning', 'executing', 'finalizing']).default('reasoning'),
      maxParallel: z.number().default(2)
    }).default(() => ({ phase: 'reasoning' as const, maxParallel: 2 })),
    memory: z.object({
      constraints: z.array(z.string()).default(() => []),
      facts: z.array(humanFactSchema).default(() => []),
      evidence: z.array(evidenceRefSchema).default(() => []),
      openQuestions: z.array(z.string()).default(() => []),
      focus: humanFocusSchema.default(() => ({
        current: undefined
      })),
      capabilityFocus: z.object({
        activeStack: z.array(runtimeSkillIdSchema).default(() => [])
      }).default(() => ({ activeStack: [] }))
    }).default(() => ({
      constraints: [],
      facts: [],
      evidence: [],
      openQuestions: [],
      focus: {
        current: undefined
      },
      capabilityFocus: {
        activeStack: []
      }
    })),
    turn: z.object({
      incoming: observationBatchSchema.optional(),
      analysis: reasonAnalysisSchema.optional(),
      actionBatch: humanActionBatchSchema.optional(),
      watchdogHint: watchdogHintSchema.optional()
    }).default(() => ({})),
    outcome: humanOutcomeSchema.optional(),
    trace: z.object({
      steps: z.array(humanStepRecordSchema).default(() => [])
    }).default(() => ({ steps: [] }))
  })
}
