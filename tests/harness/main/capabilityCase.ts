import { randomUUID } from 'node:crypto'
import type { AiRunContext } from '../../../src/main/services/ai/types'
import { fallbackExecutionOutcome, resolveCaseErrorCode } from './caseErrorCodes'
import type {
  CaseAssertion,
  CaseErrorCode,
  CaseExecutionOutcome,
  CaseExpectedOutcome,
  CaseSignalOverrides,
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
import type { GovernedCaseMetadata } from '../core/caseMetadata'

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
  requiredFixtures: readonly string[]
  fixtureCopies: FixtureCopy[]
  caseMetadata: GovernedCaseMetadata
  approvalPolicy?: 'auto-approve' | 'deny-medium-high' | 'deny-all'
  expectedOutcome?: CaseExpectedOutcome
  scenarioTags?: readonly string[]
  buildExecutionOutcome?: (
    result: TResult,
    runtime: CapabilityCaseRuntime
  ) => CaseExecutionOutcome
  buildSignalOverrides?: (
    result: TResult,
    runtime: CapabilityCaseRuntime
  ) => Partial<CaseSignalOverrides>
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
  const caseDescription = input.caseMetadata?.description || input.description
  const requiredFixtures = input.caseMetadata?.requiredFixtures || input.requiredFixtures
  const notes: string[] = [caseDescription]
  const assertions: CaseAssertion[] = []
  const eventCollector = new EventCollector()
  let workspaceRoot = ''
  let caseStatus: 'passed' | 'failed' = 'passed'
  let caseErrorCode: CaseErrorCode = 'none'
  let execution: CaseExecutionOutcome = {
    status: 'unknown',
    resultCode: 'unknown'
  }
  let signalOverrides: Partial<CaseSignalOverrides> | undefined
  let reportDir = ''

  try {
    await assertRequiredFixtures(requiredFixtures)
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
    signalOverrides = input.buildSignalOverrides
      ? input.buildSignalOverrides(result, runtime)
      : undefined
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
        expectedOutcome: input.caseMetadata?.expectedOutcome || input.expectedOutcome,
        scenarioTags: input.caseMetadata?.scenarioTags || input.scenarioTags,
        description: caseDescription,
        requiredFixtures,
        retentionTier: input.caseMetadata?.retentionTier,
        lifecycle: input.caseMetadata?.lifecycle,
        runPolicy: input.caseMetadata?.runPolicy,
        capabilityArea: input.caseMetadata?.capabilityArea,
        sourceFile: input.caseMetadata?.sourceFile,
        profiles: input.caseMetadata?.profiles || [],
        ...signalOverrides
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
): Promise<void> => runStructuredCase('main-ai-capability', input)

export const runRuntimeCase = async <TResult>(
  input: StructuredCaseInput<TResult>
): Promise<void> => runStructuredCase('main-ai-runtime', input)

export const runIntegrationCase = runRuntimeCase

export const runWorkspaceServiceCase = async <TResult>(
  input: StructuredCaseInput<TResult>
): Promise<void> => runStructuredCase('main-workspace-service', input)

export const runWorkspaceMigrationCase = async <TResult>(
  input: StructuredCaseInput<TResult>
): Promise<void> => runStructuredCase('main-workspace-migration', input)
