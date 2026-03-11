import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, it } from 'vitest'
import { chatSelectors } from '../../../../src/renderer/src/testing/selectors'
import type { UiAssertion } from '../../../harness/e2e/reporter'
import { writeUiCaseReport } from '../../../harness/e2e/reporter'
import {
  launchElectronApp,
  type E2ERuntimeSignals,
  type LaunchedElectronApp
} from '../../../harness/e2e/electronApp'

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

const waitForTestIdText = async (
  appPage: LaunchedElectronApp['page'],
  testId: string,
  expectedText: string
) => {
  await appPage.waitForFunction(
    ({ selector, expected }) => {
      const node = document.querySelector(`[data-testid="${selector}"]`)
      return Boolean(node?.textContent?.includes(expected))
    },
    {
      selector: testId,
      expected: expectedText
    },
    {
      timeout: 10_000
    }
  )
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

const finalizeCase = async (input: {
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
}): Promise<void> => {
  const artifacts = await createCaseArtifacts(input.suite, input.caseId, input.startedAt)
  const runtimeSignals: E2ERuntimeSignals = input.app
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
    domRefs: ['dom/final.html']
  })
}

describe('chat.fixture-flows.e2e', () => {
  let app: LaunchedElectronApp | null = null

  afterEach(async () => {
    if (app) {
      await app.electronApp.close()
      app = null
    }
  })

  it('renders plan, retrieval output, and artifact from the main-process fixture flow', async () => {
    const startedAt = Date.now()
    const userActionSequence: string[] = []
    const selectorFailures: string[] = []
    const assertions: UiAssertion[] = []
    const notes: string[] = []
    let runtimeError: Error | null = null

    try {
      app = await launchElectronApp()
      await openChatPage(app.page, userActionSequence)
      await submitPrompt(app.page, '[e2e:chat-plan-artifact] 生成测试产物', userActionSequence)

      await waitForTestIdText(app.page, chatSelectors.rightPanelTitle, '检索结果')
      await app.page.waitForSelector('text=生成测试文档', { timeout: 10_000 })
      await app.page.waitForSelector('text=ncurator-e2e-result.docx', { timeout: 10_000 })

      assertions.push({ id: 'chat-right-panel-retrieval', pass: true })
      assertions.push({ id: 'chat-plan-task-rendered', pass: true })
      assertions.push({ id: 'chat-artifact-rendered', pass: true })
    } catch (error) {
      runtimeError = error instanceof Error ? error : new Error(String(error))
      selectorFailures.push('chat-plan-artifact-flow')
      notes.push(runtimeError.message)
      assertions.push({
        id: 'chat-plan-artifact-flow',
        pass: false,
        details: runtimeError.message
      })
    }

    await finalizeCase({
      app,
      suite: 'e2e-chat',
      caseId: 'chat-plan-artifact-rendering',
      startedAt,
      assertions,
      notes,
      userActionSequence,
      selectorFailures,
      executionStatus: runtimeError ? 'failed' : 'completed',
      executionResultCode: runtimeError ? 'runtime_exception' : 'ok'
    })

    app = null

    if (runtimeError) {
      throw runtimeError
    }
  })

  it('submits an approval decision through the real Electron flow', async () => {
    const startedAt = Date.now()
    const userActionSequence: string[] = []
    const selectorFailures: string[] = []
    const assertions: UiAssertion[] = []
    const notes: string[] = []
    let runtimeError: Error | null = null

    try {
      app = await launchElectronApp()
      await openChatPage(app.page, userActionSequence)
      await submitPrompt(app.page, '[e2e:chat-approval] 继续这个需要审批的请求', userActionSequence)

      await app.page.getByTestId(chatSelectors.approvalBanner).waitFor({
        timeout: 10_000
      })
      await app.page.getByTestId(chatSelectors.approvalApproveButton).click()
      userActionSequence.push('click:chat-approval-approve-button')

      await app.page.waitForSelector('text=审批通过，E2E fixture 已继续执行。', {
        timeout: 10_000
      })

      assertions.push({ id: 'chat-approval-banner-rendered', pass: true })
      assertions.push({ id: 'chat-approval-decision-invoked', pass: true })
      assertions.push({ id: 'chat-approval-run-completed', pass: true })
    } catch (error) {
      runtimeError = error instanceof Error ? error : new Error(String(error))
      selectorFailures.push('chat-approval-flow')
      notes.push(runtimeError.message)
      assertions.push({
        id: 'chat-approval-flow',
        pass: false,
        details: runtimeError.message
      })
    }

    await finalizeCase({
      app,
      suite: 'e2e-chat',
      caseId: 'chat-approval-required',
      startedAt,
      assertions,
      notes,
      userActionSequence,
      selectorFailures,
      executionStatus: runtimeError ? 'failed' : 'completed',
      executionResultCode: runtimeError ? 'runtime_exception' : 'ok'
    })

    app = null

    if (runtimeError) {
      throw runtimeError
    }
  })

  it('restarts the request after a workspace-required interruption', async () => {
    const startedAt = Date.now()
    const userActionSequence: string[] = []
    const selectorFailures: string[] = []
    const assertions: UiAssertion[] = []
    const notes: string[] = []
    let runtimeError: Error | null = null

    try {
      app = await launchElectronApp()
      await openChatPage(app.page, userActionSequence)
      await submitPrompt(app.page, '[e2e:chat-workspace] 需要工作区上下文', userActionSequence)

      await app.page.getByTestId(chatSelectors.workspaceBanner).waitFor({
        timeout: 10_000
      })
      await app.page.getByTestId(chatSelectors.sourceScopeField).locator('.ant-select-selector').click()
      await app.page.locator('.ant-select-item-option-content').filter({ hasText: 'E2E 测试工作区' }).click()
      userActionSequence.push('select:e2e-workspace-scope')
      await app.page.keyboard.press('Escape')
      await app.page.getByTestId(chatSelectors.workspaceContinueButton).click()
      userActionSequence.push('click:chat-workspace-continue-button')

      await app.page.waitForSelector('text=工作区已补充，E2E fixture 已继续执行。', {
        timeout: 10_000
      })
      await app.page.waitForSelector('text=生成测试文档', {
        timeout: 10_000
      })

      assertions.push({ id: 'chat-workspace-banner-rendered', pass: true })
      assertions.push({ id: 'chat-workspace-scope-selected', pass: true })
      assertions.push({ id: 'chat-workspace-run-restarted', pass: true })
    } catch (error) {
      runtimeError = error instanceof Error ? error : new Error(String(error))
      selectorFailures.push('chat-workspace-flow')
      notes.push(runtimeError.message)
      assertions.push({
        id: 'chat-workspace-flow',
        pass: false,
        details: runtimeError.message
      })
    }

    await finalizeCase({
      app,
      suite: 'e2e-chat',
      caseId: 'chat-workspace-required',
      startedAt,
      assertions,
      notes,
      userActionSequence,
      selectorFailures,
      executionStatus: runtimeError ? 'failed' : 'completed',
      executionResultCode: runtimeError ? 'runtime_exception' : 'ok'
    })

    app = null

    if (runtimeError) {
      throw runtimeError
    }
  })
})
