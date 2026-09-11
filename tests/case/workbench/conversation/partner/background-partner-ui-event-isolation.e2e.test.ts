import { describe, it } from 'vitest'
import type { Partner, PartnerUiStateV1 } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  navigateToWorkbench,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'background-partner-ui-event-isolation'

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

const emptyState = (draft: string): PartnerUiStateV1 => ({
  version: 1,
  composer: {
    aiPreference: 'default',
    executionPermission: 'review',
    modelSelection: { mainModel: null },
    draft: {
      input: draft,
      contentNodes: [{ kind: 'text', text: draft }],
      selectedReferences: [],
      attachments: [],
      assetBucketId: null
    }
  },
  panel: {
    tabs: [],
    activeTabId: null,
    collapsed: true,
    fallbackState: { kind: 'empty', title: '资源工作台', description: '' }
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
        description: '验证后台 A 伙伴的浏览器状态变化不会覆盖当前 B 伙伴。',
        fixtures: [],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToWorkbench(page, { waitForSessionListText: false })
          const partnerA = createPartner('background-a', '后台 A', 10)
          const partnerB = createPartner('background-b', '当前 B', 20)
          const stateA = emptyState('A 后台草稿')
          const stateB = emptyState('B 当前草稿')
          await page.evaluate(
            async ({ partnerA, partnerB, stateA, stateB }) => {
              await window.api.partnerSave(partnerA)
              await window.api.partnerSave(partnerB)
              await window.api.partnerUiStateSave({
                partnerId: partnerA.id,
                state: stateA
              })
              await window.api.partnerUiStateSave({
                partnerId: partnerB.id,
                state: stateB
              })
              await window.api.workbenchUiStateSave({
                activeViewKey: partnerB.id
              })
            },
            { partnerA, partnerB, stateA, stateB }
          )
          await page.reload()
          await navigateToWorkbench(page)
          const browser = await page.evaluate(async (ownerId) => {
            const created = await window.api.browserTabCreate({ ownerId })
            if (!created.success || !created.state) throw new Error('browser create failed')
            const listed = await window.api.browserTabList({ ownerId })
            return { state: created.state, listed }
          }, partnerA.id)
          const currentAfterBackgroundEvent = {
            input: (
              (await getWorkbenchLocator(page, workbenchSelectors.input).textContent()) || ''
            ).trim(),
            shellCount: await getWorkbenchLocator(
              page,
              workbenchSelectors.contentPanelShell
            ).count()
          }
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${partnerA.id}`
          ).click()
          await page.waitForFunction(
            ({ testId, draft }) =>
              document.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() === draft,
            { testId: workbenchSelectors.input, draft: 'A 后台草稿' }
          )
          await getWorkbenchLocator(page, workbenchSelectors.contentPanelToggle).click()
          await getWorkbenchLocator(page, workbenchSelectors.contentPanelShell).waitFor({
            state: 'visible'
          })
          const aTabVisible = await getWorkbenchLocator(
            page,
            `${workbenchSelectors.resourceTabPrefix}-browser-${browser.state.id}`
          ).isVisible()
          const listedAfterSwitch = await page.evaluate(
            (ownerId) => window.api.browserTabList({ ownerId }),
            partnerA.id
          )
          return { currentAfterBackgroundEvent, browser, listedAfterSwitch, aTabVisible }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.currentAfterBackgroundEvent.input === 'B 当前草稿' &&
              result.currentAfterBackgroundEvent.shellCount === 0 &&
              result.aTabVisible,
            {
              name: 'workbench-background-partner-ui-event-isolation',
              message: 'A 的后台浏览器状态只能归属 A，不能展开或覆盖当前 B。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS
  )
})
