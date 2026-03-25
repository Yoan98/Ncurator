import { test } from 'vitest'
import { launchElectronApp } from '../../../harness/e2e/electronApp'

const dumpState = async (page: Awaited<ReturnType<typeof launchElectronApp>>['page'], label: string) => {
  const state = await page.evaluate(() => {
    const editor = document.querySelector('[data-testid="workbench-input"]')
    const selection = window.getSelection()
    const panel = document.querySelector('[data-testid="workbench-mention-panel"]')
    const active = document.activeElement
    const anchor = selection?.anchorNode || null

    return {
      activeTag: active?.tagName || null,
      activeTestId: active instanceof HTMLElement ? active.getAttribute('data-testid') : null,
      editorInnerHTML: editor instanceof HTMLElement ? editor.innerHTML : null,
      editorText: editor?.textContent || null,
      editorTextLength: editor?.textContent?.length || 0,
      editorChildNodes: editor?.childNodes.length || 0,
      editorChildren: editor
        ? Array.from(editor.childNodes).map((child) => ({
            nodeType: child.nodeType,
            nodeName: child.nodeName,
            textContent: child.textContent
          }))
        : [],
      editorCharCodes: editor?.textContent
        ? Array.from(editor.textContent).map((char) => char.charCodeAt(0))
        : [],
      panelExists: Boolean(panel),
      panelText: panel?.textContent || null,
      selection: selection
        ? {
            rangeCount: selection.rangeCount,
            isCollapsed: selection.isCollapsed,
            anchorNodeType: anchor?.nodeType || null,
            anchorNodeName: anchor?.nodeName || null,
            anchorText: anchor?.nodeType === Node.TEXT_NODE ? anchor.textContent : null,
            anchorOffset: selection.anchorOffset
          }
        : null
    }
  })
  console.log(label, JSON.stringify(state))
}

test('debug-workbench-composer-input', async () => {
  const app = await launchElectronApp()
  try {
    const { page } = app

    const workspaceName = 'E2E 未准备工作区'
    const createResponse = await page.evaluate(async (name) => {
      return window.api.workspaceCreate({
        rootPath: '/tmp/ncurator-e2e-unprepared-workspace',
        name
      })
    }, workspaceName)
    console.log('createResponse', JSON.stringify(createResponse))

    await page.evaluate(() => {
      window.location.hash = '#/'
    })
    await page.waitForSelector('[data-testid="workbench-page"]')

    const workspaceSelect = page.getByTestId('workbench-workspace-select')
    await workspaceSelect.locator('.ant-select-selector').click()
    await page.locator('.ant-select-dropdown').getByText(workspaceName).first().click()
    await page.waitForTimeout(120)

    const editor = page.getByTestId('workbench-input')
    await editor.click()
    await editor.focus()
    await page.waitForFunction(() => {
      const editorElement = document.querySelector('[data-testid="workbench-input"]')
      if (!(editorElement instanceof HTMLElement)) return false
      const selection = window.getSelection()
      return (
        document.activeElement === editorElement &&
        Boolean(selection?.anchorNode) &&
        editorElement.contains(selection.anchorNode)
      )
    })

    await page.evaluate(() => {
      const editor = document.querySelector('[data-testid="workbench-input"]')
      if (!(editor instanceof HTMLElement)) return
      ;(window as Window & { __composerEvents?: unknown[] }).__composerEvents = []
      const eventNames = ['focus', 'keydown', 'beforeinput', 'input', 'keyup']
      eventNames.forEach((eventName) => {
        editor.addEventListener(eventName, (event) => {
          const selection = window.getSelection()
          const anchor = selection?.anchorNode || null
          ;(window as Window & { __composerEvents?: unknown[] }).__composerEvents?.push({
            type: event.type,
            key: event instanceof KeyboardEvent ? event.key : null,
            inputType: event instanceof InputEvent ? event.inputType : null,
            data: event instanceof InputEvent ? event.data : null,
            editorText: editor.textContent,
            editorChildNodes: editor.childNodes.length,
            selection: selection
              ? {
                  rangeCount: selection.rangeCount,
                  anchorNodeName: anchor?.nodeName || null,
                  anchorNodeType: anchor?.nodeType || null,
                  anchorOffset: selection.anchorOffset
                }
              : null
          })
        })
      })
    })

    await dumpState(page, 'before')

    for (const ch of ['@', 'd', 'o', 'c', 's']) {
      await page.keyboard.type(ch)
      await page.waitForTimeout(120)
      await dumpState(page, `after-${ch}`)
    }

    const events = await page.evaluate(() => {
      return (window as Window & { __composerEvents?: unknown[] }).__composerEvents || []
    })
    console.log('events', JSON.stringify(events))
  } finally {
    await app.close({
      tracePath: '/tmp/workbench-composer-input-debug-trace.zip'
    })
  }
})
