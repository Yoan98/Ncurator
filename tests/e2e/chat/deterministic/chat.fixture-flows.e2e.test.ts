import { afterEach, describe, it } from 'vitest'
import { chatSelectors, workbenchSelectors } from '../../../../src/renderer/src/testing/selectors'
import type { UiAssertion } from '../../../harness/e2e/reporter'
import { finalizeElectronUiCase } from '../../../harness/e2e/uiCase'
import {
  launchElectronApp,
  type LaunchedElectronApp
} from '../../../harness/e2e/electronApp'

const openWorkbenchPage = async (
  appPage: LaunchedElectronApp['page'],
  userActionSequence: string[]
) => {
  await appPage.evaluate(() => {
    window.location.hash = '#/'
  })
  userActionSequence.push('navigate:#/')
  await appPage.getByTestId(workbenchSelectors.page).waitFor({
    timeout: 10_000
  })
}

const submitPrompt = async (
  appPage: LaunchedElectronApp['page'],
  prompt: string,
  userActionSequence: string[]
) => {
  await appPage.getByTestId(workbenchSelectors.input).fill(prompt)
  userActionSequence.push(`fill:${prompt}`)
  await appPage.getByTestId(workbenchSelectors.sendButton).click()
  userActionSequence.push('click:workbench-send-button')
}

describe('chat.fixture-flows.e2e', () => {
  let app: LaunchedElectronApp | null = null

  afterEach(async () => {
    if (app) {
      await app.electronApp.close()
      app = null
    }
  })

  it('renders plan, timeline, and artifact from the main-process fixture flow in the unified workbench', async () => {
    const startedAt = Date.now()
    const userActionSequence: string[] = []
    const selectorFailures: string[] = []
    const assertions: UiAssertion[] = []
    const notes: string[] = []
    const taskGoal =
      'Send an AI workbench request and verify the unified timeline plus artifact inspector render the deterministic fixture plan and docx preview.'
    let runtimeError: Error | null = null

    try {
      app = await launchElectronApp()
      await openWorkbenchPage(app.page, userActionSequence)
      await submitPrompt(app.page, '[e2e:chat-plan-artifact] 生成测试产物', userActionSequence)

      await app.page.getByTestId(workbenchSelectors.timeline).waitFor({
        timeout: 10_000
      })
      await app.page.getByTestId(workbenchSelectors.inspectorTitle).waitFor({
        timeout: 10_000
      })
      await app.page.waitForSelector('text=ncurator-e2e-result.docx', { timeout: 10_000 })
      await app.page.waitForSelector('text=E2E fixture 已生成计划与文件产物。', {
        timeout: 10_000
      })

      assertions.push({ id: 'workbench-ai-run-started', pass: true })
      assertions.push({ id: 'workbench-timeline-rendered', pass: true })
      assertions.push({ id: 'workbench-artifact-rendered', pass: true })
    } catch (error) {
      runtimeError = error instanceof Error ? error : new Error(String(error))
      selectorFailures.push('workbench-chat-plan-artifact-flow')
      notes.push(runtimeError.message)
      assertions.push({
        id: 'workbench-chat-plan-artifact-flow',
        pass: false,
        details: runtimeError.message
      })
    }

    await finalizeElectronUiCase({
      app,
      suite: 'e2e-chat',
      caseId: 'workbench-chat-plan-artifact-rendering',
      startedAt,
      assertions,
      notes,
      userActionSequence,
      selectorFailures,
      executionStatus: runtimeError ? 'failed' : 'completed',
      executionResultCode: runtimeError ? 'runtime_exception' : 'ok',
      expectedOutcome: 'success',
      scenarioTags: ['e2e', 'chat', 'workbench', 'plan', 'artifact'],
      taskGoal
    })

    app = null

    if (runtimeError) {
      throw runtimeError
    }
  })

  it('submits an approval decision through the real Electron workbench flow', async () => {
    const startedAt = Date.now()
    const userActionSequence: string[] = []
    const selectorFailures: string[] = []
    const assertions: UiAssertion[] = []
    const notes: string[] = []
    const taskGoal =
      'Trigger an approval-required AI run from the workbench, approve it, and verify the run resumes through the real Electron chain.'
    let runtimeError: Error | null = null

    try {
      app = await launchElectronApp()
      await openWorkbenchPage(app.page, userActionSequence)
      await submitPrompt(app.page, '[e2e:chat-approval] 继续这个需要审批的请求', userActionSequence)

      await app.page.getByTestId(chatSelectors.approvalBanner).waitFor({
        timeout: 10_000
      })
      await app.page.getByTestId(chatSelectors.approvalApproveButton).click()
      userActionSequence.push('click:chat-approval-approve-button')

      await app.page.waitForSelector('text=审批通过，E2E fixture 已继续执行。', {
        timeout: 10_000
      })

      assertions.push({ id: 'workbench-approval-banner-rendered', pass: true })
      assertions.push({ id: 'workbench-approval-decision-invoked', pass: true })
      assertions.push({ id: 'workbench-approval-run-completed', pass: true })
    } catch (error) {
      runtimeError = error instanceof Error ? error : new Error(String(error))
      selectorFailures.push('workbench-chat-approval-flow')
      notes.push(runtimeError.message)
      assertions.push({
        id: 'workbench-chat-approval-flow',
        pass: false,
        details: runtimeError.message
      })
    }

    await finalizeElectronUiCase({
      app,
      suite: 'e2e-chat',
      caseId: 'workbench-chat-approval-required',
      startedAt,
      assertions,
      notes,
      userActionSequence,
      selectorFailures,
      executionStatus: runtimeError ? 'failed' : 'completed',
      executionResultCode: runtimeError ? 'runtime_exception' : 'ok',
      expectedOutcome: 'success',
      scenarioTags: ['e2e', 'chat', 'workbench', 'approval'],
      taskGoal
    })

    app = null

    if (runtimeError) {
      throw runtimeError
    }
  })

  it('restarts the request after a workspace-required interruption inside the workbench', async () => {
    const startedAt = Date.now()
    const userActionSequence: string[] = []
    const selectorFailures: string[] = []
    const assertions: UiAssertion[] = []
    const notes: string[] = []
    const taskGoal =
      'Trigger a workspace-required AI run, add a workbench scope, then continue the run and verify the deterministic fixture resumes.'
    let runtimeError: Error | null = null

    try {
      app = await launchElectronApp()
      await openWorkbenchPage(app.page, userActionSequence)
      await submitPrompt(app.page, '[e2e:chat-workspace] 需要工作区上下文', userActionSequence)

      await app.page.getByTestId(chatSelectors.workspaceBanner).waitFor({
        timeout: 10_000
      })
      await app.page.getByTestId(workbenchSelectors.sourceScopeField).locator('.ant-select-selector').click()
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

      assertions.push({ id: 'workbench-workspace-banner-rendered', pass: true })
      assertions.push({ id: 'workbench-workspace-scope-selected', pass: true })
      assertions.push({ id: 'workbench-workspace-run-restarted', pass: true })
    } catch (error) {
      runtimeError = error instanceof Error ? error : new Error(String(error))
      selectorFailures.push('workbench-chat-workspace-flow')
      notes.push(runtimeError.message)
      assertions.push({
        id: 'workbench-chat-workspace-flow',
        pass: false,
        details: runtimeError.message
      })
    }

    await finalizeElectronUiCase({
      app,
      suite: 'e2e-chat',
      caseId: 'workbench-chat-workspace-required',
      startedAt,
      assertions,
      notes,
      userActionSequence,
      selectorFailures,
      executionStatus: runtimeError ? 'failed' : 'completed',
      executionResultCode: runtimeError ? 'runtime_exception' : 'ok',
      expectedOutcome: 'success',
      scenarioTags: ['e2e', 'chat', 'workbench', 'workspace'],
      taskGoal
    })

    app = null

    if (runtimeError) {
      throw runtimeError
    }
  })
})
