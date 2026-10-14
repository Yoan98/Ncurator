import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  appendWorkbenchInputText,
  assertNoWorkbenchFakeSignals,
  createPartnerThroughWorkbenchUi,
  getWorkbenchLocator,
  setupWorkbenchWorkspaceOnly,
  waitForWorkbenchMentionPanelText,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'reference-mention-keyboard'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['composer'],
        description: '@ 候选列表用下键移动时，选中项应停在下一项，不应被刷新回第一项。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await setupWorkbenchWorkspaceOnly(page, {
            caseId: CASE_ID,
            workspaceName: 'Workbench Mention Keyboard Workspace'
          })
          await createPartnerThroughWorkbenchUi(page, 'Workbench Mention Keyboard Workspace')
          await appendWorkbenchInputText(page, '@')
          const mentionPanel = getWorkbenchLocator(page, workbenchSelectors.mentionPanel)
          await waitForWorkbenchMentionPanelText(page)

          const readActiveMentionText = async (): Promise<string> => {
            const activeMention = mentionPanel.locator('[data-mention-active="true"]').first()
            await activeMention.waitFor({ state: 'visible' })
            return ((await activeMention.textContent()) || '').trim()
          }

          const originalMentionIcons = await mentionPanel.evaluate((node) => {
            const word = node.querySelector('[data-reference-icon-kind="docx"] svg')
            const shape = word?.querySelector('path')
            return (
              word?.querySelector('text')?.textContent === 'DOC' &&
              !!shape &&
              getComputedStyle(shape).fill === 'rgb(59, 130, 246)' &&
              word.getBoundingClientRect().width === 18
            )
          })
          const neutralMentionLabels = await mentionPanel.evaluate((node) => {
            const labels = Array.from(node.querySelectorAll('button[data-reference-kind]')).map(
              (button) => button.children[1]?.firstElementChild
            )
            return (
              labels.length > 1 &&
              labels.every((label) => label && getComputedStyle(label).color === 'rgb(55, 53, 47)')
            )
          })
          const activeBeforeArrowDown = await readActiveMentionText()
          await page.keyboard.press('ArrowDown')
          await page.waitForFunction(
            (input: { testId: string; previousText: string }) => {
              const panel = document.querySelector(`[data-testid="${input.testId}"]`)
              const active = panel?.querySelector('[data-mention-active="true"]')
              const activeText = active?.textContent?.trim() || ''
              return activeText.length > 0 && activeText !== input.previousText
            },
            {
              testId: workbenchSelectors.mentionPanel,
              previousText: activeBeforeArrowDown
            }
          )
          const activeAfterArrowDown = await readActiveMentionText()
          await page.waitForTimeout(200)
          const activeAfterSettled = await readActiveMentionText()

          await page.keyboard.press('Enter')
          const input = getWorkbenchLocator(page, workbenchSelectors.input)
          const originalTokenIcon = await input
            .locator('[data-reference-icon-kind] svg')
            .evaluateAll(
              (icons) =>
                icons.length > 0 &&
                icons.every(
                  (icon) =>
                    ['0 0 18 18', '0 0 24 24', '0 0 256 256'].includes(icon.getAttribute('viewBox') || '') &&
                    icon.getBoundingClientRect().width === 18
                )
            )
          const neutralToken = await input
            .locator('[data-role="scope-token"]')
            .evaluate((token) => {
              const style = getComputedStyle(token)
              return (
                style.color === 'rgb(55, 53, 47)' && style.backgroundColor === 'rgba(0, 0, 0, 0)'
              )
            })
          await runtime.captureScreenshot({
            name: 'composer-reference-icons',
            message: '引用名称统一正文色、无灰底，图标与候选同为 18px，键盘插入保持稳定。'
          })
          return {
            originalMentionIcons,
            originalTokenIcon,
            neutralMentionLabels,
            neutralToken,
            activeBeforeArrowDown,
            activeAfterArrowDown,
            activeAfterSettled
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.originalMentionIcons &&
              result.originalTokenIcon &&
              result.neutralMentionLabels &&
              result.neutralToken &&
              result.activeBeforeArrowDown.length > 0 &&
              result.activeAfterArrowDown.length > 0 &&
              result.activeAfterArrowDown !== result.activeBeforeArrowDown &&
              result.activeAfterSettled === result.activeAfterArrowDown,
            {
              name: 'workbench-reference-mention-keyboard-active-index',
              message: '@ 候选列表按下键后，高亮项应移动到下一项，并在短暂停留后保持不变。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_RESULT_E2E_TIMEOUT_MS
  )
})
