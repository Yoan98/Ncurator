import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, it } from 'vitest'
import { chatSelectors } from '../../../../src/renderer/src/testing/selectors'
import type { UiAssertion } from '../../../harness/e2e/reporter'
import { writeUiCaseReport } from '../../../harness/e2e/reporter'
import { launchElectronApp, type LaunchedElectronApp } from '../../../harness/e2e/electronApp'
import { isAiLiveSuiteEnabled } from '../../../harness/e2e/live'

type CaseArtifacts = {
  reportRoot: string
  screenshotPath: string
  tracePath: string
  domPath: string
}

const pad2 = (value: number): string => String(value).padStart(2, '0')

const toTimestamp = (ms: number): string => {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}_${pad2(
    date.getHours()
  )}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

const createCaseArtifacts = async (suite: string, caseId: string, startedAt: number): Promise<CaseArtifacts> => {
  const reportRoot = path.resolve(
    process.cwd(),
    'tests',
    'report',
    suite,
    caseId,
    toTimestamp(startedAt)
  )
  const screenshotPath = path.join(reportRoot, 'screenshots', 'final.png')
  const tracePath = path.join(reportRoot, 'trace', 'trace.zip')
  const domPath = path.join(reportRoot, 'dom', 'final.html')

  await mkdir(path.dirname(screenshotPath), { recursive: true })
  await mkdir(path.dirname(tracePath), { recursive: true })
  await mkdir(path.dirname(domPath), { recursive: true })

  return {
    reportRoot,
    screenshotPath,
    tracePath,
    domPath
  }
}

const openChatPage = async (appPage: LaunchedElectronApp['page'], userActionSequence: string[]) => {
  await appPage.evaluate(() => {
    window.location.hash = '#/chat'
  })
  userActionSequence.push('navigate:#/chat')
  await appPage.getByTestId(chatSelectors.page).waitFor({
    timeout: 10_000
  })
}

const submitPrompt = async (
  appPage: LaunchedElectronApp['page'],
  prompt: string,
  userActionSequence: string[]
) => {
  await appPage.getByTestId(chatSelectors.input).fill(prompt)
  userActionSequence.push(`fill:${prompt}`)
  await appPage.getByTestId(chatSelectors.sendButton).click()
  userActionSequence.push('click:chat-send-button')
}

const finalizeLiveCase = async (input: {
  app: LaunchedElectronApp | null
  suite: string
  caseId: string
  startedAt: number
  assertions: UiAssertion[]
  notes: string[]
  userActionSequence: string[]
  selectorFailures: string[]
  executionStatus: 'completed' | 'failed'
  executionResultCode: string
  taskGoal: string
}): Promise<void> => {
  const artifacts = await createCaseArtifacts(input.suite, input.caseId, input.startedAt)
  const runtimeSignals = input.app
    ? await input.app.collectSignals()
    : {
        routeSequence: [],
        ipcInvokeSequence: [],
        aiRunEvents: [],
        consoleEntries: []
      }

  if (input.app) {
    await input.app.page.screenshot({
      path: artifacts.screenshotPath,
      fullPage: true
    })
    await writeFile(artifacts.domPath, await input.app.page.content(), 'utf8')
    await input.app.close({
      tracePath: artifacts.tracePath
    })
  }

  await writeUiCaseReport({
    suite: input.suite,
    caseId: input.caseId,
    startedAt: input.startedAt,
    finishedAt: Date.now(),
    reportRoot: artifacts.reportRoot,
    executionStatus: input.executionStatus,
    executionResultCode: input.executionResultCode,
    assertions: input.assertions,
    notes: input.notes,
    aiRunEvents: runtimeSignals.aiRunEvents,
    routeSequence: runtimeSignals.routeSequence,
    userActionSequence: input.userActionSequence,
    ipcInvokeSequence: runtimeSignals.ipcInvokeSequence,
    selectorFailures: input.selectorFailures,
    consoleEntries: runtimeSignals.consoleEntries,
    screenshotRefs: ['screenshots/final.png'],
    traceRef: 'trace/trace.zip',
    domRefs: ['dom/final.html'],
    expectedOutcome: 'success',
    scenarioTags: ['e2e', 'chat', 'ai-live', 'approval-recovery', 'non-blocking'],
    taskGoal: input.taskGoal
  })
}

const liveIt = isAiLiveSuiteEnabled() ? it : it.skip

describe('chat.approval-recovery.live', () => {
  let app: LaunchedElectronApp | null = null

  afterEach(async () => {
    if (app) {
      await app.electronApp.close()
      app = null
    }
  })

  liveIt('observes an approval interruption and resumes the run in the non-blocking ai-live suite', async () => {
    const startedAt = Date.now()
    const userActionSequence: string[] = []
    const selectorFailures: string[] = []
    const assertions: UiAssertion[] = []
    const notes: string[] = []
    const taskGoal = 'Observe an approval interruption in Chat, approve it, and confirm the run resumes.'
    let runtimeError: Error | null = null

    try {
      app = await launchElectronApp()
      await openChatPage(app.page, userActionSequence)
      await submitPrompt(app.page, '[e2e:chat-approval] 继续这个需要审批的请求', userActionSequence)

      await app.page.getByTestId(chatSelectors.approvalBanner).waitFor({
        timeout: 10_000
      })
      assertions.push({ id: 'ai-live-approval-banner-rendered', pass: true })

      await app.page.getByTestId(chatSelectors.approvalApproveButton).click()
      userActionSequence.push('click:chat-approval-approve-button')

      await app.page.waitForSelector('text=审批通过，E2E fixture 已继续执行。', {
        timeout: 10_000
      })

      assertions.push({ id: 'ai-live-approval-resumed', pass: true })
    } catch (error) {
      runtimeError = error instanceof Error ? error : new Error(String(error))
      selectorFailures.push('chat-approval-recovery-live')
      notes.push(runtimeError.message)
      assertions.push({
        id: 'chat-approval-recovery-live',
        pass: false,
        details: runtimeError.message
      })
    }

    await finalizeLiveCase({
      app,
      suite: 'e2e-chat-ai-live',
      caseId: 'chat-approval-recovery-live',
      startedAt,
      assertions,
      notes,
      userActionSequence,
      selectorFailures,
      executionStatus: runtimeError ? 'failed' : 'completed',
      executionResultCode: runtimeError ? 'runtime_exception' : 'ok',
      taskGoal
    })

    app = null

    if (runtimeError) {
      throw runtimeError
    }
  })
})
