import { afterEach, describe, it } from 'vitest'
import { workbenchSelectors } from '../../../../src/renderer/src/testing/selectors'
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

describe('chat.review-flow.e2e', () => {
  let app: LaunchedElectronApp | null = null

  afterEach(async () => {
    if (app) {
      await app.electronApp.close()
      app = null
    }
  })

  it('enters unified review after AI editing and commits only after per-change decisions', async () => {
    const startedAt = Date.now()
    const userActionSequence: string[] = []
    const selectorFailures: string[] = []
    const assertions: UiAssertion[] = []
    const notes: string[] = []
    const taskGoal =
      'Trigger an AI edit run, wait for unified draft review, accept and reject individual changes, then submit the accepted changes through the real Electron chain.'
    let runtimeError: Error | null = null

    try {
      app = await launchElectronApp()
      await openWorkbenchPage(app.page, userActionSequence)
      await submitPrompt(app.page, '[e2e:chat-edit-review] 生成待审阅草稿', userActionSequence)

      await app.page.getByTestId(workbenchSelectors.reviewCenter).waitFor({
        timeout: 10_000
      })
      await app.page.waitForFunction(
        (prefix) =>
          document.querySelectorAll(`[data-testid^="${String(prefix)}-"]`).length >= 2,
        workbenchSelectors.reviewChangePrefix,
        { timeout: 10_000 }
      )

      const acceptButtons = app.page.locator(
        `[data-testid^="${workbenchSelectors.reviewChangeAcceptPrefix}-"]`
      )
      const rejectButtons = app.page.locator(
        `[data-testid^="${workbenchSelectors.reviewChangeRejectPrefix}-"]`
      )
      await acceptButtons.first().click()
      userActionSequence.push('click:review-accept-first-change')
      await rejectButtons.nth(1).click()
      userActionSequence.push('click:review-reject-second-change')

      await app.page.waitForFunction(
        (selector) => {
          const node = document.querySelector(`[data-testid="${String(selector)}"]`)
          return node?.getAttribute('data-ready') === 'true'
        },
        workbenchSelectors.reviewValidation,
        { timeout: 10_000 }
      )
      await app.page.getByTestId(workbenchSelectors.reviewCommitButton).click()
      userActionSequence.push('click:review-commit-button')

      await app.page.getByTestId(workbenchSelectors.reviewCommitResults).waitFor({
        timeout: 10_000
      })
      await app.page.waitForSelector('text=状态：completed', { timeout: 10_000 })

      assertions.push({ id: 'workbench-review-entered-after-run', pass: true })
      assertions.push({ id: 'workbench-review-per-change-decisions-made', pass: true })
      assertions.push({ id: 'workbench-review-commit-completed', pass: true })
    } catch (error) {
      runtimeError = error instanceof Error ? error : new Error(String(error))
      selectorFailures.push('workbench-chat-review-commit-flow')
      notes.push(runtimeError.message)
      assertions.push({
        id: 'workbench-chat-review-commit-flow',
        pass: false,
        details: runtimeError.message
      })
    }

    await finalizeElectronUiCase({
      app,
      suite: 'e2e-chat',
      caseId: 'workbench-chat-review-commit-flow',
      startedAt,
      assertions,
      notes,
      userActionSequence,
      selectorFailures,
      executionStatus: runtimeError ? 'failed' : 'completed',
      executionResultCode: runtimeError ? 'runtime_exception' : 'ok',
      expectedOutcome: 'success',
      scenarioTags: ['e2e', 'chat', 'workbench', 'draft-review', 'partial-commit'],
      taskGoal
    })

    app = null

    if (runtimeError) {
      throw runtimeError
    }
  })

  it('shows deterministic conflict feedback when the source changes before commit', async () => {
    const startedAt = Date.now()
    const userActionSequence: string[] = []
    const selectorFailures: string[] = []
    const assertions: UiAssertion[] = []
    const notes: string[] = []
    const taskGoal =
      'Trigger an AI edit run whose source changes before commit, and verify the unified review center surfaces the source-changed conflict deterministically.'
    let runtimeError: Error | null = null

    try {
      app = await launchElectronApp()
      await openWorkbenchPage(app.page, userActionSequence)
      await submitPrompt(app.page, '[e2e:chat-review-conflict] 生成冲突草稿', userActionSequence)

      await app.page.getByTestId(workbenchSelectors.reviewCenter).waitFor({
        timeout: 10_000
      })
      await app.page.getByTestId(workbenchSelectors.reviewAcceptAllButton).click()
      userActionSequence.push('click:review-accept-all-button')

      await app.page.getByTestId(workbenchSelectors.reviewConflict).waitFor({
        timeout: 10_000
      })
      await app.page.waitForFunction(
        (selector) => {
          const node = document.querySelector(`[data-testid="${String(selector)}"]`) as
            | HTMLButtonElement
            | null
          return Boolean(node?.disabled)
        },
        workbenchSelectors.reviewCommitButton,
        { timeout: 10_000 }
      )

      assertions.push({ id: 'workbench-review-conflict-rendered', pass: true })
      assertions.push({ id: 'workbench-review-conflict-blocked-commit', pass: true })
    } catch (error) {
      runtimeError = error instanceof Error ? error : new Error(String(error))
      selectorFailures.push('workbench-chat-review-conflict-flow')
      notes.push(runtimeError.message)
      assertions.push({
        id: 'workbench-chat-review-conflict-flow',
        pass: false,
        details: runtimeError.message
      })
    }

    await finalizeElectronUiCase({
      app,
      suite: 'e2e-chat',
      caseId: 'workbench-chat-review-conflict-flow',
      startedAt,
      assertions,
      notes,
      userActionSequence,
      selectorFailures,
      executionStatus: runtimeError ? 'failed' : 'completed',
      executionResultCode: runtimeError ? 'runtime_exception' : 'ok',
      expectedOutcome: 'success',
      scenarioTags: ['e2e', 'chat', 'workbench', 'draft-review', 'conflict'],
      taskGoal
    })

    app = null

    if (runtimeError) {
      throw runtimeError
    }
  })
})
