import type { E2ETestRuntime } from './run-e2e-case'

/** Use the real platform copy shortcut and clipboard; never manufacture copy output. */
export async function copyDocumentSelection(runtime: E2ETestRuntime): Promise<string> {
  await runtime.electronApp.evaluate(({ clipboard }) => clipboard.clear())
  await runtime.page.keyboard.press('ControlOrMeta+c')
  await runtime.page.waitForTimeout(100)
  return runtime.electronApp.evaluate(({ clipboard }) => clipboard.readText())
}
