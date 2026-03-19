import type {
  AiRunEvent,
  HumanActionSpec,
  HumanReasoningOutput,
  JsonObject,
  RuntimeSkillId
} from '../../../../src/shared/types'
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

type ReasonOutputInput = {
  summary: string
  focusCurrent?: string | null
}

const createReasonEnvelope = (input: ReasonOutputInput): Pick<
  HumanReasoningOutput,
  'memoryPatch' | 'analysis'
> => ({
  memoryPatch:
    input.focusCurrent === undefined
      ? {}
      : {
          focus: {
            current: input.focusCurrent
          }
        },
  analysis: {
    summary: input.summary
  }
})

export const reasonActivateCapability = (input: {
  skillId: RuntimeSkillId
  rationale: string
  publicNarrative: string
  focusCurrent?: string | null
}): HumanReasoningOutput => ({
  ...createReasonEnvelope({
    summary: input.rationale,
    focusCurrent: input.focusCurrent === undefined ? input.skillId : input.focusCurrent
  }),
  actionBatch: {
    summary: input.rationale,
    actions: [
      {
        type: 'activate_capability',
        skillId: input.skillId,
        rationale: input.rationale,
        publicNarrative: input.publicNarrative
      }
    ]
  }
})

export const reasonInvokeTool = (input: {
  toolName: string
  args: JsonObject
  rationale: string
  publicNarrative: string
  focusCurrent?: string | null
}): HumanReasoningOutput => ({
  ...createReasonEnvelope({
    summary: input.rationale,
    focusCurrent: input.focusCurrent === undefined ? input.toolName : input.focusCurrent
  }),
  actionBatch: {
    summary: input.rationale,
    actions: [
      {
        type: 'invoke_tool',
        toolName: input.toolName,
        args: input.args,
        rationale: input.rationale,
        publicNarrative: input.publicNarrative
      }
    ]
  }
})

export const reasonActionBatch = (input: {
  summary: string
  focusCurrent?: string | null
  actions: HumanActionSpec[]
}): HumanReasoningOutput => ({
  ...createReasonEnvelope({
    summary: input.summary,
    focusCurrent: input.focusCurrent
  }),
  actionBatch: {
    summary: input.summary,
    actions: input.actions
  }
})

export const reasonComplete = (input: {
  summary: string
  rationale: string
  payload?: JsonObject
}): HumanReasoningOutput => ({
  memoryPatch: {},
  analysis: {
    summary: input.rationale
  },
  outcome: {
    status: 'completed',
    summary: input.summary,
    payload: input.payload
  }
})

export const reasonBlocked = (input: {
  summary: string
  rationale: string
  payload?: JsonObject
}): HumanReasoningOutput => ({
  memoryPatch: {},
  analysis: {
    summary: input.rationale
  },
  outcome: {
    status: 'blocked',
    summary: input.summary,
    payload: input.payload
  }
})
