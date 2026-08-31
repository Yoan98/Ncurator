import { describe, it } from 'vitest'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { SETTINGS_LONG_E2E_TIMEOUT_MS } from '../../../../harness/e2e/settings'
import { workbenchSelectors as rendererSelectors } from '../../../../../src/renderer/src/testing/selectors'
import {
  getWorkbenchLocator,
  navigateToWorkbench,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const setUpdateSnapshot = async (
  page: import('playwright').Page,
  snapshot: Record<string, unknown>
): Promise<void> => {
  await page.evaluate((detail) => {
    window.dispatchEvent(
      new CustomEvent('ncurator-e2e-app-update-set-snapshot', {
        detail: JSON.stringify(detail)
      })
    )
  }, snapshot)
}

const markDatabaseAsNewerThanApplication = async (userDataDir: string): Promise<void> => {
  const database = new DatabaseSync(path.join(userDataDir, 'app.sqlite'))
  try {
    database.exec(`
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (11, 'future_schema', ${String(Date.now())});
    `)
  } finally {
    database.close()
  }
}

describe('sidebar app update e2e', () => {
  it(
    'sidebar-app-update',
    async () => {
      await runE2ECase({
        caseId: 'sidebar-app-update',
        domain: 'workbench',
        suite: 'conversation',
        groups: ['composer'],
        description: '左下角更新按钮展示新版本、下载进度和重启操作，设置页不再保留更新入口。',
        fixtures: ['app-update-fixture'],
        serviceMode: 'fixture',
        fixtureReason: '需要稳定控制更新可用、下载进度、下载完成和失败重试状态。',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToWorkbench(page, { waitForSessionListText: false })
          const updateButton = getWorkbenchLocator(page, workbenchSelectors.updateButton)
          const updateLabel = getWorkbenchLocator(page, workbenchSelectors.updateButtonLabel)

          const initiallyHidden = !(await updateButton.isVisible().catch(() => false))

          await setUpdateSnapshot(page, {
            status: 'idle',
            currentVersion: '0.1.0',
            isPackaged: true,
            updateSupported: true,
            platform: 'darwin'
          })
          const versionControl = getWorkbenchLocator(page, workbenchSelectors.appVersion)
          await versionControl.getByText('v0.1.0', { exact: true }).waitFor({ state: 'visible' })
          const visibleVersion = (await versionControl.textContent()) || ''

          await setUpdateSnapshot(page, {
            status: 'available',
            currentVersion: '0.1.0',
            availableVersion: '0.1.1',
            isPackaged: true,
            updateSupported: true,
            platform: 'darwin'
          })
          await updateLabel.getByText('更新', { exact: true }).waitFor({ state: 'visible' })
          const versionHiddenWhenUpdate = !(await versionControl.isVisible().catch(() => false))

          await updateButton.click()
          await updateLabel.getByText('更新 42%', { exact: true }).waitFor({ state: 'visible' })
          const progressLabel = (await updateLabel.textContent()) || ''

          const restartModal = page.getByRole('dialog', { name: '更新已准备好' })
          await restartModal.waitFor({ state: 'visible' })
          await page.getByTestId(workbenchSelectors.updateRestartLaterButton).click()
          await restartModal.waitFor({ state: 'hidden' })
          await updateLabel.getByText('重启更新', { exact: true }).waitFor({ state: 'visible' })
          await updateButton.click()

          await setUpdateSnapshot(page, {
            status: 'error',
            currentVersion: '0.1.0',
            availableVersion: '0.1.2',
            isPackaged: true,
            updateSupported: true,
            platform: 'darwin',
            error: 'download interrupted'
          })
          await updateLabel.getByText('重试', { exact: true }).waitFor({ state: 'visible' })
          const retryLabel = (await updateLabel.textContent()) || ''

          await page.goto(`${page.url().split('#')[0]}#/settings/app`)
          await page.waitForURL(/#\/settings\/model$/u)
          const settingsText = (await page.getByTestId('settings-page').textContent()) || ''
          const redirectedHash = await page.evaluate(() => window.location.hash)

          const normalModeSignals = await runtime.collectSignals()

          const restarted = await runtime.restartApp({
            prepareUserData: markDatabaseAsNewerThanApplication
          })
          const recoveryPage = restarted.page.getByTestId(rendererSelectors.updateRequiredPage)
          await recoveryPage.waitFor({ state: 'visible' })
          await recoveryPage.getByText('v11', { exact: true }).waitFor({ state: 'visible' })
          await recoveryPage.getByText('v10', { exact: true }).waitFor({ state: 'visible' })

          const primaryButton = restarted.page.getByTestId(
            rendererSelectors.updateRequiredPrimaryButton
          )
          await primaryButton.getByText('下载最新版', { exact: true }).waitFor({ state: 'visible' })
          const recoverySnapshot = await restarted.page.evaluate(() =>
            window.api.appUpdateGetSnapshot()
          )
          const autoCheckReachedAvailable = recoverySnapshot.status === 'available'
          const workbenchUnavailable =
            (await restarted.page.getByTestId(rendererSelectors.page).count()) === 0
          const manualDownloadUrl =
            (await restarted.page
              .getByTestId(rendererSelectors.updateRequiredManualDownload)
              .getAttribute('href')) || ''
          const quitVisible = await restarted.page
            .getByTestId(rendererSelectors.updateRequiredQuitButton)
            .isVisible()

          await primaryButton.click()
          const recoveryRestartModal = restarted.page.getByRole('dialog', {
            name: '更新已准备好'
          })
          await recoveryRestartModal.waitFor({ state: 'visible' })
          await restarted.page.getByTestId(rendererSelectors.updateRestartLaterButton).click()
          await primaryButton.getByText('重启并安装', { exact: true }).waitFor({ state: 'visible' })
          await primaryButton.click()

          await setUpdateSnapshot(restarted.page, {
            status: 'error',
            currentVersion: '0.1.0',
            isPackaged: true,
            updateSupported: true,
            platform: 'darwin',
            error: 'network unavailable'
          })
          await primaryButton.getByText('重试更新', { exact: true }).waitFor({ state: 'visible' })
          await primaryButton.click()
          await primaryButton.getByText('下载最新版', { exact: true }).waitFor({ state: 'visible' })
          const recoveryStillVisibleAfterFailure = await recoveryPage.isVisible()

          const signals = await runtime.collectSignals()
          return {
            initiallyHidden,
            visibleVersion,
            versionHiddenWhenUpdate,
            progressLabel,
            retryLabel,
            redirectedHash,
            settingsHasUpdateEntry: settingsText.includes('应用更新'),
            ipcCalls: normalModeSignals.ipcInvokeEntries.map((entry) => entry.name),
            recovery: {
              workbenchUnavailable,
              manualDownloadUrl,
              quitVisible,
              autoCheckReachedAvailable,
              recoveryStillVisibleAfterFailure,
              ipcCalls: signals.ipcInvokeEntries.map((entry) => entry.name)
            }
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(result.initiallyHidden, {
            name: 'idle-update-control-is-hidden',
            message: '没有新版本时不应占用左下角空间。'
          })
          await runtime.assertThat(
            result.visibleVersion === 'v0.1.0' && result.versionHiddenWhenUpdate,
            {
              name: 'current-version-is-visible-in-sidebar-footer',
              message: '左侧底部应在没有更新时显示版本，并在出现更新时让出同一位置。',
              data: {
                visibleVersion: result.visibleVersion,
                versionHiddenWhenUpdate: result.versionHiddenWhenUpdate
              }
            }
          )
          await runtime.assertThat(result.progressLabel === '更新 42%', {
            name: 'download-progress-is-visible',
            message: '用户点击更新后，按钮应持续显示下载进度。',
            data: { progressLabel: result.progressLabel }
          })
          await runtime.assertThat(result.retryLabel === '重试', {
            name: 'failed-download-can-retry',
            message: '下载失败后应保留重试入口。'
          })
          await runtime.assertThat(
            result.redirectedHash === '#/settings/model' && !result.settingsHasUpdateEntry,
            {
              name: 'legacy-update-settings-is-removed',
              message: '旧更新设置地址应回到大模型设置，并且侧栏不再显示应用更新。',
              data: {
                redirectedHash: result.redirectedHash,
                settingsHasUpdateEntry: result.settingsHasUpdateEntry
              }
            }
          )
          await runtime.assertThat(
            result.ipcCalls.includes('appUpdateDownload') &&
              result.ipcCalls.includes('appUpdateInstall'),
            {
              name: 'sidebar-actions-call-update-api',
              message: '下载和重启按钮必须调用对应桌面 API。',
              data: { ipcCalls: result.ipcCalls }
            }
          )
          await runtime.assertThat(
            result.recovery.workbenchUnavailable && result.recovery.quitVisible,
            {
              name: 'newer-database-starts-update-only-mode',
              message: '数据库版本过高时只能显示升级恢复页，不能加载工作台。',
              data: result.recovery
            }
          )
          await runtime.assertThat(
            result.recovery.manualDownloadUrl.startsWith('https://') &&
              result.recovery.recoveryStillVisibleAfterFailure,
            {
              name: 'recovery-page-keeps-safe-exits',
              message: '恢复页必须提供手动下载入口，并在更新失败后继续阻止业务访问。',
              data: result.recovery
            }
          )
          await runtime.assertThat(
            result.recovery.autoCheckReachedAvailable &&
              result.recovery.ipcCalls.filter((name) => name === 'appUpdateDownload').length >= 2 &&
              result.recovery.ipcCalls.includes('appUpdateInstall'),
            {
              name: 'recovery-page-controls-updater',
              message: '恢复页应自动检查更新，并支持下载和重启安装。',
              data: { ipcCalls: result.recovery.ipcCalls }
            }
          )
        }
      })
    },
    SETTINGS_LONG_E2E_TIMEOUT_MS
  )
})
