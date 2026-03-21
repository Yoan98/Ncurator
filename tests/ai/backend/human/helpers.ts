import type { AiRunEvent, JsonObject } from '../../../../src/shared/types'
import { it } from 'vitest'
import type {
  LastBrainDecision,
  RuntimeSkillId
} from '../../../../src/main/services/ai/human/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { hasLiveLlmConfigInEnv, loadLiveLlmConfigFromEnv } from '../../../harness/backend/llmConfig'
import type { BackendTestRuntime, TestCaseDefinition } from '../../../harness/backend/test-types'

type AiHumanCaseDefinition<TResult> = Omit<TestCaseDefinition<TResult>, 'domain' | 'layer' | 'suite'>
const HUMAN_LIVE_TEST_TIMEOUT_MS = 300_000

export const defineAiHumanCase = <TResult>(definition: AiHumanCaseDefinition<TResult>): void => {
  it(definition.caseId, async () => {
    await runBackendCase({
      ...definition,
      domain: 'ai',
      layer: 'backend',
      suite: 'human'
    })
  })
}

export const defineAiHumanLiveCase = <TResult>(definition: AiHumanCaseDefinition<TResult>): void => {
  const liveEnabled = hasLiveLlmConfigInEnv('primary')
  if (!liveEnabled) {
    it.skip(definition.caseId, () => undefined)
    return
  }

  const runtimeModelName = loadLiveLlmConfigFromEnv('primary').model_name

  it(
    definition.caseId,
    async () => {
      await runBackendCase({
        ...definition,
        domain: 'ai',
        layer: 'backend',
        suite: 'human',
        runtimeModelName
      })
    },
    HUMAN_LIVE_TEST_TIMEOUT_MS
  )
}

export const loadPrimaryLiveHumanConfig = () => loadLiveLlmConfigFromEnv('primary')

export const getCollectedEvents = (runtime: BackendTestRuntime): AiRunEvent[] =>
  runtime.eventCollector.snapshot()

export const getEventsByType = <TType extends AiRunEvent['type']>(
  runtime: BackendTestRuntime,
  type: TType
): Array<Extract<AiRunEvent, { type: TType }>> => {
  return getCollectedEvents(runtime).filter((event) => event.type === type) as Array<
    Extract<AiRunEvent, { type: TType }>
  >
}

export const reasonActivateCapability = (input: {
  skillId?: RuntimeSkillId
  skillIds?: Array<RuntimeSkillId>
  rationale: string
  publicNarrative: string
}): LastBrainDecision => ({
  memoryOps: [],
  decision: {
    summary: input.publicNarrative,
    reason: input.rationale,
    expectedOutcome: '学习所需 skill 后继续推进任务。'
  },
  nextAction: {
    action: 'learning',
    wantLearnSkillIds: [
      ...new Set(
        input.skillIds || (input.skillId ? [input.skillId] : [])
      )
    ]
  }
})

export const reasonInvokeTool = (input: {
  toolName: string
  args: JsonObject
  rationale: string
  publicNarrative: string
}): LastBrainDecision => ({
  memoryOps: [],
  decision: {
    summary: input.publicNarrative,
    reason: input.rationale,
    expectedOutcome: '拿到工具结果后继续判断。'
  },
  nextAction: {
    action: 'hand',
    parallelCallToolParam: [
      {
        toolName: input.toolName,
        args: input.args
      }
    ]
  }
})

export const reasonActionBatch = (input: {
  summary: string
  actions: Array<{
    type: 'invoke_tool'
    toolName: string
    args: JsonObject
  }>
}): LastBrainDecision => ({
  memoryOps: [],
  decision: {
    summary: input.summary,
    reason: input.summary,
    expectedOutcome: '执行一批工具调用后继续判断。'
  },
  nextAction: {
    action: 'hand',
    parallelCallToolParam: input.actions.map((action) => ({
      toolName: action.toolName,
      args: action.args
    }))
  }
})

export const reasonComplete = (input: {
  summary: string
  rationale: string
}): LastBrainDecision => ({
  memoryOps: [],
  decision: {
    summary: input.summary,
    reason: input.rationale,
    expectedOutcome: '进入最终输出。'
  },
  nextAction: {
    action: 'mouth',
    status: 'completed'
  }
})

export const reasonBlocked = (input: {
  summary: string
  rationale: string
}): LastBrainDecision => ({
  memoryOps: [],
  decision: {
    summary: input.summary,
    reason: input.rationale,
    expectedOutcome: '输出阻塞结果。'
  },
  nextAction: {
    action: 'mouth',
    status: 'blocked'
  }
})
