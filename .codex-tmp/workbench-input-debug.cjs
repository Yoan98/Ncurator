const { _electron: electron } = require('playwright')
const electronPath = require('electron')

const dumpState = async (page, label) => {
  const state = await page.evaluate(() => {
    const editor = document.querySelector('[data-testid="workbench-input"]')
    const selection = window.getSelection()
    const panel = document.querySelector('[data-testid="workbench-mention-panel"]')
    const active = document.activeElement
    const anchor = selection ? selection.anchorNode : null
    return {
      activeTag: active ? active.tagName : null,
      activeTestId: active instanceof HTMLElement ? active.getAttribute('data-testid') : null,
      editorInnerHTML: editor instanceof HTMLElement ? editor.innerHTML : null,
      editorText: editor ? editor.textContent : null,
      panelExists: Boolean(panel),
      panelText: panel ? panel.textContent : null,
      selection: selection
        ? {
            rangeCount: selection.rangeCount,
            isCollapsed: selection.isCollapsed,
            anchorNodeType: anchor ? anchor.nodeType : null,
            anchorNodeName: anchor ? anchor.nodeName : null,
            anchorText: anchor && anchor.nodeType === Node.TEXT_NODE ? anchor.textContent : null,
            anchorOffset: selection.anchorOffset
          }
        : null
    }
  })
  console.log(label, JSON.stringify(state))
}

;(async () => {
  const app = await electron.launch({
    executablePath: electronPath,
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, NCURATOR_E2E_MODE: '1' }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => Boolean(window.api))

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
    if (!(editorElement instanceof HTMLDivElement)) return false
    const selection = window.getSelection()
    return (
      document.activeElement === editorElement &&
      Boolean(selection?.anchorNode) &&
      editorElement.contains(selection.anchorNode)
    )
  })

  await dumpState(page, 'before')

  for (const ch of ['@', 'd', 'o', 'c', 's']) {
    await page.keyboard.type(ch)
    await page.waitForTimeout(150)
    await dumpState(page, `after-${ch}`)
  }

  await page.waitForTimeout(500)
  await dumpState(page, 'final')
  await app.close()
})().catch(async (error) => {
  console.error(error)
  process.exitCode = 1
})
