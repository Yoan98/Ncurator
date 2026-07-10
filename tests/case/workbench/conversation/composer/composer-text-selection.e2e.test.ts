import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LONG_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  setWorkbenchInput,
  setupWorkbenchWorkspaceOnly,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'composer-text-selection'
const DRAFT_TEXT = '这是开头，中间这段需要被选中，后面还有文字。'
const SELECTED_TEXT = '中间这段'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['composer'],
        description: '输入框鼠标松开后应保留用户已经框选的文字，不应把光标强制移动到末尾。',
        fixtures: ['tests/fixtures/workspace'],
        launchMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWorkspaceOnly(page, {
            caseId: CASE_ID,
            workspaceName: 'Workbench Text Selection Workspace'
          })
          try {
            await setWorkbenchInput(page, DRAFT_TEXT)
            return await getWorkbenchLocator(page, workbenchSelectors.input).evaluate(
              (element, selectedText) => {
                if (!(element instanceof HTMLElement)) {
                  throw new Error('workbench input is not an HTMLElement')
                }

                const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
                let selectedNode: Text | null = null
                let selectedOffset = -1
                let current = walker.nextNode()
                while (current) {
                  if (current instanceof Text) {
                    const offset = current.data.indexOf(selectedText)
                    if (offset >= 0) {
                      selectedNode = current
                      selectedOffset = offset
                      break
                    }
                  }
                  current = walker.nextNode()
                }
                if (!selectedNode || selectedOffset < 0) {
                  throw new Error(`selected text not found: ${selectedText}`)
                }

                element.focus()
                const range = document.createRange()
                range.setStart(selectedNode, selectedOffset)
                range.setEnd(selectedNode, selectedOffset + selectedText.length)
                const selection = window.getSelection()
                selection?.removeAllRanges()
                selection?.addRange(range)
                element.dispatchEvent(
                  new MouseEvent('mouseup', {
                    bubbles: true,
                    cancelable: true,
                    view: window
                  })
                )

                const nextSelection = window.getSelection()
                return {
                  selectedText: nextSelection?.toString() || '',
                  isCollapsed: nextSelection?.isCollapsed ?? true,
                  anchorInsideEditor: Boolean(
                    nextSelection?.anchorNode && element.contains(nextSelection.anchorNode)
                  ),
                  focusInsideEditor: Boolean(
                    nextSelection?.focusNode && element.contains(nextSelection.focusNode)
                  )
                }
              },
              SELECTED_TEXT
            )
          } finally {
            await setup.workspace.cleanup()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.selectedText === SELECTED_TEXT &&
              !result.isCollapsed &&
              result.anchorInsideEditor &&
              result.focusInsideEditor,
            {
              name: 'workbench-composer-preserve-text-selection-after-mouseup',
              message: 'Composer 输入框应在 mouseup 后保留用户框选的文字。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LONG_E2E_TIMEOUT_MS
  )
})
