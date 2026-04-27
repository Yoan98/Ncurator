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
import { createStreamingRunLogWriter, createRunId } from './write-run-log'
import { cleanupWorkspace, copyFixturesIntoWorkspace, createIsolatedWorkspace } from './workspaceManager'
import { EventCollector } from '../core/eventCollector'
import {
  TEST_LOG_SCHEMA_VERSION,
  type TestDomain,
  type TestLogEvent,
  type TestRunMeta,
  type TestRunStatus
} from '../core/run-log-contract'

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
  counts: {
    steps: number
    assertions: number
    errors: number
  },
  artifactCount: number
): TestRunMeta['stats'] => ({
  durationMs: finishedAtMs - startedAtMs,
  steps: counts.steps,
  assertions: counts.assertions,
  errors: counts.errors,
  artifacts: artifactCount
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
  const streamingLogWriter = createStreamingRunLogWriter({
    scope,
    caseId: definition.caseId,
    runId
  })
  const eventCollector = new EventCollector({
    sink: {
      onRuntimeEvent: (event) => {
        streamingLogWriter.appendRuntimeEvent(event)
      },
      onLlmIo: (record) => {
        streamingLogWriter.appendLlmIoRecord(record)
      }
    },
    retainLlmIoRecords: false,
    llmIoPath: streamingLogWriter.paths.llmIoPath
  })
  let workspaceRoot = ''
  let fixtureBindings: FixtureBinding[] = []
  let status: TestRunStatus = 'failed'
  let runtime: BackendTestRuntime | undefined
  const counters = {
    steps: 0,
    assertions: 0,
    errors: 0
  }

  const recordEvent = (input: Omit<TestLogEvent, 'ts'>): void => {
    const event = {
      ts: new Date().toISOString(),
      ...input
    }
    if (event.type === 'step') counters.steps += 1
    if (event.type === 'assertion') counters.assertions += 1
    if (event.type === 'error') counters.errors += 1
    streamingLogWriter.appendTimelineEvent(event)
  }

  streamingLogWriter.init({
    meta: {
      schemaVersion: TEST_LOG_SCHEMA_VERSION,
      runId,
      caseId: definition.caseId,
      scope,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: '',
      status: 'running',
      stats: {
        durationMs: 0,
        steps: 0,
        assertions: 0,
        errors: 0,
        artifacts: 0
      },
      runtime: {
        driver: 'backend',
        target: 'node',
        modelName: definition.runtimeModelName || null
      }
    }
  })

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
      await streamingLogWriter.flush()
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
    await streamingLogWriter.flush()
    const runArtifacts = workspaceRoot
      ? await collectBackendRunArtifacts({
          scope,
          caseId: definition.caseId,
          runId,
          workspaceRoot,
          runtimeEventsPath: streamingLogWriter.paths.runtimeEventsPath
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
      stats: buildStats(startedAtMs, finishedAt.getTime(), counters, artifacts.length),
      runtime: {
        driver: 'backend',
        target: 'node',
        modelName: definition.runtimeModelName || null
      }
    }

    await streamingLogWriter.finalize({
      meta,
      artifacts,
      seedManifest: seedArtifacts.persistedManifest
    })

    if (workspaceRoot) {
      await cleanupWorkspace(workspaceRoot)
    }
  }
}
