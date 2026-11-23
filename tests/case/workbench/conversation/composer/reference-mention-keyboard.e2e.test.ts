import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { addWorkspaceDirectoryThroughNativeDialog } from '../../../../harness/e2e/settings'
import {
  createEmptyE2EWorkspace,
  E2E_WORKSPACE_FIXTURE_ROOT
} from '../../../../harness/e2e/workspaceFixture'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  appendWorkbenchInputText,
  assertNoWorkbenchFakeSignals,
  createPartnerThroughWorkbenchUi,
  getWorkbenchLocator,
  navigateToWorkbench,
  pasteWorkbenchText,
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
        knowledge: 'cached',
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
              getComputedStyle(shape).fill === getComputedStyle(word).color &&
              Math.abs(word.getBoundingClientRect().width - 18) <= 0.05
            )
          })
          const neutralMentionLabels = await mentionPanel.evaluate((node) => {
            const labels = Array.from(node.querySelectorAll('button[data-reference-kind]')).map(
              (button) => button.children[1]
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
            .evaluate((icon) => Math.abs(icon.getBoundingClientRect().width - 16) <= 0.05)
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
                    Math.abs(
                      icon.getBoundingClientRect().width - (kind === 'directory' ? 16 : 18)
                    ) <= 0.05 &&
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
          const placeholder = input.locator('..').getByText(/^输入你想让.*做的事情或者@文件$/)
          await input.press('ControlOrMeta+a')
          await input.press('Backspace')
          await placeholder.waitFor({ state: 'visible' })
          const emptyHeight = await input.evaluate(
            (element) => element.getBoundingClientRect().height
          )
          await input.press('Shift+Enter')
          await input.press('Shift+Enter')
          const emptyLinesPreserved =
            (await input.textContent()) === '\n\n' && !(await placeholder.isVisible())
          await input.press('ArrowUp')
          await input.press('ArrowDown')
          await input.press('ControlOrMeta+a')
          await input.press('Backspace')
          await placeholder.waitFor({ state: 'visible' })
          const whitespaceInput = ' \n\t\u200b\ufeff'
          await appendWorkbenchInputText(page, whitespaceInput)
          const whitespacePreserved =
            (await input.textContent()) === whitespaceInput && !(await placeholder.isVisible())
          await input.press('ControlOrMeta+a')
          await input.press('Delete')
          await placeholder.waitFor({ state: 'visible' })
          const emptyAfterDeletion = await input.evaluate((element) => ({
            text: element.textContent,
            height: element.getBoundingClientRect().height,
            tokens: element.querySelectorAll('[data-role="scope-token"]').length
          }))
          const multilineInput = ' \n第一行\n第二行\n '
          await appendWorkbenchInputText(page, multilineInput)
          const manualNewlinePreserved =
            (await input.textContent()) === multilineInput && !(await placeholder.isVisible())
          await input.press('ControlOrMeta+a')
          await input.press('Delete')
          await placeholder.waitFor({ state: 'visible' })
          await input.press('ControlOrMeta+z')
          const undoPreservedText = (await input.textContent()) === multilineInput
          await input.press('ControlOrMeta+a')
          await input.press('Delete')
          await appendWorkbenchInputText(page, '待删除')
          await input.press('Backspace')
          await input.press('Backspace')
          await input.press('Backspace')
          await page.keyboard.press('Tab')
          await input.click()
          await placeholder.waitFor({ state: 'visible' })
          const referenceBoundaryDeletion: boolean[] = []
          for (const direction of ['forward', 'backward'] as const) {
            await appendWorkbenchInputText(page, '@sample-edit.docx')
            await waitForWorkbenchMentionPanelText(page)
            await mentionPanel.getByRole('button', { name: /sample-edit\.docx/ }).click()
            await mentionPanel.waitFor({ state: 'detached' })
            await input.evaluate((element, direction) => {
              if (!(element instanceof HTMLElement)) return
              element.focus()
              const range = document.createRange()
              range.selectNodeContents(element)
              range.collapse(direction === 'forward')
              const selection = window.getSelection()
              selection?.removeAllRanges()
              selection?.addRange(range)
            }, direction)
            const key = direction === 'forward' ? 'Delete' : 'Backspace'
            await input.press(key)
            await input.press(key)
            await placeholder.waitFor({ state: 'visible' })
            referenceBoundaryDeletion.push(
              (await input.textContent()) === '' &&
                (await input.locator('[data-role="scope-token"]').count()) === 0
            )
          }
          await runtime.captureScreenshot({
            name: 'composer-placeholder-restored',
            message: '删除实际内容后占位恢复；空格和手动换行保留输入并隐藏占位。'
          })
          await appendWorkbenchInputText(page, '已恢复')
          const typingAfterEmpty = (await input.textContent()) === '已恢复'
          await input.press('ControlOrMeta+a')
          await input.press('Backspace')
          const longText = Array.from({ length: 70 }, (_, index) => `第 ${index} 行输入验收`).join(
            '\n'
          )
          const readLongInput = async () =>
            input.evaluate((element, sendTestId) => {
              const rect = element.getBoundingClientRect()
              const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
              let tail: Text | undefined
              while (walker.nextNode())
                if (walker.currentNode.textContent) tail = walker.currentNode as Text
              const range = document.createRange()
              if (tail) {
                range.setStart(tail, tail.length - 1)
                range.setEnd(tail, tail.length)
              }
              const last = range.getBoundingClientRect()
              const send = document
                .querySelector(`[data-testid="${sendTestId}"]`)
                ?.getBoundingClientRect()
              return {
                height: rect.height,
                cap: Math.min(240, innerHeight * 0.3),
                scrollable: element.scrollHeight > element.clientHeight,
                tailVisible:
                  last.height > 0 && last.top >= rect.top && last.bottom <= rect.bottom + 1,
                toolbarVisible: !!send && send.top >= 0 && send.bottom <= innerHeight
              }
            }, workbenchSelectors.sendButton)
          await pasteWorkbenchText(page, longText)
          const longInput = [await readLongInput()]
          for (let index = 0; index < 20; index++) await input.press('Shift+Enter')
          await input.pressSequentially('尾部输入')
          longInput.push(await readLongInput())
          const longInputPreserved =
            (await input.textContent()) === `${longText}${'\n'.repeat(20)}尾部输入`
          await runtime.captureScreenshot({
            name: 'composer-long-input',
            message: '长正文粘贴、连续换行和继续输入后末行完整可见，底部工具栏保持可见。'
          })
          await input.press('ControlOrMeta+a')
          await input.press('Backspace')
          const restoredHeight = await input.evaluate(
            (element) => element.getBoundingClientRect().height
          )

          const { rootPath: rankingRoot } = await createEmptyE2EWorkspace(CASE_ID, 'workbench')
          const sameName = 'workbench-preview.md'
          for (const name of ['Reference-Match-Official', 'Reference-Match']) {
            const root = path.join(rankingRoot, name)
            await mkdir(root)
            await copyFile(
              path.join(E2E_WORKSPACE_FIXTURE_ROOT, sameName),
              path.join(root, sameName)
            )
            await addWorkspaceDirectoryThroughNativeDialog(page, root)
          }
          await navigateToWorkbench(page)
          await appendWorkbenchInputText(page, '@Reference')
          const selected = mentionPanel.locator('[data-mention-active="true"]')
          await selected.locator('mark').first().waitFor()
          const beforeQueryBounds = await mentionPanel.boundingBox()
          await input.pressSequentially('-Match')
          await selected
            .locator('[data-reference-path]')
            .filter({ hasText: /^Reference-Match\/$/u })
            .waitFor()
          const exactRootFirst = await selected.locator('[data-reference-path]').textContent()
          const updatedQueryBounds = await mentionPanel.boundingBox()
          expect(updatedQueryBounds?.y).toBeCloseTo(beforeQueryBounds!.y)
          expect(updatedQueryBounds?.height).toBeCloseTo(beforeQueryBounds!.height)
          const { accentBg, matchBg } = await selected.evaluate((row) => {
            const mark = row.querySelector('mark')
            const probe = document.createElement('span')
            row.append(probe)
            try {
              probe.style.backgroundColor = 'var(--notion-accent-selection)'
              const accentBg =
                getComputedStyle(probe).backgroundColor === getComputedStyle(row).backgroundColor
              probe.style.backgroundColor = 'var(--notion-accent-match)'
              return {
                accentBg,
                matchBg:
                  !!mark &&
                  getComputedStyle(probe).backgroundColor === getComputedStyle(mark).backgroundColor
              }
            } finally {
              probe.remove()
            }
          })
          expect(await selected.locator('mark').allTextContents()).toEqual(['Reference-Match'])
          expect(await selected.locator('[data-reference-path] mark').count()).toBe(0)
          await input.press('ArrowDown')
          expect(await selected.locator('[data-reference-path]').textContent()).toBe(
            'Reference-Match-Official/'
          )
          await input.press('ControlOrMeta+a')
          await input.press('Backspace')
          await appendWorkbenchInputText(page, `@${sameName}`)
          const exactGroup = mentionPanel.getByRole('group', {
            name: 'Reference-Match',
            exact: true
          })
          const sameFile = exactGroup.getByRole('button', { name: /workbench-preview\.md/u })
          const indexStatus = sameFile.locator('[data-reference-index-status]')
          await indexStatus.hover()
          await page.getByRole('tooltip').filter({ hasText: '未索引' }).waitFor()
          const sameFileDisplayPath = await sameFile.locator('[data-reference-path]').textContent()
          await sameFile.click()
          await mentionPanel.waitFor({ state: 'detached' })
          return {
            originalMentionIcons,
            originalTokenIcon,
            neutralMentionLabels,
            neutralToken,
            compactDirectoryIcon,
            tokenStableAfterTyping,
            emptyHeight,
            emptyAfterDeletion,
            emptyLinesPreserved,
            whitespacePreserved,
            referenceBoundaryDeletion,
            manualNewlinePreserved,
            undoPreservedText,
            typingAfterEmpty,
            longInput,
            longInputPreserved,
            restoredHeight,
            activeBeforeArrowDown,
            activeAfterArrowDown,
            activeAfterSettled,
            exactRootFirst,
            accentBg,
            matchBg,
            sameFileDisplayPath
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.exactRootFirst === 'Reference-Match/' &&
              result.accentBg &&
              result.matchBg &&
              result.sameFileDisplayPath === 'Reference-Match/workbench-preview.md',
            {
              name: 'workbench-reference-ranks-workspace-groups',
              message:
                '完全匹配的根地址优先，命中名称使用蓝色底，右侧路径以普通文本显示，跨组键盘选择和索引图标提示正确。',
              data: result
            }
          )
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
          await runtime.assertThat(
            result.emptyAfterDeletion.text === '' &&
              result.emptyAfterDeletion.tokens === 0 &&
              result.emptyAfterDeletion.height <= result.emptyHeight + 1 &&
              result.emptyLinesPreserved &&
              result.whitespacePreserved &&
              result.referenceBoundaryDeletion.every(Boolean) &&
              result.manualNewlinePreserved &&
              result.undoPreservedText &&
              result.typingAfterEmpty,
            {
              name: 'composer-empty-content-placeholder',
              message:
                '空格/换行保留输入并隐藏占位，删除到空后占位恢复；引用前后删除、原生撤销与继续输入正常。',
              data: result
            }
          )
          await runtime.assertThat(
            result.longInputPreserved &&
              result.restoredHeight <= result.emptyHeight + 1 &&
              result.longInput.every(
                (input) =>
                  input.height <= input.cap + 1 &&
                  input.scrollable &&
                  input.tailVisible &&
                  input.toolbarVisible
              ),
            {
              name: 'composer-long-input-caret-visible',
              message: '长文本和连续换行保持内容、末行与工具栏可见，清空后恢复紧凑高度。',
              data: {
                observations: result.longInput,
                preserved: result.longInputPreserved,
                restoredHeight: result.restoredHeight
              }
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_RESULT_E2E_TIMEOUT_MS
  )
})
