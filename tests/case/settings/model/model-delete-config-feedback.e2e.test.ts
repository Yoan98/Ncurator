import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, it } from 'vitest'
import { settingsSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  createModelConfigThroughSettingsUi,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../../harness/e2e/settings'

describe('settings model e2e', () => {
  it(
    'model-delete-config-feedback',
    async () => {
      await runE2ECase({
        caseId: 'model-delete-config-feedback',
        domain: 'settings',
        suite: 'model',
        description: '删除连接配置时，成功路径通过真实 UI 刷新列表。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          let deleteFailureVisible = false
          let failedDeleteRowVisible = false

          await runtime.step({
            name: 'create-configs-through-ui',
            message: '通过 UI 创建保留配置和待删除配置。',
            run: async () => {
              await createModelConfigThroughSettingsUi(page, {
                name: '保留配置',
                baseUrl: 'https://api.openai.com/v1',
                apiKey: 'sk-model-delete-active'
              })
              await createModelConfigThroughSettingsUi(page, {
                name: '待删除配置',
                baseUrl: 'https://api.deepseek.com/v1',
                apiKey: 'sk-model-delete-success'
              })
              await navigateToSettingsSection(page, 'model')
            }
          })

          await runtime.step({
            name: 'delete-config-successfully',
            message: '删除一条配置，确认列表收敛。',
            run: async () => {
              await page
                .locator('tbody tr')
                .filter({ hasText: '待删除配置' })
                .locator('button')
                .last()
                .click()
              await page.getByText('确定要删除此配置吗？').waitFor({ state: 'visible' })
              await page.locator('.ant-popover .ant-btn-primary').click()
              await page
                .locator('tbody tr')
                .filter({ hasText: '待删除配置' })
                .waitFor({ state: 'detached' })
            }
          })

          await runtime.step({
            name: 'delete-config-while-database-is-locked',
            message: '制造真实数据库写锁后通过 UI 删除配置，确认失败反馈和原配置保留。',
            run: async () => {
              const nativeBinding = path.resolve(
                process.cwd(),
                'node_modules',
                '.native-cache',
                'better-sqlite3',
                `node-v${process.versions.modules}-${process.platform}-${process.arch}`,
                'better_sqlite3.node'
              )
              const lockDatabase = new Database(path.join(runtime.userDataDir, 'app.sqlite'), {
                nativeBinding
              })
              lockDatabase.exec('BEGIN IMMEDIATE')
              runtime.registerResource({
                name: 'settings-model-delete-database-lock',
                phase: 'before-app-close',
                dispose: async () => {
                  if (lockDatabase.inTransaction) lockDatabase.exec('ROLLBACK')
                  lockDatabase.close()
                }
              })

              await page
                .locator('tbody tr')
                .filter({ hasText: '保留配置' })
                .locator('button')
                .last()
                .click()
              await page.getByText('确定要删除此配置吗？').waitFor({ state: 'visible' })
              await page.locator('.ant-popover .ant-btn-primary').click()

              const errorNotice = page.locator('.nc-notice-danger')
              await errorNotice.waitFor({ state: 'visible', timeout: 10_000 })
              deleteFailureVisible = Boolean((await errorNotice.textContent())?.trim())
              failedDeleteRowVisible =
                (await page
                  .locator('tbody tr')
                  .filter({ hasText: '保留配置' })
                  .count()) === 1
            }
          })

          return {
            deletedRowVisible: await page
              .locator('tbody tr')
              .filter({ hasText: '待删除配置' })
              .count(),
            activeRowStillVisible: await page
              .locator('tbody tr')
              .filter({ hasText: '保留配置' })
              .count(),
            deleteFailureVisible,
            failedDeleteRowVisible,
            tableText:
              (await getSettingsLocator(page, settingsSelectors.modelTable).textContent()) || ''
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(result.deletedRowVisible === 0, {
            name: 'delete-success-removes-config-row',
            message: '删除成功后，被删配置应从列表中消失，对齐 SET-MODEL-003-AC1。',
            data: result
          })

          await runtime.assertThat(
            result.activeRowStillVisible === 1 && result.tableText.includes('保留配置'),
            {
              name: 'delete-success-keeps-other-configs',
              message: '删除一条配置不应影响其他配置继续展示。',
              data: result
            }
          )

          await runtime.assertThat(result.deleteFailureVisible && result.failedDeleteRowVisible, {
            name: 'delete-failure-keeps-config-and-shows-error',
            message: '真实数据库写入失败时应显示错误且保留原配置，对齐 SET-MODEL-003-AC2。',
            data: result
          })
        }
      })
    },
    SETTINGS_E2E_TIMEOUT_MS * 2
  )
})
