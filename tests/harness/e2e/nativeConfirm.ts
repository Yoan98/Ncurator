import type { Locator, Page } from 'playwright'
import type { E2ETestRuntime } from './run-e2e-case'

export const nativeConfirmationCoversOwner = (
  popup: Electron.Rectangle,
  owner: Electron.Rectangle | null
): boolean => {
  if (!owner) return false
  const outwardEdges = [
    owner.x - popup.x,
    owner.y - popup.y,
    popup.x + popup.width - owner.x - owner.width,
    popup.y + popup.height - owner.y - owner.height
  ]
  // Windows rounds native bounds at fractional DPI; the popup must still cover every edge.
  return outwardEdges.every((edge) => edge >= 0 && edge <= 2)
}

export const openNativeConfirmation = async (
  runtime: E2ETestRuntime,
  trigger: Locator,
  title: string
): Promise<Page> => {
  const opened = runtime.electronApp.waitForEvent('window', { timeout: 10_000 })
  await trigger.click()
  const popup = await opened
  await popup.getByRole('dialog', { name: title, exact: true }).waitFor({ state: 'visible' })
  await popup.waitForFunction(() => document.visibilityState === 'visible')
  return popup
}

export const dismissNativeConfirmation = async (
  popup: Page,
  action: 'confirm' | 'cancel' | 'close' | 'escape' | 'mask',
  confirmText: string
): Promise<void> => {
  const closed = popup.waitForEvent('close', { timeout: 10_000 })
  try {
    if (action === 'escape') await popup.keyboard.press('Escape')
    else if (action === 'mask') await popup.locator('#mask').click({ position: { x: 8, y: 8 } })
    else {
      const name = action === 'confirm' ? confirmText : action === 'close' ? '关闭' : '取消'
      await popup.getByRole('button', { name, exact: true }).click()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/Target page, context or browser has been closed/u.test(message)) throw error
  }
  await closed
}
