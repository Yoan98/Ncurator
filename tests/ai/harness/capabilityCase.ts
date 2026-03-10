import { randomUUID } from 'node:crypto'
import type { AiRunContext } from '../../../src/main/services/ai/types'
import { fallbackExecutionOutcome, resolveCaseErrorCode } from './caseErrorCodes'
import type {
  CaseAssertion,
  CaseErrorCode,
  CaseExecutionOutcome,
  CaseExpectedOutcome,
  CaseSuite
} from './types'
import { EventCollector } from './eventCollector'
import { assertRequiredFixtures } from './fixtureGuard'
import { createTestAiRunContext } from './contextFactory'
import {
  cleanupWorkspace,
  copyFixturesIntoWorkspace,
  createIsolatedWorkspace,
  type FixtureCopy
} from './workspaceManager'
import { writeCaseReport } from './reporter'

type CapabilityCaseRuntime = {
  runId: string
  taskId: string
  workspaceRoot: string
  ctx: AiRunContext
  eventCollector: EventCollector
  assertions: CaseAssertion[]
}

type StructuredCaseInput<TResult> = {
  caseId: string
  description: string
  requiredFixtures: string[]
  fixtureCopies: FixtureCopy[]
  approvalPolicy?: 'auto-approve' | 'deny-medium-high' | 'deny-all'
  expectedOutcome?: CaseExpectedOutcome
  scenarioTags?: string[]
  buildExecutionOutcome?: (
    result: TResult,
    runtime: CapabilityCaseRuntime
  ) => CaseExecutionOutcome
  execute: (runtime: CapabilityCaseRuntime) => Promise<TResult>
  assert: (result: TResult, runtime: CapabilityCaseRuntime) => Promise<void>
}

const runStructuredCase = async <TResult>(
  suite: CaseSuite,
  input: StructuredCaseInput<TResult>
): Promise<void> => {
  const runId = randomUUID()
  const taskId = `task-${input.caseId}`
  const startedAt = Date.now()
  const notes: string[] = [input.description]
  const assertions: CaseAssertion[] = []
  const eventCollector = new EventCollector()
  let workspaceRoot = ''
  let caseStatus: 'passed' | 'failed' = 'passed'
  let caseErrorCode: CaseErrorCode = 'none'
  let execution: CaseExecutionOutcome = {
    status: 'unknown',
    resultCode: 'unknown'
  }
  let reportDir = ''

  try {
    await assertRequiredFixtures(input.requiredFixtures)
    workspaceRoot = await createIsolatedWorkspace(input.caseId)
    await copyFixturesIntoWorkspace(workspaceRoot, input.fixtureCopies)
    const ctx = createTestAiRunContext({
      runId,
      workspaceRootPath: workspaceRoot,
      eventCollector,
      approvalPolicy: input.approvalPolicy || 'auto-approve'
    })
    const runtime: CapabilityCaseRuntime = {
      runId,
      taskId,
      workspaceRoot,
      ctx,
      eventCollector,
      assertions
    }

    const result = await input.execute(runtime)
    execution = input.buildExecutionOutcome
      ? input.buildExecutionOutcome(result, runtime)
      : execution
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
    reportDir = await writeCaseReport({
      suite,
      caseId: input.caseId,
      runId,
      taskId,
      startedAt,
      finishedAt,
      caseStatus,
      caseErrorCode,
      execution,
      signalOverrides: {
        expectedOutcome: input.expectedOutcome,
        scenarioTags: input.scenarioTags
      },
      assertions,
      events: eventCollector.snapshot(),
      notes
    })
    notes.push(`report: ${reportDir}`)
    if (workspaceRoot) {
      await cleanupWorkspace(workspaceRoot)
    }
  }
}

export const runCapabilityCase = async <TResult>(
  input: StructuredCaseInput<TResult>
): Promise<void> => runStructuredCase('capability', input)

export const runIntegrationCase = async <TResult>(
  input: StructuredCaseInput<TResult>
): Promise<void> => runStructuredCase('integration', input)
