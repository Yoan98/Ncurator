import path from 'node:path'
import { collectBackendRunArtifacts } from './artifactCollector'
import { assertRequiredFixtures } from './fixtureGuard'
import type {
  BackendSeedManifest,
  BackendTestRuntime,
  FixtureBinding,
  TestCaseDefinition
} from './test-types'
import { createRealAiHarness } from './realAiHarness'
import { collectBackendSeedArtifacts } from './seedManifest'
import { writeRunLog, createRunId } from './write-run-log'
import { cleanupWorkspace, copyFixturesIntoWorkspace, createIsolatedWorkspace } from './workspaceManager'
import { EventCollector } from '../core/eventCollector'
import {
  TEST_LOG_SCHEMA_VERSION,
  type TestArtifact,
  type TestDomain,
  type TestLogEvent,
  type TestRunMeta,
  type TestRunStatus
} from '../core/report-contract'

const fixturesRoot = path.resolve(process.cwd(), 'tests', 'fixtures')

const buildFixtureBindings = (fixturePaths: readonly string[], workspaceRoot: string): FixtureBinding[] => {
  return fixturePaths.map((fixturePath) => {
    const absoluteSource = path.resolve(fixturePath)
    const relativeToFixtures = path.relative(fixturesRoot, absoluteSource)
    const workspacePath = relativeToFixtures.startsWith('..')
      ? path.join(workspaceRoot, path.basename(absoluteSource))
      : path.join(workspaceRoot, relativeToFixtures)

    return {
      sourcePath: absoluteSource,
      workspacePath
    }
  })
}

const toRelativeWorkspaceTarget = (workspaceRoot: string, absoluteWorkspacePath: string): string =>
  path.relative(workspaceRoot, absoluteWorkspacePath)

const buildRunScope = (input: {
  domain: TestDomain
  suite: string
  groups: readonly string[]
}): string => {
  const parts = [input.domain, input.suite]
  parts.push(...input.groups)
  return parts.join('/')
}

const buildTaskId = (input: {
  suite: string
  groups: readonly string[]
  caseId: string
}): string => [input.suite, ...input.groups, input.caseId].join('-')

const buildStats = (
  startedAtMs: number,
  finishedAtMs: number,
  events: readonly TestLogEvent[],
  artifacts: readonly TestArtifact[]
): TestRunMeta['stats'] => ({
  durationMs: finishedAtMs - startedAtMs,
  steps: events.filter((event) => event.type === 'step').length,
  assertions: events.filter((event) => event.type === 'assertion').length,
  errors: events.filter((event) => event.type === 'error').length,
  artifacts: artifacts.length
})

export const runBackendCase = async <TResult>(definition: TestCaseDefinition<TResult>): Promise<void> => {
  const startedAtMs = Date.now()
  const runId = createRunId(startedAtMs)
  const scope = buildRunScope({
    domain: definition.domain,
    suite: definition.suite,
    groups: definition.groups || []
  })
  const taskId = buildTaskId({
    suite: definition.suite,
    groups: definition.groups || [],
    caseId: definition.caseId
  })
  const eventCollector = new EventCollector()
  const events: TestLogEvent[] = []
  let workspaceRoot = ''
  let fixtureBindings: FixtureBinding[] = []
  let status: TestRunStatus = 'failed'
  let runtime: BackendTestRuntime | undefined

  const recordEvent = (input: Omit<TestLogEvent, 'ts'>): void => {
    events.push({
      ts: new Date().toISOString(),
      ...input
    })
  }

  recordEvent({
    type: 'run',
    name: 'start',
    status: 'info',
    message: `开始执行 ${scope}/${definition.caseId}`,
    data: {
      description: definition.description,
      fixtures: definition.fixtures.map((fixturePath) => path.resolve(fixturePath)),
      runMode: definition.runMode
    }
  })

  try {
    await assertRequiredFixtures(definition.fixtures)
    workspaceRoot = await createIsolatedWorkspace(definition.caseId)
    fixtureBindings = buildFixtureBindings(definition.fixtures, workspaceRoot)
    await copyFixturesIntoWorkspace(
      workspaceRoot,
      fixtureBindings.map((binding) => ({
        from: binding.sourcePath,
        to: toRelativeWorkspaceTarget(workspaceRoot, binding.workspacePath)
        }))
    )

    const harness = await createRealAiHarness({
      definition,
      runId,
      taskId,
      workspaceRoot,
      fixtureBindings,
      eventCollector,
      recordEvent
    })
    runtime = harness.runtime

    try {
      const result = await definition.execute(runtime)
      await definition.assert(result, runtime)
      status = 'passed'
    } finally {
      await harness.dispose()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    recordEvent({
      type: 'error',
      name: 'execution-failed',
      status: 'failed',
      message: `测试失败：${message}`
    })
    throw error
  } finally {
    const runtimeEvents = eventCollector.snapshot()
    const runArtifacts = workspaceRoot
      ? await collectBackendRunArtifacts({
          scope,
          caseId: definition.caseId,
          runId,
          workspaceRoot,
          runtimeEvents
        })
      : []
    const emptySeedManifest: BackendSeedManifest = {
      schemaVersion: 1,
      workspaceFiles: [],
      kbDocuments: []
    }
    const seedArtifacts = runtime
      ? await collectBackendSeedArtifacts({
          scope,
          caseId: definition.caseId,
          runId,
          manifest: runtime.getSeedManifest()
        })
      : {
          artifacts: [],
          persistedManifest: emptySeedManifest
        }
    const artifacts = [...runArtifacts, ...seedArtifacts.artifacts]
    recordEvent({
      type: 'run',
      name: 'end',
      status: status === 'passed' ? 'ok' : 'failed',
      message: status === 'passed' ? '本次测试执行完成' : '本次测试执行失败'
    })

    const finishedAt = new Date()
    const meta: TestRunMeta = {
      schemaVersion: TEST_LOG_SCHEMA_VERSION,
      runId,
      caseId: definition.caseId,
      scope,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: finishedAt.toISOString(),
      status,
      stats: buildStats(startedAtMs, finishedAt.getTime(), events, artifacts),
      runtime: {
        driver: 'backend',
        target: 'node',
        modelName: definition.runtimeModelName || null
      }
    }

    await writeRunLog({
      meta,
      events,
      runtimeEvents,
      llmIoRecords: eventCollector.snapshotLlmIo(),
      artifacts,
      seedManifest: seedArtifacts.persistedManifest
    })

    if (workspaceRoot) {
      await cleanupWorkspace(workspaceRoot)
    }
  }
}
