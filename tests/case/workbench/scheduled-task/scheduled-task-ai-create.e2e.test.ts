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
  workbenchSelectors,
  waitForScheduledTaskDrawerClosed
} from '../../../harness/e2e/workbench'

const approxCssPx = (value: string, expected: number, tolerance = 1): boolean => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && Math.abs(parsed - expected) <= tolerance
}

const CASE_ID = 'scheduled-task-ai-create'
const INITIAL_DRAFT = '我们一起来设置一个定时任务吧。询问我需要安排什么，以及应该在什么时候运行。'
const TARGET_PARTNER_NAME = 'AI 创建目标伙伴名称过长用于验证伙伴列表中的截断样式和可滚动选择'

describe('workbench scheduled-task e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'scheduled-task',
        groups: [],
        description: '验证 AI 创建伙伴列表最多显示四项后滚动、名称截断、选择状态与草稿切换。',
        fixtures: [],
        knowledge: 'cached',
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
          await openScheduledTasksView(page)
          await getWorkbenchLocator(page, scheduledTaskSelectors.aiAddButton).click()
          const emptyPartnerStateVisible = await page
            .getByText('暂无伙伴', { exact: true })
            .isVisible()
          const emptyPartnerConfirmDisabled = await getWorkbenchLocator(
            page,
            scheduledTaskSelectors.aiConfirm
          ).isDisabled()
          await page.locator('.ant-modal .ant-btn-default').click()
          await createPartnerThroughWorkbenchUi(page, TARGET_PARTNER_NAME)
          await openScheduledTasksView(page)
          const toolbarButtons = await Promise.all(
            [scheduledTaskSelectors.addButton, scheduledTaskSelectors.aiAddButton].map((id) =>
              page.getByTestId(id).evaluate((element) => ({
                height: element.getBoundingClientRect().height,
                fontSize: getComputedStyle(element).fontSize
              }))
            )
          )
          const listHasNoExtraSpace = async (id: string): Promise<boolean> =>
            page.getByTestId(id).evaluate((element) => {
              const row = element.querySelector<HTMLElement>('button')
              const style = getComputedStyle(element)
              return Boolean(
                row &&
                Math.abs(
                  element.clientHeight -
                    row.offsetHeight -
                    parseFloat(style.paddingTop) -
                    parseFloat(style.paddingBottom)
                ) <= 1
              )
            })
          await page.getByTestId(scheduledTaskSelectors.addButton).click()
          const manualListCompact = await listHasNoExtraSpace(scheduledTaskSelectors.formPartner)
          const footerHeight = await page
            .getByTestId(scheduledTaskSelectors.formSave)
            .evaluate((element) => (element as HTMLButtonElement).offsetHeight)
          await page.getByTestId(scheduledTaskSelectors.formCancel).click()
          await waitForScheduledTaskDrawerClosed(page)
          await page.getByTestId(scheduledTaskSelectors.aiAddButton).click()
          const aiListCompact = await listHasNoExtraSpace(scheduledTaskSelectors.aiPartner)
          const aiFooterHeight = await page
            .getByTestId(scheduledTaskSelectors.aiConfirm)
            .evaluate((element) => (element as HTMLButtonElement).offsetHeight)
          await page.waitForFunction(
            () => !document.querySelector('.ant-zoom-appear-active, .ant-zoom-enter-active')
          )
          await runtime.captureScreenshot({
            name: 'scheduled-task-one-partner',
            message: '定时任务单伙伴选择列表与按钮尺寸。'
          })
          await page.locator('.ant-modal .ant-btn-default').click()
          await createPartnerThroughWorkbenchUi(page, '草稿切换伙伴')
          for (let index = 0; index < 8; index += 1) {
            await createPartnerThroughWorkbenchUi(page, `AI 列表滚动伙伴${index + 1}`)
          }
          const partners = (await page.evaluate(
            async () => await window.api.partnerList()
          )) as PartnerListItem[]
          const target = partners.find((partner) => partner.name === TARGET_PARTNER_NAME)
          const other = partners.find((partner) => partner.name === '草稿切换伙伴')
          if (!target || !other) throw new Error('failed to create AI scheduled-task partners')

          await openScheduledTasksView(page)
          await getWorkbenchLocator(page, scheduledTaskSelectors.aiAddButton).click()
          const partnerList = getWorkbenchLocator(page, scheduledTaskSelectors.aiPartner)
          await partnerList.evaluate((element) => {
            element.scrollTop = 0
          })
          const partnerListScroll = await partnerList.evaluate((element) => {
            const style = getComputedStyle(element)
            const listRect = element.getBoundingClientRect()
            const fullyVisibleOptionCount = [
              ...element.querySelectorAll('button[data-testid]')
            ].filter((option) => {
              const optionRect = option.getBoundingClientRect()
              return (
                optionRect.top >= listRect.top - 0.5 && optionRect.bottom <= listRect.bottom + 0.5
              )
            }).length
            return {
              maxHeight: style.maxHeight,
              overflowY: style.overflowY,
              scrollHeight: element.scrollHeight,
              clientHeight: element.clientHeight,
              fullyVisibleOptionCount
            }
          })
          const targetOption = page.getByTestId(
            `${scheduledTaskSelectors.aiPartner}-option-${target.id}`
          )
          await targetOption.scrollIntoViewIfNeeded()
          const partnerListScrollsToOffscreenOption =
            (await partnerList.evaluate((element) => element.scrollTop)) > 0
          const targetNameActuallyOverflows = await targetOption
            .locator('.truncate')
            .evaluate((element) => element.scrollWidth > element.clientWidth)
          const partnerOptionShowsAnimatedAvatar =
            (await targetOption.isVisible()) &&
            (await targetOption.locator('.nc-partner-avatar-animated').count()) === 1
          await targetOption.click()
          const selectedPartner = targetOption
          const partnerSelectionShowsAnimatedAvatar =
            (await selectedPartner.isVisible()) &&
            (await selectedPartner.locator('.nc-partner-avatar-animated').count()) === 1 &&
            (await selectedPartner.getAttribute('aria-pressed')) === 'true'
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

          return {
            toolbarButtons,
            manualListCompact,
            aiListCompact,
            footerHeight,
            aiFooterHeight,
            emptyPartnerStateVisible,
            emptyPartnerConfirmDisabled,
            partnerListScroll,
            partnerListScrollsToOffscreenOption,
            targetNameActuallyOverflows,
            partnerOptionShowsAnimatedAvatar,
            partnerSelectionShowsAnimatedAvatar,
            draftPrefilled,
            targetOpened,
            noAutomaticSend,
            draftPersisted
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.toolbarButtons.every(
              (button) => Math.abs(button.height - 28) <= 0.05 && button.fontSize === '12px'
            ) &&
              result.manualListCompact &&
              result.aiListCompact &&
              result.footerHeight === 32 &&
              result.aiFooterHeight === 32 &&
              result.emptyPartnerStateVisible &&
              result.emptyPartnerConfirmDisabled &&
              approxCssPx(result.partnerListScroll.maxHeight, 208) &&
              result.partnerListScroll.overflowY === 'auto' &&
              result.partnerListScroll.fullyVisibleOptionCount === 4 &&
              result.partnerListScroll.scrollHeight > result.partnerListScroll.clientHeight &&
              result.partnerListScrollsToOffscreenOption &&
              result.targetNameActuallyOverflows &&
              result.partnerOptionShowsAnimatedAvatar &&
              result.partnerSelectionShowsAnimatedAvatar &&
              result.draftPrefilled &&
              result.targetOpened &&
              result.noAutomaticSend &&
              result.draftPersisted,
            {
              name: 'scheduled-task-ai-create-prefills-draft',
              message:
                'AI 创建应展示可滚动、名称截断且选择态正确的伙伴列表，并预填持久草稿而不发送消息。',
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
