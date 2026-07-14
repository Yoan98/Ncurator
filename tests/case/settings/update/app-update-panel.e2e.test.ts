import { describe, it } from 'vitest'
import { settingsSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../../harness/e2e/settings'

describe('settings app update e2e', () => {
  it(
    'app-update-panel',
    async () => {
      await runE2ECase({
        caseId: 'app-update-panel',
        domain: 'settings',
        suite: 'update',
        description: '应用更新页展示检查、下载、安装和错误状态，并调用对应 IPC。',
        fixtures: ['app-update-fixture'],
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const status = getSettingsLocator(page, settingsSelectors.appUpdateStatus)
          const checkButton = getSettingsLocator(page, settingsSelectors.appUpdateCheckButton)
          const installButton = getSettingsLocator(page, settingsSelectors.appUpdateInstallButton)

          await runtime.step({
            name: 'open-app-update-settings',
            message: '进入应用更新设置页并读取初始版本。',
            run: async () => {
              await navigateToSettingsSection(page, 'app')
              await status.getByText('可以手动检查是否有新版本').waitFor({ state: 'visible' })
            }
          })

          const initialState = {
            currentVersion: await getSettingsLocator(
              page,
              settingsSelectors.appUpdateCurrentVersion
            ).textContent(),
            checkDisabled: await checkButton.isDisabled(),
            installDisabled: await installButton.isDisabled()
          }

          const observedStatuses: string[] = []
          await runtime.step({
            name: 'check-and-download-update',
            message: '点击检查更新并观察完整的模拟下载状态变化。',
            run: async () => {
              await checkButton.click()
              const expectedStatuses = [
                '正在检查最新版本',
                '已发现新版本，正在准备下载',
                '正在下载更新包',
                '更新已下载，重启后完成安装'
              ]
              for (const expectedStatus of expectedStatuses) {
                await status.getByText(expectedStatus).waitFor({ state: 'visible' })
                observedStatuses.push(expectedStatus)
              }
            }
          })

          const downloadedState = {
            availableVersion: await getSettingsLocator(
              page,
              settingsSelectors.appUpdateAvailableVersion
            ).textContent(),
            progressPercent: await getSettingsLocator(page, settingsSelectors.appUpdateProgress)
              .getByRole('progressbar')
              .getAttribute('aria-valuenow'),
            installDisabled: await installButton.isDisabled()
          }

          await runtime.step({
            name: 'request-update-install',
            message: '点击重启安装并记录安装 IPC。',
            run: async () => {
              await installButton.click()
              await page.waitForTimeout(100)
            }
          })

          await runtime.step({
            name: 'show-update-error',
            message: '注入更新失败状态，确认页面展示具体错误。',
            run: async () => {
              await page.evaluate(() => {
                window.dispatchEvent(
                  new CustomEvent('ncurator-e2e-app-update-set-snapshot', {
                    detail: JSON.stringify({
                      status: 'error',
                      currentVersion: '0.1.0',
                      isPackaged: true,
                      updateSupported: true,
                      platform: 'darwin',
                      error: 'network unavailable'
                    })
                  })
                )
              })
              await status.getByText('network unavailable').waitFor({ state: 'visible' })
            }
          })
          const errorText = await status.textContent()

          await runtime.step({
            name: 'show-unsigned-macos-reason',
            message: '注入未签名 macOS 状态，确认页面阻止无效的自动更新。',
            run: async () => {
              await page.evaluate(() => {
                window.dispatchEvent(
                  new CustomEvent('ncurator-e2e-app-update-set-snapshot', {
                    detail: JSON.stringify({
                      status: 'idle',
                      currentVersion: '0.1.1',
                      isPackaged: true,
                      updateSupported: false,
                      unsupportedReason: 'macOS 自动更新需要有效的 Developer ID 签名',
                      platform: 'darwin'
                    })
                  })
                )
              })
              await status
                .getByText('macOS 自动更新需要有效的 Developer ID 签名')
                .waitFor({ state: 'visible' })
            }
          })

          const signals = await runtime.collectSignals()
          return {
            initialState,
            observedStatuses,
            downloadedState,
            errorText,
            unsignedMacState: {
              statusText: await status.textContent(),
              checkDisabled: await checkButton.isDisabled()
            },
            ipcCalls: signals.ipcInvokeEntries.map((entry) => entry.name)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.initialState.currentVersion === '0.1.0' &&
              !result.initialState.checkDisabled &&
              result.initialState.installDisabled,
            {
              name: 'initial-update-state-is-actionable',
              message: '初始页面应显示当前版本，允许检查更新，并禁止提前安装。',
              data: result.initialState
            }
          )

          await runtime.assertThat(result.observedStatuses.length === 4, {
            name: 'update-status-flow-is-visible',
            message: '页面应依次展示检查、发现版本、下载和等待安装状态。',
            data: { observedStatuses: result.observedStatuses }
          })

          await runtime.assertThat(
            result.downloadedState.availableVersion === '0.1.1' &&
              result.downloadedState.progressPercent === '100' &&
              !result.downloadedState.installDisabled,
            {
              name: 'downloaded-update-can-be-installed',
              message: '下载完成后应显示新版本与完整进度，并允许重启安装。',
              data: result.downloadedState
            }
          )

          await runtime.assertThat(
            result.ipcCalls.includes('appUpdateCheck') &&
              result.ipcCalls.includes('appUpdateInstall'),
            {
              name: 'update-actions-call-desktop-api',
              message: '检查更新和重启安装按钮应调用对应桌面 API。',
              data: { ipcCalls: result.ipcCalls }
            }
          )

          await runtime.assertThat(result.errorText?.includes('network unavailable') === true, {
            name: 'update-error-is-visible',
            message: '更新失败时应显示具体错误信息。',
            data: { errorText: result.errorText }
          })

          await runtime.assertThat(
            result.unsignedMacState.statusText?.includes(
              'macOS 自动更新需要有效的 Developer ID 签名'
            ) === true && result.unsignedMacState.checkDisabled,
            {
              name: 'unsigned-macos-update-is-blocked',
              message: '未签名 macOS 构建应说明原因并禁止检查更新。',
              data: result.unsignedMacState
            }
          )
        }
      })
    },
    SETTINGS_E2E_TIMEOUT_MS
  )
})
