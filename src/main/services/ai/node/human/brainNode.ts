import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type {
  AiTaskResultCode,
  HumanStepDecision,
  JsonObject,
  JsonValue,
  RuntimeSkillId
} from '../../../../../shared/types'
import { isJsonObject } from '../../../../utils/aiCapabilityUtils'
import { createChatModel } from '../../../llm/chatModel'
import type { AiRunContext } from '../../types'
import { buildHumanBrainPrompt } from '../../prompts/human/brain'
import { humanStepDecisionSchema } from './decisionCodec'
import { appendHumanStepRecord, emitHumanDiagnostic, emitHumanStep } from './events'
import { enrichCompleteTaskResultData } from './resultData'
import type { HumanObservation, HumanRunState, LoadedSkill } from './types'

const MAX_HISTORY_ITEMS = 10
const GENERIC_DOCUMENT_NAME_VALUES = new Set(['unknown', 'none', 'n-a', 'not-provided', 'missing', '未提供', '未知', '无'])

const toTrimmedText = (value: string, fallback: string): string => {
  const text = String(value || '').trim()
  return text || fallback
}

const toJsonText = (value: JsonValue | undefined, fallback = 'none'): string => {
  if (value === undefined) return fallback
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return fallback
  }
}

const toOptionalText = (value: JsonValue | undefined): string | undefined => {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text || undefined
}

const isMissingDocumentField = (value: JsonValue | undefined): boolean => {
  const text = toOptionalText(value)
  if (!text) return true
  return GENERIC_DOCUMENT_NAME_VALUES.has(text.toLowerCase())
}

const enrichResultDataFromSelectedDocument = async (input: {
  ctx: AiRunContext
  resultData: JsonObject | undefined
}): Promise<JsonObject | undefined> => {
  const { resultData, ctx } = input
  if (!resultData) return resultData
  if (!ctx.selectedDocumentIds || ctx.selectedDocumentIds.length !== 1) return resultData

  const currentDocumentName = resultData.document_name
  const currentDocumentId = resultData.document_id
  if (!isMissingDocumentField(currentDocumentName) && !isMissingDocumentField(currentDocumentId)) {
    return resultData
  }

  const selectedDocument = await ctx.documentsStore.getDocumentById(ctx.selectedDocumentIds[0])
  if (!selectedDocument) return resultData

  const nextResultData: JsonObject = { ...resultData }
  if (isMissingDocumentField(currentDocumentName)) {
    nextResultData.document_name = selectedDocument.name || selectedDocument.id
  }
  if (isMissingDocumentField(currentDocumentId)) {
    nextResultData.document_id = selectedDocument.id
  }
  return nextResultData
}

const normalizeDecision = (decision: HumanStepDecision): HumanStepDecision => {
  if (decision.action === 'load_skill') {
    return {
      ...decision,
      skillId: decision.skillId as RuntimeSkillId,
      rationale: toTrimmedText(decision.rationale, '需要加载新的能力。'),
      publicNarrative: toTrimmedText(decision.publicNarrative, '我先加载所需能力，再继续执行任务。')
    }
  }

  if (decision.action === 'invoke_tool') {
    return {
      ...decision,
      toolName: toTrimmedText(decision.toolName, ''),
      args: decision.args || {},
      rationale: toTrimmedText(decision.rationale, '我需要调用当前可用工具来推进任务。'),
      publicNarrative: toTrimmedText(decision.publicNarrative, '我会使用当前工具继续获取证据。')
    }
  }

  if (decision.action === 'complete_task') {
    return {
      ...decision,
      summary: toTrimmedText(decision.summary, '任务已完成。'),
      rationale: toTrimmedText(decision.rationale, '任务目标已经满足。'),
      publicNarrative: toTrimmedText(decision.publicNarrative, '我已经得到足够证据，可以完成任务。')
    }
  }

  return {
    ...decision,
    reason: toTrimmedText(decision.reason, '当前任务无法继续。'),
    rationale: toTrimmedText(decision.rationale, '当前约束下无法继续推进任务。'),
    publicNarrative: toTrimmedText(decision.publicNarrative, '当前缺少继续执行所需条件，因此需要阻塞任务。')
  }
}

const getActiveToolNames = (state: HumanRunState): string[] => {
  return state.activeTools
    .map((tool) => toTrimmedText(String(tool.name || ''), ''))
    .filter(Boolean)
}

const serializeLoadedSkills = (state: HumanRunState): string => {
  const orderedIds: RuntimeSkillId[] = []
  const seen = new Set<string>()

  for (const skillId of state.activeSkillIds) {
    if (seen.has(skillId)) continue
    seen.add(skillId)
    orderedIds.push(skillId)
  }

  for (const [skillId, loadedSkill] of Object.entries(state.loadedSkills)) {
    if (!loadedSkill || seen.has(skillId)) continue
    seen.add(skillId)
    orderedIds.push(skillId as RuntimeSkillId)
  }

  const rows = orderedIds
    .map((skillId) => state.loadedSkills[skillId])
    .filter((item): item is LoadedSkill => item !== undefined)
    .map((skill) => ({
      skillId: skill.skillId,
      active: state.activeSkillIds.includes(skill.skillId),
      toolNames: skill.toolNames,
      referencedAssets: skill.referencedAssets,
      skillContent: skill.skillContent
    }))

  return rows.length > 0 ? toJsonText(rows) : 'none'
}

const serializeActiveTools = (state: HumanRunState): string => {
  const rows = state.activeTools
    .map((tool) => ({
      name: toTrimmedText(String(tool.name || ''), ''),
      description: toTrimmedText(String(tool.description || ''), '(no description)')
    }))
    .filter((tool) => tool.name)
  return rows.length > 0 ? toJsonText(rows) : 'none'
}

const resolveBlockedResultCode = (
  observation: HumanObservation | undefined,
  fallback: AiTaskResultCode
): AiTaskResultCode => {
  if (!observation) return fallback
  if (observation.kind === 'tool_result' || observation.kind === 'terminal') {
    return observation.code === 'ok' ? fallback : observation.code
  }
  return fallback
}

const toResultData = (value: JsonValue | undefined, key: string): JsonObject | undefined => {
  if (value === undefined) return undefined
  if (isJsonObject(value)) return value
  return { [key]: value }
}

const buildDecisionPrompt = (input: { state: HumanRunState; ctx: AiRunContext }) => {
  const { state } = input
  const prompt = buildHumanBrainPrompt({
    objective: state.input.objective,
    stepIndex: state.steps + 1,
    maxSteps: state.maxSteps,
    selectedScopeSummary: input.ctx.selectedScopeSummary,
    availableSkillCardsText: toJsonText(state.availableSkillCards),
    loadedSkillsText: serializeLoadedSkills(state),
    activeToolsText: serializeActiveTools(state),
    lastObservationText: state.lastObservation ? toJsonText(state.lastObservation) : 'none',
    stepHistoryText:
      state.stepHistory.length > 0
        ? toJsonText(state.stepHistory.slice(-MAX_HISTORY_ITEMS))
        : 'none'
  })

  return prompt
}

const invokeStructuredDecision = async (input: {
  ctx: AiRunContext
  prompt: ReturnType<typeof buildDecisionPrompt>
}): Promise<HumanStepDecision> => {
  const cfg = await input.ctx.getModelConfig()
  const model = createChatModel(cfg, { temperature: 0.1 }).withStructuredOutput<HumanStepDecision>(
    humanStepDecisionSchema,
    {
      name: 'human_step_decision',
      method: 'jsonMode'
    }
  )

  return model.invoke([new SystemMessage(input.prompt.system), new HumanMessage(input.prompt.user)])
}

const createBlockState = (input: {
  ctx: AiRunContext
  state: HumanRunState
  stepIndex: number
  summary: string
  publicNarrative: string
  resultCode: AiTaskResultCode
  details?: JsonValue
}) => {
  const activeToolNames = getActiveToolNames(input.state)
  const nextHistory = appendHumanStepRecord({
    history: input.state.stepHistory,
    step: input.stepIndex,
    action: 'block_task',
    publicNarrative: input.publicNarrative,
    activeSkillIds: input.state.activeSkillIds,
    activeToolNames,
    resultStatus: 'blocked',
    summary: input.summary
  })

  emitHumanStep({
    ctx: input.ctx,
    runId: input.state.runId,
    taskId: input.state.input.taskId,
    stepIndex: input.stepIndex,
    action: 'block_task',
    publicNarrative: input.publicNarrative,
    activeSkillIds: input.state.activeSkillIds,
    activeToolNames,
    summary: input.summary,
    resultStatus: 'blocked',
    stage: 'human_brain'
  })

  return {
    phase: 'response' as const,
    status: 'blocked' as const,
    steps: Math.max(input.state.steps, input.stepIndex),
    lastDecision: {
      action: 'block_task' as const,
      reason: input.summary,
      rationale: input.summary,
      publicNarrative: input.publicNarrative,
      details: input.details
    },
    lastObservation: {
      kind: 'terminal' as const,
      status: 'blocked' as const,
      code: input.resultCode,
      summary: input.summary,
      data: input.details
    },
    stepHistory: nextHistory,
    summary: input.summary,
    resultCode: input.resultCode,
    resultData: toResultData(input.details, 'details')
  }
}

const createDiagnosticTrace = (
  decision: HumanStepDecision,
  observation: HumanObservation | undefined
) => {
  const observationSummary = observation ? observation.summary : undefined

  if (decision.action === 'load_skill') {
    return {
      rationale: decision.rationale,
      selectedSkillId: decision.skillId,
      observationSummary
    }
  }

  if (decision.action === 'invoke_tool') {
    return {
      rationale: decision.rationale,
      selectedToolName: decision.toolName,
      args: decision.args,
      observationSummary
    }
  }

  return {
    rationale: decision.rationale,
    observationSummary
  }
}

type AiRunContextWithHumanDecisionOverride = AiRunContext & {
  resolveHumanDecisionOverride?: () => HumanStepDecision | undefined
}

export const createHumanBrainNode = (input: { ctx: AiRunContext }) => {
  const { ctx } = input
  const ctxWithDecisionOverride = ctx as AiRunContextWithHumanDecisionOverride

  return async (state: HumanRunState): Promise<Partial<HumanRunState>> => {
    if (state.status !== 'running') {
      return {}
    }

    ctx.checkCancelled()

    if (state.steps >= state.maxSteps) {
      const summary = `human exceeded max steps (${state.maxSteps})`
      emitHumanDiagnostic({
        ctx,
        runId: state.runId,
        taskId: state.input.taskId,
        stepIndex: state.steps + 1,
        action: 'block_task',
        trace: {
          rationale: summary,
          observationSummary: state.lastObservation?.summary
        },
        stage: 'human_brain'
      })
      return createBlockState({
        ctx,
        state,
        stepIndex: state.steps + 1,
        summary,
        publicNarrative: '当前步数预算已经耗尽，我无法继续安全推进任务。',
        resultCode: 'bounded_loop_error'
      })
    }

    const prompt = buildDecisionPrompt({ state, ctx })
    let decision: HumanStepDecision

    try {
      const overriddenDecision = ctxWithDecisionOverride.resolveHumanDecisionOverride?.()
      decision = normalizeDecision(
        overriddenDecision ||
          (await invokeStructuredDecision({
            ctx,
            prompt
          }))
      )
    } catch (error) {
      const summary = error instanceof Error ? error.message : 'brain decision failed'
      emitHumanDiagnostic({
        ctx,
        runId: state.runId,
        taskId: state.input.taskId,
        stepIndex: state.steps + 1,
        action: 'block_task',
        trace: {
          rationale: summary,
          observationSummary: state.lastObservation?.summary
        },
        stage: 'human_brain'
      })
      return createBlockState({
        ctx,
        state,
        stepIndex: state.steps + 1,
        summary,
        publicNarrative: '当前无法生成有效决策，因此需要阻塞任务。',
        resultCode: 'invalid_input',
        details: { error: summary }
      })
    }
    const nextStep = state.steps + 1

    emitHumanDiagnostic({
      ctx,
      runId: state.runId,
      taskId: state.input.taskId,
      stepIndex: nextStep,
      action: decision.action,
      trace: createDiagnosticTrace(decision, state.lastObservation),
      stage: 'human_brain'
    })

    if (
      decision.action === 'load_skill' &&
      !state.availableSkillCards.some((card) => card.id === decision.skillId)
    ) {
      return createBlockState({
        ctx,
        state,
        stepIndex: nextStep,
        summary: `unknown skill decision: ${decision.skillId}`,
        publicNarrative: '当前选择了不存在的能力包，因此无法继续任务。',
        resultCode: 'invalid_input',
        details: { skillId: decision.skillId }
      })
    }

    if (
      decision.action === 'invoke_tool' &&
      !getActiveToolNames(state).includes(decision.toolName)
    ) {
      return createBlockState({
        ctx,
        state,
        stepIndex: nextStep,
        summary: `inactive tool decision: ${decision.toolName}`,
        publicNarrative: '当前选择了未激活的工具，因此无法继续任务。',
        resultCode: 'invalid_input',
        details: { toolName: decision.toolName, args: decision.args }
      })
    }

    if (decision.action === 'complete_task') {
      const enrichedResultData = enrichCompleteTaskResultData({
        resultData: decision.resultData,
        lastObservation: state.lastObservation
      })
      const resultData = await enrichResultDataFromSelectedDocument({
        ctx,
        resultData: enrichedResultData
      })
      const activeToolNames = getActiveToolNames(state)
      const nextHistory = appendHumanStepRecord({
        history: state.stepHistory,
        step: nextStep,
        action: 'complete_task',
        publicNarrative: decision.publicNarrative,
        activeSkillIds: state.activeSkillIds,
        activeToolNames,
        resultStatus: 'ok',
        summary: decision.summary
      })

      emitHumanStep({
        ctx,
        runId: state.runId,
        taskId: state.input.taskId,
        stepIndex: nextStep,
        action: 'complete_task',
        publicNarrative: decision.publicNarrative,
        activeSkillIds: state.activeSkillIds,
        activeToolNames,
        summary: decision.summary,
        resultStatus: 'ok',
        stage: 'human_brain'
      })

      return {
        phase: 'response',
        status: 'completed',
        steps: nextStep,
        lastDecision: decision,
        lastObservation: {
          kind: 'terminal',
          status: 'completed',
          code: 'ok',
          summary: decision.summary,
          data: resultData
        },
        stepHistory: nextHistory,
        summary: decision.summary,
        resultCode: 'ok',
        resultData
      }
    }

    if (decision.action === 'block_task') {
      const blockedCode = resolveBlockedResultCode(state.lastObservation, 'failed')
      return createBlockState({
        ctx,
        state,
        stepIndex: nextStep,
        summary: decision.reason,
        publicNarrative: decision.publicNarrative,
        resultCode: blockedCode,
        details: decision.details
      })
    }

    return {
      steps: nextStep,
      phase: decision.action === 'load_skill' ? 'skill_loader' : 'tool_exec',
      lastDecision: decision
    }
  }
}
