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
          const mentionIconShapes = await mentionPanel
            .locator('[data-reference-icon-kind]')
            .evaluateAll((icons) =>
              Object.fromEntries(
                icons.map((icon) => [
                  icon.getAttribute('data-reference-icon-kind'),
                  icon.querySelector('svg')?.innerHTML
                ])
              )
            )
          const compactDirectoryIcon = await mentionPanel
            .locator('[data-reference-icon-kind="directory"] svg')
            .first()
            .evaluate((icon) => icon.getBoundingClientRect().width === 16)
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
              (icons, shapes) =>
                icons.length > 0 &&
                icons.every((icon) => {
                  const kind =
                    icon
                      .closest('[data-reference-icon-kind]')
                      ?.getAttribute('data-reference-icon-kind') || ''
                  return (
                    ['0 0 16 16', '0 0 18 18', '0 0 24 24', '0 0 256 256'].includes(
                      icon.getAttribute('viewBox') || ''
                    ) &&
                    icon.getBoundingClientRect().width === (kind === 'directory' ? 16 : 18) &&
                    icon.innerHTML === shapes[kind]
                  )
                }),
              mentionIconShapes
            )
          const neutralToken = await input
            .locator('[data-role="scope-token"]')
            .evaluate((token) => {
              const style = getComputedStyle(token)
              return (
                style.color === 'rgb(55, 53, 47)' && style.backgroundColor === 'rgba(0, 0, 0, 0)'
              )
            })
          const tokenBeforeTyping = await input.locator('[data-role="scope-token"]').innerHTML()
          await appendWorkbenchInputText(page, '继续输入')
          const tokenStableAfterTyping =
            (await input.locator('[data-role="scope-token"]').innerHTML()) === tokenBeforeTyping &&
            (await input.textContent())?.endsWith('继续输入')
          await runtime.captureScreenshot({
            name: 'composer-reference-icons',
            message:
              '目录图标为 16px、其他类型为 18px；候选与输入图形一致，后续输入保留引用与文字。'
          })
          return {
            originalMentionIcons,
            originalTokenIcon,
            neutralMentionLabels,
            neutralToken,
            compactDirectoryIcon,
            tokenStableAfterTyping,
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
              result.compactDirectoryIcon &&
              result.tokenStableAfterTyping &&
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
