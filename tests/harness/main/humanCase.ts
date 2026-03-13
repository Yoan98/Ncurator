import { randomUUID } from 'node:crypto'
import type { HumanTaskOutput } from '../../../src/shared/types'
import type { AiRunContext } from '../../../src/main/services/ai/types'
import { createHumanGraphRunner } from '../../../src/main/services/ai/graph/humanGraph'
import { fallbackExecutionOutcome, resolveCaseErrorCode } from './caseErrorCodes'
import type {
  CaseAssertion,
  CaseErrorCode,
  CaseExecutionOutcome,
  CaseExpectedOutcome,
  TestDocumentsStoreOverrides,
  TestToolExecutionOverride
} from './types'
import { EventCollector } from './eventCollector'
import { assertRequiredFixtures } from './fixtureGuard'
import { createTestAiRunContext } from './contextFactory'
import { loadLiveLlmConfigFromEnv } from './llmConfig'
import {
  cleanupWorkspace,
  copyFixturesIntoWorkspace,
  createIsolatedWorkspace,
  type FixtureCopy
} from './workspaceManager'
import { writeCaseReport } from './reporter'
import type { GovernedCaseMetadata } from '../core/caseMetadata'

type HumanRuntime = {
  runId: string
  taskId: string
  workspaceRoot: string
  ctx: AiRunContext
  eventCollector: EventCollector
  assertions: CaseAssertion[]
  maxSteps: number
  approvalPolicy: 'auto-approve' | 'deny-medium-high' | 'deny-all'
}

export const runHumanCase = async (input: {
  caseId: string
  description: string
  objective: string
  requiredFixtures: readonly string[]
  fixtureCopies: FixtureCopy[]
  caseMetadata: GovernedCaseMetadata
  bindWorkspace?: boolean
  selectedDocumentIds?: string[]
  documentsStoreOverrides?: TestDocumentsStoreOverrides
  toolExecutionOverrides?: TestToolExecutionOverride[]
  approvalPolicy?: 'auto-approve' | 'deny-medium-high' | 'deny-all'
  maxSteps?: number
  expectedOutcome?: CaseExpectedOutcome
  scenarioTags?: readonly string[]
  assert: (result: HumanTaskOutput, runtime: HumanRuntime) => Promise<void>
}): Promise<void> => {
  const runId = randomUUID()
  const taskId = `task-${input.caseId}`
  const approvalPolicy = input.approvalPolicy || 'auto-approve'
  const maxSteps = input.maxSteps ?? 8
  const startedAt = Date.now()
  const caseDescription = input.caseMetadata?.description || input.description
  const taskGoal = input.caseMetadata?.taskGoal || input.objective
  const requiredFixtures = input.caseMetadata?.requiredFixtures || input.requiredFixtures
  const notes: string[] = [caseDescription]
  const assertions: CaseAssertion[] = []
  const eventCollector = new EventCollector()
  let workspaceRoot = ''
  let modelName: string | undefined
  let caseStatus: 'passed' | 'failed' = 'passed'
  let caseErrorCode: CaseErrorCode = 'none'
  let execution: CaseExecutionOutcome = {
    status: 'unknown',
    resultCode: 'unknown'
  }

  try {
    await assertRequiredFixtures(requiredFixtures)
    const liveConfig = loadLiveLlmConfigFromEnv()
    modelName = liveConfig.model_name
    workspaceRoot = await createIsolatedWorkspace(input.caseId)
    await copyFixturesIntoWorkspace(workspaceRoot, input.fixtureCopies)

    const ctx = createTestAiRunContext({
      runId,
      workspaceRootPath: workspaceRoot,
      eventCollector,
      bindWorkspace: input.bindWorkspace,
      selectedDocumentIds: input.selectedDocumentIds,
      approvalPolicy,
      liveModelConfig: liveConfig,
      documentsStoreOverrides: input.documentsStoreOverrides,
      toolExecutionOverrides: input.toolExecutionOverrides
    })
    const runtime: HumanRuntime = {
      runId,
      taskId,
      workspaceRoot,
      ctx,
      eventCollector,
      assertions,
      maxSteps,
      approvalPolicy
    }

    const runHumanTask = createHumanGraphRunner({
      ctx,
      maxSteps
    })
    const result = await runHumanTask({
      taskId,
      objective: taskGoal
    }, {
      deliveryKind: 'handoff'
    })

    execution = {
      status: result.status === 'completed' ? 'completed' : 'blocked',
      resultCode: result.resultCode,
      summary: result.summary,
      resultData: result.resultData
    }

    await input.assert(result, runtime)
  } catch (error) {
    caseStatus = 'failed'
    const message = error instanceof Error ? error.message : String(error)
    caseErrorCode = resolveCaseErrorCode(message)
    execution = fallbackExecutionOutcome({
      current: execution,
      caseErrorCode,
      hadEvents: eventCollector.snapshot().length > 0
    })
    notes.push(message)
    throw error
  } finally {
    const finishedAt = Date.now()
    await writeCaseReport({
      suite: 'main-ai-human',
      caseId: input.caseId,
      runId,
      taskId,
      startedAt,
      finishedAt,
      caseStatus,
      caseErrorCode,
      execution,
      signalOverrides: {
        expectedOutcome: input.caseMetadata?.expectedOutcome || input.expectedOutcome,
        scenarioTags: input.caseMetadata?.scenarioTags || input.scenarioTags,
        taskGoal,
        maxSteps,
        approvalPolicy,
        modelName,
        description: caseDescription,
        requiredFixtures,
        retentionTier: input.caseMetadata?.retentionTier,
        lifecycle: input.caseMetadata?.lifecycle,
        runPolicy: input.caseMetadata?.runPolicy,
        capabilityArea: input.caseMetadata?.capabilityArea,
        sourceFile: input.caseMetadata?.sourceFile,
        profiles: input.caseMetadata?.profiles || []
      },
      assertions,
      events: eventCollector.snapshot(),
      notes
    })
    if (workspaceRoot) {
      await cleanupWorkspace(workspaceRoot)
    }
  }
}
