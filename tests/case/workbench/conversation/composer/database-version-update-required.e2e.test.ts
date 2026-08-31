import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'vitest'
import { OFFICIAL_DOWNLOAD_PAGE_URL } from '../../../../../src/shared/constants'
import { workbenchSelectors as rendererSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { SETTINGS_LONG_E2E_TIMEOUT_MS } from '../../../../harness/e2e/settings'
import { navigateToWorkbench } from '../../../../harness/e2e/workbench'

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

describe('database version update required e2e', () => {
  it(
    'database-version-update-required',
    async () => {
      await runE2ECase({
        caseId: 'database-version-update-required',
        domain: 'workbench',
        suite: 'conversation',
        groups: ['composer'],
        description: '数据库版本过高时只显示升级恢复页，并提供完整更新和官网恢复路径。',
        fixtures: ['future-database-version', 'app-update-fixture'],
        serviceMode: 'fixture',
        fixtureReason: '需要制造未来数据库版本并稳定控制更新下载、完成和失败状态。',
        runMode: 'single',
        execute: async (runtime) => {
          await navigateToWorkbench(runtime.page, { waitForSessionListText: false })
          const restarted = await runtime.restartApp({
            prepareUserData: markDatabaseAsNewerThanApplication
          })
          const page = restarted.page
          const recoveryPage = page.getByTestId(rendererSelectors.updateRequiredPage)
          await recoveryPage.waitFor({ state: 'visible' })

          const primaryButton = page.getByTestId(rendererSelectors.updateRequiredPrimaryButton)
          await primaryButton.getByText('下载最新版', { exact: true }).waitFor({ state: 'visible' })
          const recoverySnapshot = await page.evaluate(() => window.api.appUpdateGetSnapshot())
          const downloadPageUrl =
            (await page
              .getByTestId(rendererSelectors.updateRequiredDownloadPage)
              .getAttribute('href')) || ''
          await page.getByTestId(rendererSelectors.updateRequiredDownloadPage).click()

          await primaryButton.click()
          const restartModal = page.getByRole('dialog', { name: '更新已准备好' })
          await restartModal.waitFor({ state: 'visible' })
          await page.getByTestId(rendererSelectors.updateRestartLaterButton).click()
          await primaryButton.getByText('重启并安装', { exact: true }).waitFor({ state: 'visible' })
          await primaryButton.click()

          await setUpdateSnapshot(page, {
            status: 'not-available',
            currentVersion: '0.1.0',
            isPackaged: true,
            updateSupported: true,
            platform: 'darwin'
          })
          await primaryButton.getByText('重新检查', { exact: true }).waitFor({ state: 'visible' })
          const unavailableMessage =
            (await recoveryPage.getByRole('alert').textContent())?.trim() || ''

          await setUpdateSnapshot(page, {
            status: 'error',
            currentVersion: '0.1.0',
            isPackaged: true,
            updateSupported: true,
            platform: 'darwin',
            error: 'network unavailable'
          })
          await primaryButton.getByText('重试', { exact: true }).waitFor({ state: 'visible' })
          const userFacingError =
            (await recoveryPage.getByRole('alert').textContent())?.trim() || ''
          const rawErrorVisible = await recoveryPage
            .getByText('network unavailable', { exact: true })
            .isVisible()
            .catch(() => false)
          const recoveryStillVisibleAfterFailure = await recoveryPage.isVisible()
          await primaryButton.click()
          await primaryButton.getByText('下载最新版', { exact: true }).waitFor({ state: 'visible' })

          const signals = await runtime.collectSignals()
          return {
            title: (await recoveryPage.getByRole('heading', { level: 1 }).textContent()) || '',
            bodyText: (await recoveryPage.textContent()) || '',
            versionsVisible:
              (await recoveryPage.getByText('v11', { exact: true }).isVisible()) &&
              (await recoveryPage.getByText('v10', { exact: true }).isVisible()),
            workbenchUnavailable: (await page.getByTestId(rendererSelectors.page).count()) === 0,
            quitVisible: await page
              .getByTestId(rendererSelectors.updateRequiredQuitButton)
              .isVisible(),
            downloadPageUrl,
            autoCheckReachedAvailable: recoverySnapshot.status === 'available',
            userFacingError,
            unavailableMessage,
            rawErrorVisible,
            recoveryStillVisibleAfterFailure,
            openedOfficialDownloadPage: signals.ipcInvokeEntries.some(
              (entry) =>
                entry.name === 'openExternal' && entry.payload === OFFICIAL_DOWNLOAD_PAGE_URL
            ),
            ipcCalls: signals.ipcInvokeEntries.map((entry) => entry.name)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.workbenchUnavailable && result.quitVisible && result.versionsVisible,
            {
              name: 'newer-database-starts-update-only-mode',
              message: '数据库版本过高时只能显示包含版本信息的升级恢复页。',
              data: result
            }
          )
          await runtime.assertThat(
            result.title.trim() === '需要升级馆长' &&
              result.bodyText.includes('本机数据库版本') &&
              result.bodyText.includes('继续使用可能导致您的本地数据丢失'),
            {
              name: 'recovery-page-explains-database-mismatch',
              message: '恢复页应使用明确、完整的数据库版本不匹配说明。'
            }
          )
          await runtime.assertThat(
            result.downloadPageUrl === OFFICIAL_DOWNLOAD_PAGE_URL &&
              result.bodyText.includes('前往官网下载') &&
              result.openedOfficialDownloadPage,
            {
              name: 'recovery-page-links-to-official-download-page',
              message: '备用下载入口应打开包含平台选择的官网中文下载页。',
              data: { downloadPageUrl: result.downloadPageUrl }
            }
          )
          await runtime.assertThat(
            result.unavailableMessage === '当前更新通道未发现可用版本，请前往官网下载最新版。',
            {
              name: 'recovery-page-handles-no-update-available',
              message: '更新通道没有可用版本时应继续阻断业务并引导用户前往官网。',
              data: { unavailableMessage: result.unavailableMessage }
            }
          )
          await runtime.assertThat(
            result.userFacingError === '暂时无法检查更新，请检查网络后重试。' &&
              !result.rawErrorVisible &&
              result.recoveryStillVisibleAfterFailure,
            {
              name: 'recovery-page-normalizes-update-errors',
              message: '更新失败应显示中文用户提示、隐藏底层错误，并继续阻止业务访问。',
              data: {
                userFacingError: result.userFacingError,
                rawErrorVisible: result.rawErrorVisible
              }
            }
          )
          await runtime.assertThat(
            result.autoCheckReachedAvailable &&
              result.ipcCalls.includes('appUpdateCheck') &&
              result.ipcCalls.includes('appUpdateDownload') &&
              result.ipcCalls.includes('appUpdateInstall'),
            {
              name: 'recovery-page-controls-updater',
              message: '恢复页应自动检查更新，并支持下载、失败重试和重启安装。',
              data: { ipcCalls: result.ipcCalls }
            }
          )
        }
      })
    },
    SETTINGS_LONG_E2E_TIMEOUT_MS
  )
})
