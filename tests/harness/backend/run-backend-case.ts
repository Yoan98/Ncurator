import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { createTestAiRunContext } from './contextFactory'
import { assertRequiredFixtures } from './fixtureGuard'
import type {
  BackendTestRuntime,
  FixtureBinding,
  TestCaseDefinition,
  TestLogEvent,
  TestRunMeta,
  TestRunStatus
} from './test-types'
import { writeRunLog, createRunId } from './write-run-log'
import { cleanupWorkspace, copyFixturesIntoWorkspace, createIsolatedWorkspace } from './workspaceManager'
import { EventCollector } from '../core/eventCollector'

const resolveGitSha = (): string => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8'
    }).trim()
  } catch {
    return 'unknown'
  }
}

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

export const runBackendCase = async <TResult>(definition: TestCaseDefinition<TResult>): Promise<void> => {
  const startedAtMs = Date.now()
  const runId = createRunId(startedAtMs)
  const taskId = `${definition.suite}-${definition.caseId}`
  const eventCollector = new EventCollector()
  const events: TestLogEvent[] = []
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
    kind: 'run_start',
    status: 'info',
    message: `开始执行 ${definition.domain}/${definition.layer}/${definition.suite}/${definition.caseId}`
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
      assertThat: (condition, message, detail) => {
        recordEvent({
          kind: 'assertion',
          status: condition ? 'ok' : 'failed',
          message,
          detail
        })
        if (!condition) {
          throw new Error(message)
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
      kind: 'error',
      status: 'failed',
      message: `测试失败：${message}`
    })
    throw error
  } finally {
    recordEvent({
      kind: 'run_end',
      status: status === 'passed' ? 'ok' : 'failed',
      message: status === 'passed' ? '本次测试执行完成' : '本次测试执行失败'
    })

    const meta: TestRunMeta = {
      runId,
      caseId: definition.caseId,
      domain: definition.domain,
      layer: definition.layer,
      suite: definition.suite,
      capability: definition.capability || null,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date().toISOString(),
      status,
      gitSha: resolveGitSha(),
      modelName: null,
      fixtures: definition.fixtures.map((fixturePath) => path.resolve(fixturePath))
    }

    await writeRunLog({
      meta,
      events
    })

    if (workspaceRoot) {
      await cleanupWorkspace(workspaceRoot)
    }
  }
}
