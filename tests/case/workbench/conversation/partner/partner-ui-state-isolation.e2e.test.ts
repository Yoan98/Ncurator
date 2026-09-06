import { describe, it } from 'vitest'
import type { Partner, PartnerUiStateV1 } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  navigateToWorkbench,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'partner-ui-state-isolation'

const createPartner = (id: string, name: string, createdAt: number): Partner => ({
  id,
  name,
  avatar_shape: 'circle',
  avatar_color: 'blue',
  created_at: createdAt,
  updated_at: createdAt,
  last_viewed_at: createdAt,
  pinned: false,
  pinned_at: null
})

const createUiState = (input: {
  draft: string
  executionPermission: 'review' | 'full_access'
  collapsed: boolean
  panelTitle: string
}): PartnerUiStateV1 => ({
  version: 1,
  composer: {
    aiPreference: input.executionPermission === 'full_access' ? 'local_sources_strict' : 'default',
    executionPermission: input.executionPermission,
    modelSelection: { mainModel: null },
    draft: {
      input: input.draft,
      contentNodes: [{ kind: 'text', text: input.draft }],
      selectedReferences: [],
      attachments: [],
      assetBucketId: null
    }
  },
  panel: {
    tabs: input.collapsed
      ? []
      : [
          {
            id: 'file:launcher',
            kind: 'file',
            title: input.panelTitle,
            state: { kind: 'file_launcher', title: input.panelTitle }
          }
        ],
    activeTabId: input.collapsed ? null : 'file:launcher',
    collapsed: input.collapsed,
    fallbackState: { kind: 'empty', title: '资源工作台', description: input.panelTitle }
  }
})

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['partner'],
        description: '验证两个伙伴的 Composer 和右侧面板状态反复切换后互不覆盖。',
        fixtures: [],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToWorkbench(page, { waitForSessionListText: false })
          const partnerA = createPartner('ui-state-a', '状态伙伴 A', 10)
          const partnerB = createPartner('ui-state-b', '状态伙伴 B', 20)
          const stateA = createUiState({
            draft: 'A 独立草稿',
            executionPermission: 'full_access',
            collapsed: false,
            panelTitle: 'A 文件标签'
          })
          const stateB = createUiState({
            draft: 'B 独立草稿',
            executionPermission: 'review',
            collapsed: true,
            panelTitle: 'B 资源面板'
          })
          await page.evaluate(
            async ({ partnerA, partnerB, stateA, stateB }) => {
              await window.api.partnerSave(partnerA)
              await window.api.partnerSave(partnerB)
              await window.api.partnerUiStateSave({ partnerId: partnerA.id, state: stateA })
              await window.api.partnerUiStateSave({ partnerId: partnerB.id, state: stateB })
              await window.api.workbenchUiStateSave({
                activeViewKey: partnerA.id
              })
            },
            { partnerA, partnerB, stateA, stateB }
          )
          await page.reload()
          await navigateToWorkbench(page)

          const readOptionalText = async (testId: string) => {
            const locator = getWorkbenchLocator(page, testId)
            return (await locator.count()) > 0 ? ((await locator.textContent()) || '').trim() : ''
          }
          const readVisibleState = async () => ({
            input: (
              (await getWorkbenchLocator(page, workbenchSelectors.input).textContent()) || ''
            ).trim(),
            preference: await readOptionalText(workbenchSelectors.aiPreferenceSwitch),
            executionPermission: await readOptionalText(
              workbenchSelectors.executionPermissionSwitch
            ),
            panelText: await readOptionalText(workbenchSelectors.contentPanelShell),
            panelVisible:
              (await getWorkbenchLocator(page, workbenchSelectors.contentPanelShell).getAttribute(
                'data-panel-visible'
              )) === 'true'
          })
          const selectPartner = async (id: string, draft: string) => {
            await getWorkbenchLocator(page, `${workbenchSelectors.partnerItemPrefix}-${id}`).click()
            await page.waitForFunction(
              ({ testId, draft }) =>
                document.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() === draft,
              { testId: workbenchSelectors.input, draft }
            )
          }

          const firstA = await readVisibleState()
          await selectPartner(partnerB.id, stateB.composer.draft.input)
          const collapsedB = await readVisibleState()
          await getWorkbenchLocator(page, workbenchSelectors.contentPanelToggle).click()
          await getWorkbenchLocator(page, workbenchSelectors.contentPanelShell).waitFor({
            state: 'visible'
          })
          const expandedB = await readVisibleState()
          await selectPartner(partnerA.id, stateA.composer.draft.input)
          const secondA = await readVisibleState()
          await selectPartner(partnerB.id, stateB.composer.draft.input)
          const secondB = await readVisibleState()
          const persisted = await page.evaluate(
            async ({ partnerAId, partnerBId }) => {
              const [openedA, openedB] = await Promise.all([
                window.api.partnerOpen({ partnerId: partnerAId }),
                window.api.partnerOpen({ partnerId: partnerBId })
              ])
              return { stateA: openedA.uiState, stateB: openedB.uiState }
            },
            { partnerAId: partnerA.id, partnerBId: partnerB.id }
          )

          return { firstA, collapsedB, expandedB, secondA, secondB, persisted }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.firstA.input === 'A 独立草稿' &&
              result.firstA.preference.includes('本地资料') &&
              result.firstA.executionPermission.includes('完全访问') &&
              result.firstA.panelText.includes('A 文件标签') &&
              result.firstA.panelVisible &&
              result.collapsedB.input === 'B 独立草稿' &&
              result.collapsedB.executionPermission.includes('审核') &&
              !result.collapsedB.panelVisible &&
              result.expandedB.panelVisible &&
              result.secondA.input === result.firstA.input &&
              result.secondA.panelText.includes('A 文件标签') &&
              result.secondA.executionPermission.includes('完全访问') &&
              result.secondB.input === result.collapsedB.input &&
              result.persisted.stateA?.composer.aiPreference === 'local_sources_strict' &&
              result.persisted.stateA?.composer.executionPermission === 'full_access' &&
              result.persisted.stateA?.panel.activeTabId === 'file:launcher' &&
              result.persisted.stateB?.composer.executionPermission === 'review' &&
              result.persisted.stateB?.panel.collapsed === false,
            {
              name: 'workbench-partner-ui-state-isolation',
              message: 'A/B 伙伴必须恢复各自的输入、执行权限和右侧面板状态。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS
  )
})
