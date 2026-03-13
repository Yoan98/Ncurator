import { afterEach, describe, it } from 'vitest'
import { chatSelectors } from '../../../../src/renderer/src/testing/selectors'
import type { UiAssertion } from '../../../harness/e2e/reporter'
import { launchElectronApp, type LaunchedElectronApp } from '../../../harness/e2e/electronApp'
import { finalizeElectronUiCase } from '../../../harness/e2e/uiCase'
import { isAiLiveSuiteEnabled } from '../../../harness/e2e/live'

const CASE_METADATA = {
  description: '验证 non-blocking ai-live Chat 用例能观察审批阻塞并在批准后继续执行。',
  taskGoal: 'Observe an approval interruption in Chat, approve it, and confirm the run resumes.',
  scenarioTags: ['e2e', 'chat', 'ai-live', 'approval-recovery', 'non-blocking'],
  expectedOutcome: 'success',
  requiredFixtures: [],
  retentionTier: 'live-eval',
  lifecycle: 'active',
  runPolicy: 'non_gating',
  capabilityArea: 'chat-ui'
} as const

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

    await finalizeElectronUiCase({
      app,
      suite: 'e2e-chat-ai-live',
      caseId: 'chat-approval-recovery-live',
      caseMetadata: CASE_METADATA,
      startedAt,
      assertions,
      notes,
      userActionSequence,
      selectorFailures,
      executionStatus: runtimeError ? 'failed' : 'completed',
      executionResultCode: runtimeError ? 'runtime_exception' : 'ok',
      expectedOutcome: CASE_METADATA.expectedOutcome,
      scenarioTags: CASE_METADATA.scenarioTags,
      taskGoal: CASE_METADATA.taskGoal
    })

    app = null

    if (runtimeError) {
      throw runtimeError
    }
  })
})
