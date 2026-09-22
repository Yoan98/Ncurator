import { describe, it } from 'vitest'
import type { PartnerListItem } from '../../../../src/shared/types'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createPartnerThroughWorkbenchUi,
  getWorkbenchLocator,
  openScheduledTasksView,
  scheduledTaskSelectors,
  setupWorkbenchWithTempWorkspace,
  selectVisibleWorkbenchOption,
  workbenchSelectors
} from '../../../harness/e2e/workbench'

const CASE_ID = 'scheduled-task-ai-create'
const INITIAL_DRAFT = '我们一起来设置一个定时任务吧。询问我需要安排什么，以及应该在什么时候运行。'

describe('workbench scheduled-task e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'scheduled-task',
        groups: [],
        description: '验证 AI 创建选择伙伴后切换聊天、预填草稿、不自动发送并持久化草稿。',
        fixtures: [],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceName: `Workbench ${CASE_ID}`,
            createPartner: false,
            configureModel: false
          })
          await createPartnerThroughWorkbenchUi(page, 'AI 创建目标伙伴')
          await createPartnerThroughWorkbenchUi(page, '草稿切换伙伴')
          const partners = (await page.evaluate(
            async () => await window.api.partnerList()
          )) as PartnerListItem[]
          const target = partners.find((partner) => partner.name === 'AI 创建目标伙伴')
          const other = partners.find((partner) => partner.name === '草稿切换伙伴')
          if (!target || !other) throw new Error('failed to create AI scheduled-task partners')

          await openScheduledTasksView(page)
          await getWorkbenchLocator(page, scheduledTaskSelectors.aiAddButton).click()
          await getWorkbenchLocator(page, scheduledTaskSelectors.aiPartner).click()
          await selectVisibleWorkbenchOption(page, target.name)
          await getWorkbenchLocator(page, scheduledTaskSelectors.aiConfirm).click()

          const input = getWorkbenchLocator(page, workbenchSelectors.input).last()
          await input.waitFor({ state: 'attached' })
          const readVisibleDraft = async (): Promise<boolean> =>
            page
              .getByText(INITIAL_DRAFT, { exact: true })
              .waitFor({ state: 'visible', timeout: 30_000 })
              .then(() => true)
              .catch(() => false)
          const draftPrefilled = await readVisibleDraft()
          const targetOpened = await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${target.id}`
          ).evaluate((element) => element.classList.contains('nc-sidebar-item-active'))
          const openedBeforeSwitch = await page.evaluate(
            async (partnerId) => await window.api.partnerOpen({ partnerId, limit: 20 }),
            target.id
          )
          const noAutomaticSend =
            (openedBeforeSwitch.messages || []).every((message) => message.role !== 'user') &&
            !partners.find((partner) => partner.id === target.id)?.isRunning

          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${other.id}`
          ).click()
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${target.id}`
          ).click()
          await input.waitFor({ state: 'visible' })
          const draftPersisted = await readVisibleDraft()

          return { draftPrefilled, targetOpened, noAutomaticSend, draftPersisted }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.draftPrefilled &&
              result.targetOpened &&
              result.noAutomaticSend &&
              result.draftPersisted,
            {
              name: 'scheduled-task-ai-create-prefills-draft',
              message: 'AI 创建应选择并切换伙伴，只预填持久草稿，不发送消息或启动运行。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_RESULT_E2E_TIMEOUT_MS
  )
})
