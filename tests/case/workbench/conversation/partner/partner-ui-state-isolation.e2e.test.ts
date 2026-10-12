import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  createPartnerThroughWorkbenchUi,
  selectWorkbenchAiPreference,
  selectWorkbenchExecutionPermission,
  selectWorkbenchResourceMenuItem,
  setWorkbenchInput,
  ensureWorkbenchContentPanelExpanded,
  navigateToWorkbench,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'partner-ui-state-isolation'

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
          await createPartnerThroughWorkbenchUi(page, '状态伙伴 A')
          await createPartnerThroughWorkbenchUi(page, '状态伙伴 B')
          const partners = await page.evaluate(() => window.api.partnerList())
          const partnerA = partners.find((item) => item.name === '状态伙伴 A')
          const partnerB = partners.find((item) => item.name === '状态伙伴 B')
          if (!partnerA || !partnerB) throw new Error('created partners missing')
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${partnerA.id}`
          ).click()
          await page.getByText('找俺干啥？', { exact: true }).waitFor({ state: 'visible' })
          await setWorkbenchInput(page, 'A 独立草稿')
          await selectWorkbenchAiPreference(page, '严谨')
          await selectWorkbenchExecutionPermission(page, '完全访问')
          await selectWorkbenchResourceMenuItem(runtime, 'file')
          await page.waitForFunction(async (partnerId) => {
            const { uiState } = await window.api.partnerOpen({ partnerId })
            return (
              uiState?.composer.aiPreference === 'local_sources_strict' &&
              uiState.composer.executionPermission === 'full_access' &&
              uiState.panel.activeTabId === 'file:launcher' &&
              !uiState.panel.collapsed
            )
          }, partnerA.id)
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${partnerB.id}`
          ).click()
          await page.getByText('找俺干啥？', { exact: true }).waitFor({ state: 'visible' })
          await setWorkbenchInput(page, 'B 独立草稿')
          await selectWorkbenchAiPreference(page, '默认')
          await selectWorkbenchExecutionPermission(page, '审核')
          const toggle = getWorkbenchLocator(page, workbenchSelectors.contentPanelToggle)
          if ((await toggle.getAttribute('aria-label')) === '收起右侧栏') await toggle.click()

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
            panelVisible: await page.evaluate(
              (testId) =>
                document
                  .querySelector(`[data-testid="${testId}"]`)
                  ?.getAttribute('data-panel-visible') === 'true',
              workbenchSelectors.contentPanelShell
            )
          })
          const selectPartner = async (id: string, draft: string) => {
            await getWorkbenchLocator(page, `${workbenchSelectors.partnerItemPrefix}-${id}`).click()
            await page.waitForFunction(
              ({ testId, draft }) =>
                document.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() === draft,
              { testId: workbenchSelectors.input, draft }
            )
          }

          await selectPartner(partnerA.id, 'A 独立草稿')
          const firstA = await readVisibleState()
          await selectPartner(partnerB.id, 'B 独立草稿')
          const collapsedB = await readVisibleState()
          await ensureWorkbenchContentPanelExpanded(page)
          const expandedB = await readVisibleState()
          await selectPartner(partnerA.id, 'A 独立草稿')
          const secondA = await readVisibleState()
          await selectPartner(partnerB.id, 'B 独立草稿')
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
              result.firstA.panelText.includes('文件') &&
              result.firstA.panelVisible &&
              result.collapsedB.input === 'B 独立草稿' &&
              result.collapsedB.executionPermission.includes('审核') &&
              !result.collapsedB.panelVisible &&
              result.expandedB.panelVisible &&
              result.secondA.input === result.firstA.input &&
              result.secondA.panelText === result.firstA.panelText &&
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
              data: { firstA: result.firstA, collapsedB: result.collapsedB, expandedB: result.expandedB, secondA: result.secondA, secondB: result.secondB,
                savedA: { preference: result.persisted.stateA?.composer.aiPreference ?? null, permission: result.persisted.stateA?.composer.executionPermission ?? null, activeTabId: result.persisted.stateA?.panel.activeTabId ?? null, collapsed: result.persisted.stateA?.panel.collapsed ?? null },
                savedB: { permission: result.persisted.stateB?.composer.executionPermission ?? null, collapsed: result.persisted.stateB?.panel.collapsed ?? null }
              }
            }
          )
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS
  )
})
