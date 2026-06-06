import { describe, it } from 'vitest'
import type { ModelInfo } from '../../../src/preload/api'
import { vectorSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection,
  setSettingsE2EApiOverrides
} from '../../harness/e2e/settings'

const DELETE_SUCCESS_SEQUENCE: readonly ModelInfo[][] = [
  [
    {
      id: 'vector-delete-success',
      name: 'Delete Ready Model',
      description: 'Installed model used to verify delete success feedback.',
      tags: ['delete'],
      isDownloaded: true
    }
  ],
  [
    {
      id: 'vector-delete-success',
      name: 'Delete Ready Model',
      description: 'Installed model used to verify delete success feedback.',
      tags: ['delete'],
      isDownloaded: false
    }
  ]
]

const DELETE_FAILURE_MODELS: readonly ModelInfo[] = [
  {
    id: 'vector-delete-failure',
    name: 'Delete Failure Model',
    description: 'Installed model used to verify delete failure feedback.',
    tags: ['delete'],
    isDownloaded: true
  }
]

describe('settings vector e2e', () => {
  it(
    'vector-delete-feedback',
    async () => {
      await runE2ECase({
        caseId: 'vector-delete-feedback',
        domain: 'settings',
        suite: 'vector',
        description:
          'Installed vector model deletion requires confirmation, keeps state on cancel, restores the download action on success, and keeps the installed state on failure.',
        fixtures: [],
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime

          await setSettingsE2EApiOverrides(page, {
            modelCatalog: {
              sequence: DELETE_SUCCESS_SEQUENCE.map((items) => ({ items: [...items] }))
            },
            deleteModelResponseByRepoId: {
              'vector-delete-success': {
                success: true
              }
            }
          })

          await navigateToSettingsSection(page, 'vector')
          await getSettingsLocator(
            page,
            `${vectorSelectors.deleteButtonPrefix}-vector-delete-success`
          ).click()
          const deleteSuccessConfirmButton = getSettingsLocator(
            page,
            `${vectorSelectors.deleteConfirmButtonPrefix}-vector-delete-success`
          )
          const deleteSuccessCancelButton = getSettingsLocator(
            page,
            `${vectorSelectors.deleteCancelButtonPrefix}-vector-delete-success`
          )
          await deleteSuccessConfirmButton.waitFor({ state: 'visible' })
          await deleteSuccessCancelButton.waitFor({ state: 'visible' })

          const deleteConfirmVisible =
            (await deleteSuccessConfirmButton.isVisible()) &&
            (await deleteSuccessCancelButton.isVisible())

          await deleteSuccessCancelButton.click()
          const deleteCancelInstalledVisible = await getSettingsLocator(
            page,
            `${vectorSelectors.installedBadgePrefix}-vector-delete-success`
          ).isVisible()
          const deleteCancelDownloadVisible = await getSettingsLocator(
            page,
            `${vectorSelectors.downloadButtonPrefix}-vector-delete-success`
          ).isVisible().catch(() => false)

          await getSettingsLocator(
            page,
            `${vectorSelectors.deleteButtonPrefix}-vector-delete-success`
          ).click()
          await getSettingsLocator(
            page,
            `${vectorSelectors.deleteConfirmButtonPrefix}-vector-delete-success`
          ).click()
          await getSettingsLocator(
            page,
            `${vectorSelectors.downloadButtonPrefix}-vector-delete-success`
          ).waitFor({ state: 'visible' })

          const deleteSuccessDownloadVisible = await getSettingsLocator(
            page,
            `${vectorSelectors.downloadButtonPrefix}-vector-delete-success`
          ).isVisible()
          const deleteSuccessInstalledVisible = await getSettingsLocator(
            page,
            `${vectorSelectors.installedBadgePrefix}-vector-delete-success`
          ).isVisible().catch(() => false)

          await setSettingsE2EApiOverrides(page, {
            modelCatalog: {
              items: [...DELETE_FAILURE_MODELS]
            },
            deleteModelResponseByRepoId: {
              'vector-delete-failure': {
                success: false,
                error: 'E2E vector delete failed'
              }
            }
          })

          await navigateToSettingsSection(page, 'model')
          await navigateToSettingsSection(page, 'vector')
          const deleteFailureButton = getSettingsLocator(
            page,
            `${vectorSelectors.deleteButtonPrefix}-vector-delete-failure`
          )
          await deleteFailureButton.waitFor({ state: 'visible' })
          await deleteFailureButton.click()
          await getSettingsLocator(
            page,
            `${vectorSelectors.deleteConfirmButtonPrefix}-vector-delete-failure`
          ).click()
          const deleteFailureErrorLocator = getSettingsLocator(
            page,
            `${vectorSelectors.errorPrefix}-vector-delete-failure`
          )
          const deleteFailureMessageVisible = await deleteFailureErrorLocator
            .waitFor({ state: 'visible' })
            .then(async () => {
              const errorText = (await deleteFailureErrorLocator.textContent()) || ''
              return errorText.includes('E2E vector delete failed')
            })
            .catch(() => false)

          return {
            deleteConfirmVisible,
            deleteCancelInstalledVisible,
            deleteCancelDownloadVisible,
            deleteSuccessDownloadVisible,
            deleteSuccessInstalledVisible,
            deleteFailureMessageVisible,
            deleteFailureInstalledVisible: await getSettingsLocator(
              page,
              `${vectorSelectors.installedBadgePrefix}-vector-delete-failure`
            ).isVisible(),
            deleteFailureDownloadVisible: await getSettingsLocator(
              page,
              `${vectorSelectors.downloadButtonPrefix}-vector-delete-failure`
            ).isVisible().catch(() => false)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.deleteConfirmVisible &&
              result.deleteCancelInstalledVisible &&
              !result.deleteCancelDownloadVisible,
            {
              name: 'vector-delete-requires-confirmation-before-removal',
              message:
                'Clicking delete should open a confirmation prompt, and cancelling should keep the installed model unchanged to satisfy SET-VECTOR-004-AC3 and SET-VECTOR-004-AC4.',
              data: result
            }
          )

          await runtime.assertThat(
            result.deleteSuccessDownloadVisible && !result.deleteSuccessInstalledVisible,
            {
              name: 'vector-delete-success-restores-download-entry',
              message:
                'After a successful delete, the installed model should return to the downloadable state to satisfy SET-VECTOR-004-AC1.',
              data: result
            }
          )

          await runtime.assertThat(
            result.deleteFailureMessageVisible &&
              result.deleteFailureInstalledVisible &&
              !result.deleteFailureDownloadVisible,
            {
              name: 'vector-delete-failure-keeps-installed-state',
              message:
                'When delete fails, the page should surface the failure reason and keep the installed state to satisfy SET-VECTOR-004-AC2.',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_E2E_TIMEOUT_MS * 2
  )
})
