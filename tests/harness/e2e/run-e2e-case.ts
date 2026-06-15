import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
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
import { createRunId, resolveRunArtifactsDir, writeRunLog } from '../core/write-run-log'
import {
  launchElectronApp,
  type E2ERuntimeSignals,
  type ElectronLaunchMode,
  type ElectronWindowMode
} from './electronApp'

export type E2ETestRunMode = 'single' | 'repeatable'

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
}

export type E2ETestCaseDefinition<TResult> = {
  caseId: string
  domain: Extract<TestDomain, 'ai' | 'settings' | 'workbench' | 'kb-search'>
  suite: string
  groups?: readonly string[]
  description: string
  fixtures: readonly string[]
  launchMode?: ElectronLaunchMode
  windowMode?: ElectronWindowMode
  runMode: E2ETestRunMode
  execute: (runtime: E2ETestRuntime) => Promise<TResult>
  assert: (result: TResult, runtime: E2ETestRuntime) => Promise<void>
}

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
  const events: TestLogEvent[] = []
  const artifacts: TestArtifact[] = []
  const logDirArtifacts = resolveRunArtifactsDir({
    scope,
    caseId: definition.caseId,
    runId
  })
  let status: TestRunStatus = 'failed'
  let stepCounter = 0
  let assertionCounter = 0
  let artifactCounter = 0
  let lastStepId: string | null = null
  let failedStepId: string | null = null
  let failedAssertionId: string | null = null
  let executionErrorName: string | null = null
  let executionErrorMessage: string | null = null
  const launchedApp = await launchElectronApp({
    launchMode: definition.launchMode,
    windowMode: definition.windowMode
  })

  const pushEvent = (event: TestLogEvent): void => {
    events.push(event)
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
    if (launchedApp.page.isClosed()) {
      recordEvent({
        type: 'signal',
        name: 'screenshot-skipped',
        status: 'info',
        message: '页面已关闭，跳过失败截图',
        data: {
          name: input.name
        }
      })
      const placeholderPath = path.join(logDirArtifacts, relativePath)
      await writeFile(placeholderPath, 'page already closed; screenshot skipped', 'utf8')
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

  const runtime: E2ETestRuntime = {
    runId,
    taskId,
    page: launchedApp.page,
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
    collectSignals: launchedApp.collectSignals
  }

  recordEvent({
    type: 'run',
    name: 'start',
    status: 'info',
    message: `开始执行 ${scope}/${definition.caseId}`,
    data: {
      description: definition.description,
      fixtures: definition.fixtures.map((fixturePath) => path.resolve(fixturePath)),
      launchMode: definition.launchMode || 'fixture',
      windowMode: definition.windowMode || 'background',
      runMode: definition.runMode
    }
  })

  try {
    const result = await definition.execute(runtime)
    await definition.assert(result, runtime)
    status = 'passed'
  } catch (error) {
    executionErrorName = executionErrorName || (error instanceof Error ? error.name : 'Error')
    executionErrorMessage =
      executionErrorMessage || (error instanceof Error ? error.message : String(error))
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
    throw error
  } finally {
    const signals = await launchedApp.collectSignals()
    const runtimeEvents = signals.aiRunEventEntries.map((entry) => entry.event)

    for (const routeEntry of signals.routeEntries) {
      pushEvent({
        ts: routeEntry.ts,
        type: 'signal',
        name: 'route-change',
        status: 'info',
        message: `路由变更为 ${routeEntry.route}`,
        data: {
          route: routeEntry.route
        }
      })
    }

    for (const ipcEntry of signals.ipcInvokeEntries) {
      pushEvent({
        ts: ipcEntry.ts,
        type: 'signal',
        name: 'ipc-call',
        status: 'info',
        message: `调用 IPC ${ipcEntry.name}`,
        data: {
          name: ipcEntry.name
        }
      })
    }

    for (const aiRunEventEntry of signals.aiRunEventEntries) {
      pushEvent({
        ts: aiRunEventEntry.ts,
        type: 'signal',
        name: 'ai-run-event',
        status: 'info',
        message: `收到 AI 事件 ${aiRunEventEntry.event.type}`,
        data: {
          eventType: aiRunEventEntry.event.type
        }
      })
    }

    for (const consoleEntry of signals.consoleEntries) {
      if (consoleEntry.level === 'log') {
        continue
      }
      pushEvent({
        ts: consoleEntry.ts,
        type: 'signal',
        name: consoleEntry.level === 'warning' ? 'console-warning' : 'console-error',
        status: 'info',
        message: `捕获到 console ${consoleEntry.level}：${consoleEntry.text}`,
        data: {
          level: consoleEntry.level,
          text: consoleEntry.text
        }
      })
    }

    for (const lifecycleEntry of signals.lifecycleEntries) {
      pushEvent({
        ts: lifecycleEntry.ts,
        type: 'signal',
        name: 'electron-lifecycle',
        status: 'info',
        message: `Electron lifecycle: ${lifecycleEntry.name}`,
        data: lifecycleEntry.data
      })
    }

    const traceRelativePath = path.posix.join('trace', 'playwright-trace.zip')
    const traceAbsolutePath = path.join(logDirArtifacts, traceRelativePath)
    await mkdir(path.dirname(traceAbsolutePath), { recursive: true })
    await launchedApp.close({
      tracePath: traceAbsolutePath
    })
    await captureArtifact({
      kind: 'trace',
      relativePath: traceRelativePath,
      message: '保存 Playwright trace'
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

    await writeRunLog({
      meta,
      events,
      runtimeEvents,
      artifacts
    })
  }
}
