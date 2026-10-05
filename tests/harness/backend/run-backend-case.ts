import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { readdir } from 'node:fs/promises'
import { collectBackendRunArtifacts } from './artifactCollector'
import { collectMessageLogAnnotationArtifact } from './messageLogAnnotations'
import { assertRequiredFixtures } from './fixtureGuard'
import type {
  BackendSeedManifest,
  BackendTestRuntime,
  FixtureBinding,
  TestCaseDefinition
} from './test-types'
import { createRealAiHarness } from './realAiHarness'
import { loadLiveLlmConfigFromEnv } from './llmConfig'
import { collectBackendSeedArtifacts } from './seedManifest'
import { createStreamingRunLogWriter, createRunId } from './write-run-log'
import {
  cleanupWorkspace,
  copyFixturesIntoWorkspace,
  createIsolatedWorkspace
} from './workspaceManager'
import { EventCollector } from '../core/eventCollector'
import type { AiFileChangeRecord } from '../../../src/shared/types'
import {
  TEST_LOG_SCHEMA_VERSION,
  type TestDomain,
  type TestLogEvent,
  type TestRunMeta,
  type TestRunStatus
} from '../core/run-log-contract'

const fixturesRoot = path.resolve(process.cwd(), 'tests', 'fixtures')
const sharedWorkspaceFixtureRoot = path.join(fixturesRoot, 'workspace')

const isWithinDirectory = (targetPath: string, directoryPath: string): boolean => {
  const relativePath = path.relative(directoryPath, targetPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

const expandFixtureFilePaths = async (fixturePath: string): Promise<string[]> => {
  const absoluteSource = path.resolve(fixturePath)
  const entries = await readdir(absoluteSource, { withFileTypes: true })
  const nestedFileGroups = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const nestedPath = path.join(absoluteSource, entry.name)
        if (entry.isDirectory()) {
          return await expandFixtureFilePaths(nestedPath)
        }
        return [nestedPath]
      })
  )
  return nestedFileGroups.flat()
}

const resolveFixtureWorkspacePath = (absoluteSource: string, workspaceRoot: string): string => {
  if (isWithinDirectory(absoluteSource, sharedWorkspaceFixtureRoot)) {
    return path.join(workspaceRoot, path.relative(sharedWorkspaceFixtureRoot, absoluteSource))
  }

  const relativeToFixtures = path.relative(fixturesRoot, absoluteSource)
  return relativeToFixtures.startsWith('..')
    ? path.join(workspaceRoot, path.basename(absoluteSource))
    : path.join(workspaceRoot, relativeToFixtures)
}

const buildFixtureBindings = async (
  fixturePaths: readonly string[],
  workspaceRoot: string
): Promise<FixtureBinding[]> => {
  const expandedSourceGroups = await Promise.all(
    fixturePaths.map(async (fixturePath) => {
      const absoluteSource = path.resolve(fixturePath)
      const sourceEntries = await readdir(absoluteSource, { withFileTypes: true }).catch(() => null)
      if (!sourceEntries) {
        return [absoluteSource]
      }
      return await expandFixtureFilePaths(absoluteSource)
    })
  )

  return expandedSourceGroups.flat().map((absoluteSource) => ({
    sourcePath: absoluteSource,
    workspacePath: resolveFixtureWorkspacePath(absoluteSource, workspaceRoot)
  }))
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

const buildTaskId = (input: { suite: string; groups: readonly string[]; caseId: string }): string =>
  [input.suite, ...input.groups, input.caseId].join('-')

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

export const runBackendCase = async <TResult>(
  definition: TestCaseDefinition<TResult>
): Promise<void> => {
  const liveConfig = definition.harnessMode === 'live' ? loadLiveLlmConfigFromEnv() : null
  const runtimeModelName = liveConfig?.model_name || definition.runtimeModelName || null
  const startedAtMs = Date.now()
  const runId = `${createRunId(startedAtMs)}-${randomUUID().slice(0, 8)}`
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
  let fileChangeRecords: AiFileChangeRecord[] = []
  let annotationArtifacts: Awaited<ReturnType<typeof collectMessageLogAnnotationArtifact>> = []
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
        modelName: runtimeModelName
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
    fixtureBindings = await buildFixtureBindings(definition.fixtures, workspaceRoot)
    await copyFixturesIntoWorkspace(
      workspaceRoot,
      fixtureBindings.map((binding) => ({
        from: binding.sourcePath,
        to: toRelativeWorkspaceTarget(workspaceRoot, binding.workspacePath)
      }))
    )

    const harness = await createRealAiHarness({
      definition: {
        ...definition,
        runtimeModelName
      },
      runId,
      taskId,
      workspaceRoot,
      fixtureBindings,
      eventCollector,
      recordEvent
    })
    runtime = harness.runtime
    if (liveConfig) await runtime.seedLlmConfig(liveConfig)

    try {
      const result = await definition.execute(runtime)
      await streamingLogWriter.flush()
      await definition.assert(result, runtime)
      status = 'passed'
    } finally {
      try {
        fileChangeRecords = (await runtime.storageService.aiFileChange.listRecords()).items
        if (definition.messageLogAnnotationPartnerIds) {
          annotationArtifacts = await collectMessageLogAnnotationArtifact({
            scope,
            caseId: definition.caseId,
            runId,
            storageService: runtime.storageService,
            partnerIds: definition.messageLogAnnotationPartnerIds(runtime)
          })
        }
      } finally {
        await harness.dispose()
      }
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
          runtimeEventsPath: streamingLogWriter.paths.runtimeEventsPath,
          fileChangeRecords
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
    const artifacts = [...runArtifacts, ...seedArtifacts.artifacts, ...annotationArtifacts]
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
        modelName: runtimeModelName
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
