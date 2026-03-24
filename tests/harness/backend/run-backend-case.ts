import path from 'node:path'
import { createTestAiRunContext } from './contextFactory'
import { assertRequiredFixtures } from './fixtureGuard'
import type {
  BackendTestRuntime,
  FixtureBinding,
  TestCaseDefinition
} from './test-types'
import { writeRunLog, createRunId } from './write-run-log'
import { cleanupWorkspace, copyFixturesIntoWorkspace, createIsolatedWorkspace } from './workspaceManager'
import { EventCollector } from '../core/eventCollector'
import {
  TEST_LOG_SCHEMA_VERSION,
  type TestArtifact,
  type TestDomain,
  type TestLayer,
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
  layer: TestLayer
  suite: string
  groups: readonly string[]
}): string => {
  const parts = [input.domain, input.layer, input.suite]
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
    layer: definition.layer,
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
  const artifacts: TestArtifact[] = []
  let workspaceRoot = ''
  let fixtureBindings: FixtureBinding[] = []
  let status: TestRunStatus = 'failed'

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

    const runtime: BackendTestRuntime = {
      runId,
      taskId,
      workspaceRoot,
      fixtureBindings,
      eventCollector,
      recordEvent,
      assertThat: (condition, input) => {
        recordEvent({
          type: 'assertion',
          name: input.name,
          status: condition ? 'ok' : 'failed',
          message: input.message,
          data: input.data
        })
        if (!condition) {
          throw new Error(input.message)
        }
      },
      getFixtureWorkspacePath: (sourcePath: string) => {
        const absoluteSource = path.resolve(sourcePath)
        const matched = fixtureBindings.find((binding) => binding.sourcePath === absoluteSource)
        if (!matched) {
          throw new Error(`fixture not bound into workspace: ${absoluteSource}`)
        }
        return matched.workspacePath
      },
      createAiRunContext: (input = {}) =>
        createTestAiRunContext({
          runId,
          workspaceRootPath: workspaceRoot,
          eventCollector,
          ...input
        })
    }

    const result = await definition.execute(runtime)
    await definition.assert(result, runtime)
    status = 'passed'
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
      artifacts
    })

    if (workspaceRoot) {
      await cleanupWorkspace(workspaceRoot)
    }
  }
}
