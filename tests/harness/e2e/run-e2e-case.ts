import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import type { ElectronApplication } from 'playwright'
import type { JsonValue } from '../../../src/shared/types'
import {
  TEST_LOG_SCHEMA_VERSION,
  type TestArtifact,
  type TestArtifactKind,
  type TestArtifactRefs,
  type TestDomain,
  type TestLogEvent,
  type TestLogStatus,
  type TestRunMeta,
  type TestRunStatus
} from '../core/run-log-contract'
import {
  createRunId,
  createStreamingRunLogWriter,
  resolveRunArtifactsDir,
  type StreamingRunLogWriter
} from '../core/write-run-log'
import {
  launchElectronApp,
  isExpectedForceKilledTeardownExit,
  isExpectedWindowsInspectorTeardownExit,
  type E2ERuntimeSignals,
  type E2EServiceMode,
  type ElectronWindowMode,
  type LaunchedElectronApp
} from './electronApp'
import { ensureE2EModelReady } from './modelFixture'
import {
  E2EResourceScope,
  runWithE2EResourceScope,
  type E2EResourceDisposalError
} from './resourceScope'

export type E2ETestRunMode = 'single' | 'repeatable'
export type E2EExecutionClass = 'normal' | 'live' | 'exclusive' | 'warmup'

type KnowledgeCacheStats = {
  splitCacheHits: number
  splitCacheMisses: number
  vectorCacheHits: number
  vectorCacheMisses: number
}

type KnowledgeCacheSummary = KnowledgeCacheStats & {
  knowledgeCacheEnabled: boolean
  knowledgeCachePath: string
  knowledgeCacheNamespace: string
  buildFingerprint: string
}

const EMPTY_KNOWLEDGE_CACHE_STATS: KnowledgeCacheStats = {
  splitCacheHits: 0,
  splitCacheMisses: 0,
  vectorCacheHits: 0,
  vectorCacheMisses: 0
}

const readKnowledgeCacheStats = async (
  cachePathOrStatsPath: string
): Promise<KnowledgeCacheStats> => {
  if (!cachePathOrStatsPath) return { ...EMPTY_KNOWLEDGE_CACHE_STATS }
  try {
    const statsPath =
      path.basename(cachePathOrStatsPath) === 'stats.json'
        ? cachePathOrStatsPath
        : path.join(cachePathOrStatsPath, 'stats.json')
    const parsed = JSON.parse(await readFile(statsPath, 'utf8')) as Partial<KnowledgeCacheStats>
    return {
      splitCacheHits: Number(parsed.splitCacheHits || 0),
      splitCacheMisses: Number(parsed.splitCacheMisses || 0),
      vectorCacheHits: Number(parsed.vectorCacheHits || 0),
      vectorCacheMisses: Number(parsed.vectorCacheMisses || 0)
    }
  } catch {
    return { ...EMPTY_KNOWLEDGE_CACHE_STATS }
  }
}

const subtractKnowledgeCacheStats = (
  current: KnowledgeCacheStats,
  baseline: KnowledgeCacheStats
): KnowledgeCacheStats => ({
  splitCacheHits: Math.max(0, current.splitCacheHits - baseline.splitCacheHits),
  splitCacheMisses: Math.max(0, current.splitCacheMisses - baseline.splitCacheMisses),
  vectorCacheHits: Math.max(0, current.vectorCacheHits - baseline.vectorCacheHits),
  vectorCacheMisses: Math.max(0, current.vectorCacheMisses - baseline.vectorCacheMisses)
})

type E2EAssertionInput = {
  name: string
  message: string
  data?: JsonValue
}

type E2EStepInput<TResult> = {
  name: string
  message: string
  data?: JsonValue
  run: () => Promise<TResult>
}

type E2ECaptureArtifactInput = {
  kind: TestArtifactKind
  relativePath: string
  message: string
  refs?: TestArtifactRefs
}

export type E2ETestRuntime = {
  runId: string
  taskId: string
  page: Page
  electronApp: ElectronApplication
  userDataDir: string
  recordEvent: (input: Omit<TestLogEvent, 'ts'>) => void
  signal: (input: {
    name: string
    message: string
    status?: TestLogStatus
    data?: JsonValue
  }) => void
  step: <TResult>(input: E2EStepInput<TResult>) => Promise<TResult>
  assertThat: (condition: boolean, input: E2EAssertionInput) => Promise<void>
  captureArtifact: (input: E2ECaptureArtifactInput) => Promise<TestArtifact>
  captureScreenshot: (input: {
    name: string
    message: string
    refs?: TestArtifactRefs
  }) => Promise<TestArtifact>
  collectSignals: () => Promise<E2ERuntimeSignals>
  restartApp: (input?: {
    prepareUserData?: (userDataDir: string) => Promise<void>
  }) => Promise<{ page: Page; electronApp: ElectronApplication }>
  registerResource: (resource: {
    name: string
    phase: 'before-app-close' | 'after-app-close'
    dispose: () => Promise<void>
  }) => void
}

type E2EServiceConfiguration =
  | {
      serviceMode: Extract<E2EServiceMode, 'real'>
      fixtureReason?: never
    }
  | {
      serviceMode: Extract<E2EServiceMode, 'fixture'>
      fixtureReason: string
    }

export type E2ETestCaseDefinition<TResult> = E2EServiceConfiguration & {
  caseId: string
  domain: Extract<TestDomain, 'settings' | 'workbench' | 'showcase'>
  suite: string
  groups?: readonly string[]
  description: string
  fixtures: readonly string[]
  execution?: E2EExecutionClass
  windowMode?: ElectronWindowMode
  extraEnv?: Readonly<Record<string, string>>
  prepareUserData?: (userDataDir: string) => Promise<void>
  runMode: E2ETestRunMode
  execute: (runtime: E2ETestRuntime) => Promise<TResult>
  assert: (result: TResult, runtime: E2ETestRuntime) => Promise<void>
}

export type ShowcaseCaseDefinition<TResult> = Omit<
  E2ETestCaseDefinition<TResult>,
  'domain' | 'suite'
>

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
  events: readonly TestLogEvent[],
  artifacts: readonly TestArtifact[]
): TestRunMeta['stats'] => ({
  durationMs: finishedAtMs - startedAtMs,
  steps: events.filter((event) => event.type === 'step').length,
  assertions: events.filter((event) => event.type === 'assertion').length,
  errors: events.filter((event) => event.type === 'error').length,
  artifacts: artifacts.length
})

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const getRuntimeEventKey = (entry: E2ERuntimeSignals['aiRunEventEntries'][number]): string => {
  const event = entry.event
  const runId = 'runId' in event ? String(event.runId || '') : ''
  const createdAt = 'createdAt' in event ? String(event.createdAt || '') : ''
  return [entry.ts, event.type, runId, createdAt].join(':')
}

const getLlmIoKey = (entry: E2ERuntimeSignals['llmIoEntries'][number]): string =>
  entry.record.callId ||
  [entry.ts, entry.record.runId, entry.record.caller, String(entry.record.startedAt)].join(':')

const getTimelineSignalKey = (input: {
  source: string
  ts: string
  name: string
  data?: JsonValue
}): string => `${input.source}:${input.ts}:${input.name}:${JSON.stringify(input.data || null)}`

const buildPlaywrightReportHtml = (input: {
  caseId: string
  runId: string
  status: TestRunStatus
  signals: E2ERuntimeSignals
}): string => {
  const routeText = JSON.stringify(input.signals.routeEntries, null, 2)
  const ipcText = JSON.stringify(input.signals.ipcInvokeEntries, null, 2)
  const aiEventText = JSON.stringify(
    input.signals.aiRunEventEntries.map((entry) => ({
      ts: entry.ts,
      type: entry.event.type
    })),
    null,
    2
  )
  const consoleText = JSON.stringify(input.signals.consoleEntries, null, 2)
  const lifecycleText = JSON.stringify(input.signals.lifecycleEntries, null, 2)

  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="utf-8" />',
    `  <title>${escapeHtml(input.caseId)} - ${escapeHtml(input.runId)}</title>`,
    '  <style>',
    '    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #1f1f1f; }',
    '    h1, h2 { margin: 0 0 12px; }',
    '    section { margin-top: 20px; }',
    '    pre { background: #f8f8f7; border: 1px solid #e5e5e4; border-radius: 8px; padding: 12px; overflow: auto; }',
    '    .meta { display: flex; gap: 12px; flex-wrap: wrap; }',
    '    .pill { background: #fbf5f2; color: #d97757; border-radius: 999px; padding: 4px 10px; font-size: 12px; }',
    '  </style>',
    '</head>',
    '<body>',
    `  <h1>${escapeHtml(input.caseId)}</h1>`,
    '  <div class="meta">',
    `    <span class="pill">runId: ${escapeHtml(input.runId)}</span>`,
    `    <span class="pill">status: ${escapeHtml(input.status)}</span>`,
    '  </div>',
    '  <section>',
    '    <h2>Routes</h2>',
    `    <pre>${escapeHtml(routeText)}</pre>`,
    '  </section>',
    '  <section>',
    '    <h2>IPC Invocations</h2>',
    `    <pre>${escapeHtml(ipcText)}</pre>`,
    '  </section>',
    '  <section>',
    '    <h2>AI Run Events</h2>',
    `    <pre>${escapeHtml(aiEventText)}</pre>`,
    '  </section>',
    '  <section>',
    '    <h2>Console Entries</h2>',
    `    <pre>${escapeHtml(consoleText)}</pre>`,
    '  </section>',
    '  <section>',
    '    <h2>Lifecycle Entries</h2>',
    `    <pre>${escapeHtml(lifecycleText)}</pre>`,
    '  </section>',
    '</body>',
    '</html>'
  ].join('\n')
}

const resolveE2EModelEnv = async (input: {
  serviceMode: E2EServiceMode
  extraEnv?: Readonly<Record<string, string>>
}): Promise<Readonly<Record<string, string>> | undefined> => {
  const { serviceMode, extraEnv } = input
  if (serviceMode === 'fixture') {
    return extraEnv
  }
  if (extraEnv && Object.prototype.hasOwnProperty.call(extraEnv, 'NCURATOR_MODELS_PATH')) {
    return extraEnv
  }
  const modelsPath = await ensureE2EModelReady()
  return { ...extraEnv, NCURATOR_MODELS_PATH: modelsPath }
}

export const runE2ECase = async <TResult>(
  definition: E2ETestCaseDefinition<TResult>
): Promise<void> => {
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
  const resolvedExtraEnv = await resolveE2EModelEnv({
    serviceMode: definition.serviceMode,
    extraEnv: definition.extraEnv
  })
  const events: TestLogEvent[] = []
  const artifacts: TestArtifact[] = []
  const streamingLogWriter: StreamingRunLogWriter = createStreamingRunLogWriter({
    scope,
    caseId: definition.caseId,
    runId
  })
  const logDirArtifacts = resolveRunArtifactsDir({
    scope,
    caseId: definition.caseId,
    runId
  })
  const knowledgeCachePath = String(
    process.env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE_PATH || ''
  ).trim()
  const knowledgeCacheStatsPath = String(
    process.env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE_STATS_PATH || ''
  ).trim()
  const knowledgeCacheEnabled =
    String(process.env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE || '').trim() === '1' &&
    Boolean(knowledgeCachePath)
  const knowledgeCacheBaseline = knowledgeCacheEnabled
    ? await readKnowledgeCacheStats(knowledgeCacheStatsPath || knowledgeCachePath)
    : { ...EMPTY_KNOWLEDGE_CACHE_STATS }
  const emittedTimelineSignalKeys = new Set<string>()
  const emittedRuntimeEventKeys = new Set<string>()
  const emittedLlmIoKeys = new Set<string>()
  let launchedApp: LaunchedElectronApp | null = null
  let status: TestRunStatus = 'failed'
  let stepCounter = 0
  let assertionCounter = 0
  let artifactCounter = 0
  let lastStepId: string | null = null
  let failedStepId: string | null = null
  let failedAssertionId: string | null = null
  let executionErrorName: string | null = null
  let executionErrorMessage: string | null = null
  let primaryError: Error | null = null
  const resourceScope = new E2EResourceScope()
  const teardownErrors: E2EResourceDisposalError[] = []

  const pushEvent = (event: TestLogEvent): void => {
    events.push(event)
    streamingLogWriter.appendTimelineEvent(event)
  }

  const appendRuntimeEventOnce = (entry: E2ERuntimeSignals['aiRunEventEntries'][number]): void => {
    const key = getRuntimeEventKey(entry)
    if (emittedRuntimeEventKeys.has(key)) return
    emittedRuntimeEventKeys.add(key)
    streamingLogWriter.appendRuntimeEvent(entry.event)
  }

  const appendLlmIoOnce = (entry: E2ERuntimeSignals['llmIoEntries'][number]): void => {
    const key = getLlmIoKey(entry)
    if (emittedLlmIoKeys.has(key)) return
    emittedLlmIoKeys.add(key)
    streamingLogWriter.appendLlmIoRecord(entry.record)
  }

  const pushSignalEventOnce = (input: { source: string; event: TestLogEvent }): void => {
    const key = getTimelineSignalKey({
      source: input.source,
      ts: input.event.ts,
      name: input.event.name,
      data: input.event.data
    })
    if (emittedTimelineSignalKeys.has(key)) return
    emittedTimelineSignalKeys.add(key)
    pushEvent(input.event)
  }

  const recordEvent = (input: Omit<TestLogEvent, 'ts'>): void => {
    pushEvent({
      ts: new Date().toISOString(),
      ...input
    })
  }

  const nextArtifactId = (): string => {
    artifactCounter += 1
    return `artifact-${artifactCounter}`
  }

  const captureArtifact = async (input: E2ECaptureArtifactInput): Promise<TestArtifact> => {
    await mkdir(path.join(logDirArtifacts, path.dirname(input.relativePath)), { recursive: true })
    const artifact: TestArtifact = {
      id: nextArtifactId(),
      kind: input.kind,
      path: path.posix.join('artifacts', input.relativePath.split(path.sep).join('/')),
      fileName: path.posix.basename(input.relativePath.split(path.sep).join('/')),
      refs: input.refs
    }
    artifacts.push(artifact)
    recordEvent({
      type: 'artifact',
      name: input.kind,
      status: 'info',
      message: input.message,
      data: {
        artifactId: artifact.id,
        path: artifact.path
      }
    })
    return artifact
  }

  const captureScreenshot = async (input: {
    name: string
    message: string
    refs?: TestArtifactRefs
  }): Promise<TestArtifact> => {
    const relativePath = path.posix.join('screenshots', `${input.name}.png`)
    const absolutePath = path.join(logDirArtifacts, relativePath)
    await mkdir(path.dirname(absolutePath), { recursive: true })
    if (!launchedApp || launchedApp.page.isClosed()) {
      recordEvent({
        type: 'signal',
        name: 'screenshot-skipped',
        status: 'info',
        message: launchedApp ? '页面已关闭，跳过失败截图' : 'Electron 未启动，跳过失败截图',
        data: {
          name: input.name
        }
      })
      const placeholderPath = path.join(logDirArtifacts, relativePath)
      await writeFile(
        placeholderPath,
        launchedApp
          ? 'page already closed; screenshot skipped'
          : 'electron not launched; screenshot skipped',
        'utf8'
      )
      return captureArtifact({
        kind: 'other',
        relativePath,
        message: '页面已关闭，保存截图占位文件',
        refs: input.refs
      })
    }
    await launchedApp.page.screenshot({
      path: absolutePath
    })
    return captureArtifact({
      kind: 'screenshot',
      relativePath,
      message: input.message,
      refs: input.refs
    })
  }

  const signal = (input: {
    name: string
    message: string
    status?: TestLogStatus
    data?: JsonValue
  }): void => {
    recordEvent({
      type: 'signal',
      name: input.name,
      status: input.status || 'info',
      message: input.message,
      data: input.data
    })
  }

  const createRuntime = (app: LaunchedElectronApp): E2ETestRuntime => {
    let currentApp = app
    let restartCounter = 0
    const archivedSignals: E2ERuntimeSignals[] = []
    const runtime: E2ETestRuntime = {
      runId,
      taskId,
      page: app.page,
      electronApp: app.electronApp,
      userDataDir: app.userDataDir,
      recordEvent,
      signal,
      step: async (input) => {
        stepCounter += 1
        const stepId = `step-${stepCounter}`
        lastStepId = stepId
        try {
          const result = await input.run()
          recordEvent({
            type: 'step',
            name: input.name,
            id: stepId,
            status: 'ok',
            message: input.message,
            data: input.data
          })
          return result
        } catch (error) {
          failedStepId = stepId
          executionErrorName = error instanceof Error ? error.name : 'Error'
          executionErrorMessage = error instanceof Error ? error.message : String(error)
          recordEvent({
            type: 'step',
            name: input.name,
            id: stepId,
            status: 'failed',
            message: input.message,
            data: {
              input: input.data || null,
              errorName: executionErrorName,
              errorMessage: executionErrorMessage
            }
          })
          throw error
        }
      },
      assertThat: async (condition, input) => {
        assertionCounter += 1
        const assertionId = `assertion-${assertionCounter}`
        if (!condition) {
          failedAssertionId = assertionId
        }
        recordEvent({
          type: 'assertion',
          name: input.name,
          id: assertionId,
          status: condition ? 'ok' : 'failed',
          message: input.message,
          data: input.data
        })
        if (!condition) {
          await captureScreenshot({
            name: `${input.name}-${assertionId}-failed`,
            message: '保存失败截图',
            refs: {
              assertionId,
              stepId: lastStepId || undefined
            }
          })
          throw new Error(input.message)
        }
      },
      captureArtifact,
      captureScreenshot,
      collectSignals: async () => {
        const currentSignals = await currentApp.collectSignals()
        const allSignals = [...archivedSignals, currentSignals]
        return {
          routeEntries: allSignals.flatMap((signals) => signals.routeEntries),
          ipcInvokeEntries: allSignals.flatMap((signals) => signals.ipcInvokeEntries),
          aiRunEventEntries: allSignals.flatMap((signals) => signals.aiRunEventEntries),
          llmIoEntries: allSignals.flatMap((signals) => signals.llmIoEntries || []),
          domEventEntries: allSignals.flatMap((signals) => signals.domEventEntries),
          consoleEntries: allSignals.flatMap((signals) => signals.consoleEntries),
          lifecycleEntries: allSignals.flatMap((signals) => signals.lifecycleEntries)
        }
      },
      restartApp: async (input) => {
        restartCounter += 1
        archivedSignals.push(await currentApp.collectSignals())
        const traceRelativePath = path.posix.join(
          'trace',
          `playwright-trace-before-restart-${String(restartCounter)}.zip`
        )
        const traceAbsolutePath = path.join(logDirArtifacts, traceRelativePath)
        await mkdir(path.dirname(traceAbsolutePath), { recursive: true })
        await currentApp.close({ tracePath: traceAbsolutePath, preserveUserData: true })
        await captureArtifact({
          kind: 'trace',
          relativePath: traceRelativePath,
          message: `保存第 ${String(restartCounter)} 次重启前的 Playwright trace`
        })
        currentApp = await launchElectronApp({
          serviceMode: definition.serviceMode,
          windowMode: definition.windowMode,
          extraEnv: resolvedExtraEnv,
          prepareUserData: input?.prepareUserData,
          signalSink,
          userDataDir: app.userDataDir
        })
        launchedApp = currentApp
        runtime.page = currentApp.page
        runtime.electronApp = currentApp.electronApp
        return { page: currentApp.page, electronApp: currentApp.electronApp }
      },
      registerResource: (resource) => resourceScope.register(resource)
    }
    return runtime
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
        driver: 'playwright',
        target: 'electron',
        modelName: null
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
      serviceMode: definition.serviceMode,
      execution: definition.execution || 'normal',
      fixtureReason: definition.fixtureReason || null,
      windowMode: definition.windowMode || 'background',
      runMode: definition.runMode
    }
  })
  await streamingLogWriter.flush()

  const signalSink = {
    onAiRunEvent: (entry: E2ERuntimeSignals['aiRunEventEntries'][number]) => {
      appendRuntimeEventOnce(entry)
      pushSignalEventOnce({
        source: 'ai-run-event',
        event: {
          ts: entry.ts,
          type: 'signal' as const,
          name: 'ai-run-event',
          status: 'info' as const,
          message: `收到 AI 事件 ${entry.event.type}`,
          data: { eventType: entry.event.type }
        }
      })
    },
    onLlmIo: (entry: E2ERuntimeSignals['llmIoEntries'][number]) => {
      appendLlmIoOnce(entry)
    },
    onConsole: (entry: E2ERuntimeSignals['consoleEntries'][number]) => {
      if (entry.level === 'log') return
      pushSignalEventOnce({
        source: 'console',
        event: {
          ts: entry.ts,
          type: 'signal' as const,
          name: entry.level === 'warning' ? 'console-warning' : 'console-error',
          status: 'info' as const,
          message: `捕获到 console ${entry.level}：${entry.text}`,
          data: { level: entry.level, text: entry.text }
        }
      })
    },
    onLifecycle: (entry: E2ERuntimeSignals['lifecycleEntries'][number]) => {
      pushSignalEventOnce({
        source: 'electron-lifecycle',
        event: {
          ts: entry.ts,
          type: 'signal' as const,
          name: 'electron-lifecycle',
          status: 'info' as const,
          message: `Electron lifecycle: ${entry.name}`,
          data: entry.data
        }
      })
    }
  }

  try {
    launchedApp = await launchElectronApp({
      serviceMode: definition.serviceMode,
      windowMode: definition.windowMode,
      extraEnv: resolvedExtraEnv,
      prepareUserData: definition.prepareUserData,
      signalSink
    })
    recordEvent({
      type: 'signal',
      name: 'electron-app-verified',
      status: 'ok',
      message: `已验证 ${launchedApp.appInfo.target} Electron 应用`,
      data: launchedApp.appInfo
    })
    const runtime = createRuntime(launchedApp)
    await runWithE2EResourceScope(resourceScope, async () => {
      const result = await definition.execute(runtime)
      await definition.assert(result, runtime)
    })
    status = 'passed'
  } catch (error) {
    primaryError = error instanceof Error ? error : new Error(String(error))
    executionErrorName = executionErrorName || primaryError.name
    executionErrorMessage = executionErrorMessage || primaryError.message
    recordEvent({
      type: 'error',
      name: 'execution-failed',
      status: 'failed',
      message: `测试失败：${executionErrorMessage}`,
      data: {
        errorName: executionErrorName,
        errorMessage: executionErrorMessage,
        failedStepId,
        failedAssertionId
      }
    })
    if (!artifacts.some((artifact) => artifact.kind === 'screenshot')) {
      await captureScreenshot({
        name: 'run-failure',
        message: '保存失败截图',
        refs: {
          stepId: lastStepId || undefined
        }
      })
    }
  } finally {
    const signals: E2ERuntimeSignals = launchedApp
      ? await launchedApp.collectSignals()
      : {
          routeEntries: [],
          ipcInvokeEntries: [],
          aiRunEventEntries: [],
          llmIoEntries: [],
          domEventEntries: [],
          consoleEntries: [],
          lifecycleEntries: []
        }

    for (const routeEntry of signals.routeEntries) {
      pushSignalEventOnce({
        source: 'route-change',
        event: {
          ts: routeEntry.ts,
          type: 'signal',
          name: 'route-change',
          status: 'info',
          message: `路由变更为 ${routeEntry.route}`,
          data: {
            route: routeEntry.route
          }
        }
      })
    }

    for (const ipcEntry of signals.ipcInvokeEntries) {
      pushSignalEventOnce({
        source: 'ipc-call',
        event: {
          ts: ipcEntry.ts,
          type: 'signal',
          name: 'ipc-call',
          status: 'info',
          message: `调用 IPC ${ipcEntry.name}`,
          data: {
            name: ipcEntry.name
          }
        }
      })
    }

    for (const aiRunEventEntry of signals.aiRunEventEntries) {
      appendRuntimeEventOnce(aiRunEventEntry)
      pushSignalEventOnce({
        source: 'ai-run-event',
        event: {
          ts: aiRunEventEntry.ts,
          type: 'signal',
          name: 'ai-run-event',
          status: 'info',
          message: `收到 AI 事件 ${aiRunEventEntry.event.type}`,
          data: {
            eventType: aiRunEventEntry.event.type
          }
        }
      })
    }

    for (const llmIoEntry of signals.llmIoEntries || []) {
      appendLlmIoOnce(llmIoEntry)
    }

    for (const consoleEntry of signals.consoleEntries) {
      if (consoleEntry.level === 'log') {
        continue
      }
      pushSignalEventOnce({
        source: 'console',
        event: {
          ts: consoleEntry.ts,
          type: 'signal',
          name: consoleEntry.level === 'warning' ? 'console-warning' : 'console-error',
          status: 'info',
          message: `捕获到 console ${consoleEntry.level}：${consoleEntry.text}`,
          data: {
            level: consoleEntry.level,
            text: consoleEntry.text
          }
        }
      })
    }

    for (const lifecycleEntry of signals.lifecycleEntries) {
      pushSignalEventOnce({
        source: 'electron-lifecycle',
        event: {
          ts: lifecycleEntry.ts,
          type: 'signal',
          name: 'electron-lifecycle',
          status: 'info',
          message: `Electron lifecycle: ${lifecycleEntry.name}`,
          data: lifecycleEntry.data
        }
      })
    }

    teardownErrors.push(...(await resourceScope.dispose('before-app-close')))

    if (launchedApp) {
      const traceRelativePath = path.posix.join('trace', 'playwright-trace.zip')
      const traceAbsolutePath = path.join(logDirArtifacts, traceRelativePath)
      await mkdir(path.dirname(traceAbsolutePath), { recursive: true })
      try {
        await launchedApp.close({
          tracePath: traceAbsolutePath
        })
        await captureArtifact({
          kind: 'trace',
          relativePath: traceRelativePath,
          message: '保存 Playwright trace'
        })
      } catch (error) {
        teardownErrors.push({
          name: 'electron-app-close',
          phase: 'before-app-close',
          error: error instanceof Error ? error : new Error(String(error))
        })
      }

      const processExit = signals.lifecycleEntries
        .filter((entry) => entry.name === 'electron-process-exit')
        .at(-1)
      const processExitData = processExit?.data as
        | { code?: number | null; signal?: string | null }
        | undefined
      const testPassed = status === 'passed' && !primaryError
      const isKnownWindowsInspectorExit = isExpectedWindowsInspectorTeardownExit({
        platform: process.platform,
        lifecycleEntries: signals.lifecycleEntries,
        testPassed
      })
      const isKnownForceKilledExit = isExpectedForceKilledTeardownExit({
        lifecycleEntries: signals.lifecycleEntries,
        testPassed
      })
      if (isKnownWindowsInspectorExit) {
        recordEvent({
          type: 'signal',
          name: 'electron-inspector-exit-warning',
          status: 'info',
          message: `Electron exited with known Windows inspector status ${String(processExitData?.code)}`,
          data: processExitData
        })
      } else if (isKnownForceKilledExit) {
        recordEvent({
          type: 'signal',
          name: 'electron-force-kill-exit-warning',
          status: 'info',
          message: `Electron force-killed after hung close (signal=${String(processExitData?.signal || '')})`,
          data: processExitData
        })
      } else if (
        processExitData &&
        (processExitData.code !== 0 || Boolean(processExitData.signal))
      ) {
        teardownErrors.push({
          name: 'electron-process-exit',
          phase: 'before-app-close',
          error: new Error(
            `Electron exited with code=${String(processExitData.code)} signal=${String(processExitData.signal || '')}`
          )
        })
      }
    }

    teardownErrors.push(...(await resourceScope.dispose('after-app-close')))
    for (const teardownError of teardownErrors) {
      recordEvent({
        type: 'error',
        name: 'teardown-failed',
        status: 'failed',
        message: `Failed to dispose ${teardownError.name}: ${teardownError.error.message}`,
        data: {
          resourceName: teardownError.name,
          phase: teardownError.phase,
          errorName: teardownError.error.name,
          errorMessage: teardownError.error.message
        }
      })
    }
    if (!primaryError && teardownErrors.length > 0) {
      primaryError = new AggregateError(
        teardownErrors.map((entry) => entry.error),
        `E2E teardown failed for ${teardownErrors.map((entry) => entry.name).join(', ')}`
      )
      executionErrorName = primaryError.name
      executionErrorMessage = primaryError.message
      status = 'failed'
    }

    const knowledgeCacheCurrent = knowledgeCacheEnabled
      ? await readKnowledgeCacheStats(knowledgeCacheStatsPath || knowledgeCachePath)
      : { ...EMPTY_KNOWLEDGE_CACHE_STATS }
    const knowledgeCacheSummary: KnowledgeCacheSummary = {
      knowledgeCacheEnabled,
      knowledgeCachePath,
      knowledgeCacheNamespace: String(
        process.env.NCURATOR_E2E_KNOWLEDGE_CACHE_NAMESPACE || ''
      ).trim(),
      buildFingerprint: String(process.env.NCURATOR_E2E_BUILD_FINGERPRINT || '').trim(),
      ...subtractKnowledgeCacheStats(knowledgeCacheCurrent, knowledgeCacheBaseline)
    }
    const knowledgeCacheSummaryPath = path.join(logDirArtifacts, 'knowledge-cache-summary.json')
    await mkdir(path.dirname(knowledgeCacheSummaryPath), { recursive: true })
    await writeFile(
      knowledgeCacheSummaryPath,
      `${JSON.stringify(knowledgeCacheSummary, null, 2)}\n`,
      'utf8'
    )
    await captureArtifact({
      kind: 'other',
      relativePath: 'knowledge-cache-summary.json',
      message: '保存本用例知识库缓存命中统计'
    })
    recordEvent({
      type: 'signal',
      name: 'knowledge-cache-summary',
      status: 'info',
      message: knowledgeCacheEnabled ? '记录本用例知识库缓存命中统计' : '本用例未启用知识库缓存',
      data: knowledgeCacheSummary
    })

    if (status === 'failed') {
      const reportRelativePath = path.posix.join('playwright', 'report', 'index.html')
      const reportAbsolutePath = path.join(logDirArtifacts, reportRelativePath)
      await mkdir(path.dirname(reportAbsolutePath), { recursive: true })
      await writeFile(
        reportAbsolutePath,
        buildPlaywrightReportHtml({
          caseId: definition.caseId,
          runId,
          status,
          signals
        }),
        'utf8'
      )
      await captureArtifact({
        kind: 'playwright-report',
        relativePath: reportRelativePath,
        message: '生成 Playwright HTML 诊断页'
      })
    }

    recordEvent({
      type: 'run',
      name: 'end',
      status: status === 'passed' ? 'ok' : 'failed',
      message: status === 'passed' ? '本次测试执行完成' : '本次测试执行失败',
      data:
        status === 'passed'
          ? null
          : {
              errorName: executionErrorName,
              errorMessage: executionErrorMessage,
              failedStepId,
              failedAssertionId
            }
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
        driver: 'playwright',
        target: 'electron',
        modelName: null
      }
    }

    await streamingLogWriter.finalize({
      meta,
      artifacts
    })
  }

  if (primaryError) throw primaryError
}

export const runShowcaseCase = async <TResult>(
  definition: ShowcaseCaseDefinition<TResult>
): Promise<void> =>
  runE2ECase({
    ...definition,
    domain: 'showcase',
    suite: 'collection'
  })
