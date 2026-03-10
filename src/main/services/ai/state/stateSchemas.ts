import type { StructuredToolInterface } from '@langchain/core/tools'
import { StateSchema } from '@langchain/langgraph'
import { z } from 'zod/v4'
import {
  HUMAN_STEP_ACTIONS,
  HUMAN_STEP_RESULT_STATUSES,
  RUNTIME_SKILL_IDS,
  RUNTIME_SKILL_REQUIREMENTS
} from '../../../../shared/constants'
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
    outputText: z.string().optional(),
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
    // 当前任务 ID。
    taskId: z.string(),
    // 当前任务执行目标。
    objective: z.string()
  })
  const runtimeSkillIdSchema = z.enum(RUNTIME_SKILL_IDS)
  const runtimeSkillRequirementSchema = z.enum(RUNTIME_SKILL_REQUIREMENTS)
  const humanStepActionSchema = z.enum(HUMAN_STEP_ACTIONS)
  const humanStepResultStatusSchema = z.enum(HUMAN_STEP_RESULT_STATUSES)
  const skillCardSchema = z.object({
    id: runtimeSkillIdSchema,
    name: z.string(),
    summary: z.string(),
    whenToUse: z.string(),
    unlocks: z.array(z.string()),
    requires: z.array(runtimeSkillRequirementSchema).optional()
  })
  const loadedSkillSchema = z.object({
    skillId: runtimeSkillIdSchema,
    skillContent: z.string(),
    referencedAssets: z.array(z.string()),
    toolNames: z.array(z.string()),
    loadedAtStep: z.number()
  })
  const humanStepDecisionSchema = z.discriminatedUnion('action', [
    z.object({
      action: z.literal('load_skill'),
      skillId: runtimeSkillIdSchema,
      rationale: z.string(),
      publicNarrative: z.string()
    }),
    z.object({
      action: z.literal('invoke_tool'),
      toolName: z.string(),
      args: jsonObjectSchema,
      rationale: z.string(),
      publicNarrative: z.string()
    }),
    z.object({
      action: z.literal('complete_task'),
      summary: z.string(),
      rationale: z.string(),
      publicNarrative: z.string(),
      resultData: jsonObjectSchema.optional()
    }),
    z.object({
      action: z.literal('block_task'),
      reason: z.string(),
      rationale: z.string(),
      publicNarrative: z.string(),
      details: jsonValueSchema.optional()
    })
  ])
  const humanStepRecordSchema = z.object({
    step: z.number(),
    action: humanStepActionSchema,
    publicNarrative: z.string(),
    activeSkillIds: z.array(runtimeSkillIdSchema),
    activeToolNames: z.array(z.string()),
    resultStatus: humanStepResultStatusSchema.optional(),
    skillId: runtimeSkillIdSchema.optional(),
    toolName: z.string().optional(),
    summary: z.string().optional()
  })
  const humanObservationSchema = z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('skill_loaded'),
      skillId: runtimeSkillIdSchema,
      summary: z.string(),
      activeSkillIds: z.array(runtimeSkillIdSchema),
      activeToolNames: z.array(z.string())
    }),
    z.object({
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
    }),
    z.object({
      kind: z.literal('terminal'),
      status: z.enum(['completed', 'blocked']),
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

  return new StateSchema({
    // 所属 runId（与 main 保持一致）。
    runId: z.string(),
    // 当前 human 任务输入契约。
    input: humanTaskInputSchema,
    // human 内部路由阶段（brain/skill_loader/tool_exec）。
    phase: z.enum(['brain', 'skill_loader', 'tool_exec']).default('brain'),
    // human 执行状态：running/completed/blocked。
    status: z.enum(['running', 'completed', 'blocked']).default('running'),
    // 当前累计步数。
    steps: z.number().default(0),
    // 最大步数保护阈值。
    maxSteps: z.number().default(6),
    // brain 常驻可见的轻量 skill 卡片。
    availableSkillCards: z.array(skillCardSchema).default(() => []),
    // 已加载 skill 的文本与资源元数据缓存。
    loadedSkills: z.record(z.string(), loadedSkillSchema).default(() => ({})),
    // 已加载 skill 对应的运行态工具集缓存。
    loadedToolsets: z
      .record(
        z.string(),
        z.array(
          z.custom<StructuredToolInterface>((value) => typeof value === 'object' && value !== null)
        )
      )
      .default(() => ({})),
    // 当前激活中的 skill 列表（MRU 顺序）。
    activeSkillIds: z.array(runtimeSkillIdSchema).default(() => []),
    // 当前激活 skill 派生的工具集合。
    activeTools: z
      .array(
        z.custom<StructuredToolInterface>((value) => typeof value === 'object' && value !== null)
      )
      .default(() => []),
    // 最近一次执行观察。
    lastObservation: humanObservationSchema.optional(),
    // 最近一步 brain 决策。
    lastDecision: humanStepDecisionSchema.optional(),
    // 已完成步骤的公开记录。
    stepHistory: z.array(humanStepRecordSchema).default(() => []),
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
