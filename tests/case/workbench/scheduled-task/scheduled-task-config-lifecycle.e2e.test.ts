import { describe, it } from 'vitest'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createPartnerThroughWorkbenchUi,
  fillScheduledTaskTime,
  getWorkbenchLocator,
  openScheduledTasksView,
  scheduledTaskSelectors,
  setupWorkbenchWithTempWorkspace,
  setWorkbenchInput,
  waitForScheduledTaskDrawerClosed,
  workbenchSelectors
} from '../../../harness/e2e/workbench'
import type { PartnerListItem, ScheduledTask } from '../../../../src/shared/types'

const CASE_ID = 'scheduled-task-config-lifecycle'
const PARTNER_NAME = '生命周期伙伴'
const REBOUND_PARTNER_NAME = '重新绑定伙伴'
const TASK_NAME = '定时任务生命周期'
const TASK_NAME_EDITED = '定时任务生命周期已编辑'
const TASK_PROMPT = '请只回复 ok。'

const listTasks = async (page: import('playwright').Page): Promise<ScheduledTask[]> =>
  (await page.evaluate(async () => await window.api.scheduledTaskList())) as ScheduledTask[]

const listPartners = async (page: import('playwright').Page): Promise<PartnerListItem[]> =>
  (await page.evaluate(async () => await window.api.partnerList())) as PartnerListItem[]

describe('workbench scheduled-task e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'scheduled-task',
        groups: [],
        description:
          '验证定时任务新增、伙伴必填、默认开启、编辑保存不改启用、立即执行确认与删除闭环。',
        fixtures: ['tests/fixtures/workspace'],
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
          await createPartnerThroughWorkbenchUi(page, PARTNER_NAME)
          await createPartnerThroughWorkbenchUi(page, REBOUND_PARTNER_NAME)
          for (let index = 0; index < 8; index += 1) {
            await createPartnerThroughWorkbenchUi(page, `伙伴列表滚动${index + 1}`)
          }
          const partnersBefore = await listPartners(page)
          const originalPartner = partnersBefore.find((partner) => partner.name === PARTNER_NAME)
          const reboundPartner = partnersBefore.find(
            (partner) => partner.name === REBOUND_PARTNER_NAME
          )

          await openScheduledTasksView(page)

          await getWorkbenchLocator(page, scheduledTaskSelectors.addButton).click()
          const saveButton = getWorkbenchLocator(page, scheduledTaskSelectors.formSave)
          await saveButton.waitFor({ state: 'visible' })
          const drawer = page.locator('.scheduled-task-config-drawer')
          const drawerOpened = await drawer.evaluate((element) =>
            element.classList.contains('ant-drawer-open')
          )
          await page.locator('.ant-drawer-mask').click({ position: { x: 12, y: 12 } })
          const maskKeepsDrawerOpen = await drawer.evaluate((element) =>
            element.classList.contains('ant-drawer-open')
          )
          await getWorkbenchLocator(page, scheduledTaskSelectors.formName).fill('未保存的草稿')
          await page.keyboard.press('Escape')
          await page.getByText('放弃未保存的更改？', { exact: true }).waitFor({ state: 'visible' })
          await page.getByRole('button', { name: '继续编辑', exact: true }).click()
          const escapeKeepsDirtyDrawerOpen = await drawer.evaluate((element) =>
            element.classList.contains('ant-drawer-open')
          )
          await getWorkbenchLocator(page, scheduledTaskSelectors.formCancel).click()
          await page.getByRole('button', { name: '放弃修改', exact: true }).click()
          await waitForScheduledTaskDrawerClosed(page)
          await getWorkbenchLocator(page, scheduledTaskSelectors.addButton).click()
          await saveButton.waitFor({ state: 'visible' })
          const expectedDrawerWidth = await page.evaluate(() =>
            Math.min(window.innerWidth / 2, 800)
          )
          await page.waitForFunction(
            (input: { drawerClass: string; expectedWidth: number }) => {
              const wrapper = document
                .querySelector(`.${input.drawerClass}`)
                ?.querySelector<HTMLElement>('.ant-drawer-content-wrapper')
              return Boolean(
                wrapper &&
                Math.abs(wrapper.getBoundingClientRect().width - input.expectedWidth) <= 2
              )
            },
            { drawerClass: scheduledTaskSelectors.drawer, expectedWidth: expectedDrawerWidth }
          )
          const partnerBox = await getWorkbenchLocator(
            page,
            scheduledTaskSelectors.formPartner
          ).boundingBox()
          const nameBox = await getWorkbenchLocator(
            page,
            scheduledTaskSelectors.formName
          ).boundingBox()
          const partnerIsFirstField = Boolean(partnerBox && nameBox && partnerBox.y < nameBox.y)
          const fieldBoxes = await Promise.all(
            [
              scheduledTaskSelectors.formPartner,
              scheduledTaskSelectors.formName,
              scheduledTaskSelectors.formDescription,
              scheduledTaskSelectors.formScheduleType,
              scheduledTaskSelectors.formTime
            ].map((testId) => getWorkbenchLocator(page, testId).boundingBox())
          )
          const fieldsOrdered = fieldBoxes.every(
            (box, index) =>
              box !== null && (index === 0 || box.y > (fieldBoxes[index - 1]?.y ?? -1))
          )
          const drawerWidth = await drawer.evaluate((element) => {
            const wrapper = element.querySelector<HTMLElement>('.ant-drawer-content-wrapper')
            return wrapper?.getBoundingClientRect().width || 0
          })
          const drawerWidthMatches = Math.abs(drawerWidth - expectedDrawerWidth) <= 2
          const formContent = getWorkbenchLocator(page, scheduledTaskSelectors.formContent)
          const formFooter = getWorkbenchLocator(page, scheduledTaskSelectors.formFooter)
          const footerTopBeforeScroll = (await formFooter.boundingBox())?.y ?? -1
          await formContent.evaluate((element) => {
            element.scrollTop = element.scrollHeight
          })
          const footerTopAfterScroll = (await formFooter.boundingBox())?.y ?? -2
          const footerFixed =
            footerTopBeforeScroll >= 0 && footerTopAfterScroll === footerTopBeforeScroll
          const partnerListScroll = await getWorkbenchLocator(
            page,
            scheduledTaskSelectors.formPartner
          ).evaluate((element) => {
            const style = getComputedStyle(element)
            const maxScrollTop = element.scrollHeight - element.clientHeight
            element.scrollTop = maxScrollTop
            const reachedBottom = maxScrollTop > 0 && element.scrollTop > 0
            element.scrollTop = 0
            return {
              maxHeight: style.maxHeight,
              overflowY: style.overflowY,
              reachedBottom
            }
          })
          await getWorkbenchLocator(page, scheduledTaskSelectors.formName).fill(TASK_NAME)
          await setWorkbenchInput(page, TASK_PROMPT, scheduledTaskSelectors.formDescriptionInput)
          await fillScheduledTaskTime(page, '09:05')
          await saveButton.click()
          const partnerRequiredBlocked = (await listTasks(page)).length === 0
          const formStillOpenAfterMissingPartner = await saveButton.isVisible()
          const originalPartnerOption = page.getByTestId(
            `${scheduledTaskSelectors.formPartner}-option-${originalPartner?.id}`
          )
          const partnerOptionShowsAnimatedAvatar =
            (await originalPartnerOption.isVisible()) &&
            (await originalPartnerOption.locator('.nc-partner-avatar-animated').count()) === 1
          await originalPartnerOption.click()
          const selectedPartner = page.getByTestId(
            `${scheduledTaskSelectors.formPartner}-option-${originalPartner?.id}`
          )
          const partnerSelectionShowsAnimatedAvatar =
            (await selectedPartner.isVisible()) &&
            (await selectedPartner.locator('.nc-partner-avatar-animated').count()) === 1
          await saveButton.click()
          await waitForScheduledTaskDrawerClosed(page)

          const createdTasks = await listTasks(page)
          const created = createdTasks.find((task) => task.name === TASK_NAME)
          const partnersAfterCreate = await listPartners(page)
          const createdCorrectly = Boolean(
            created &&
            created.enabled &&
            created.scheduleType === 'daily' &&
            created.timeOfDay === '09:05' &&
            created.partnerId === originalPartner?.id &&
            partnersAfterCreate.length === partnersBefore.length
          )
          const item = created
            ? getWorkbenchLocator(page, `${scheduledTaskSelectors.itemPrefix}-${created.id}`)
            : null
          const itemShowsSummary = item
            ? ((await item.textContent())?.includes('每天 09:05') ?? false)
            : false

          const runNowButton = created
            ? getWorkbenchLocator(page, `${scheduledTaskSelectors.itemRunNowPrefix}-${created.id}`)
            : null
          await runNowButton?.click()
          const confirmOk = page.locator('.ant-modal-confirm-btns .ant-btn-primary')
          await confirmOk.waitFor({ state: 'visible' })
          await page.locator('.ant-modal-confirm-btns .ant-btn-default').click()
          const partnersAfterRunNowCancel = await listPartners(page)
          const runNowConfirmCancelKeptIdle =
            partnersAfterRunNowCancel.length === partnersBefore.length &&
            !partnersAfterRunNowCancel.some((partner) => partner.isRunning)

          const toggle = created
            ? getWorkbenchLocator(page, `${scheduledTaskSelectors.itemTogglePrefix}-${created.id}`)
            : null
          await toggle?.click()
          const disabledAfterToggle = created
            ? !(await listTasks(page)).find((task) => task.id === created.id)?.enabled
            : false
          await toggle?.click()
          const enabledAfterToggle = created
            ? Boolean((await listTasks(page)).find((task) => task.id === created.id)?.enabled)
            : false
          const sidebarCountChip = getWorkbenchLocator(
            page,
            workbenchSelectors.scheduledTasksCountChip
          )
          const titleCountChip = getWorkbenchLocator(page, scheduledTaskSelectors.countChip)
          const countChipVisibleAfterEnable =
            enabledAfterToggle &&
            (await sidebarCountChip
              .waitFor({ state: 'visible' })
              .then(() => true)
              .catch(() => false)) &&
            (await titleCountChip
              .waitFor({ state: 'visible' })
              .then(() => true)
              .catch(() => false)) &&
            (await sidebarCountChip.textContent())?.trim() === '1' &&
            (await titleCountChip.textContent())?.trim() === '1'

          if (item && created) {
            await getWorkbenchLocator(
              page,
              `${scheduledTaskSelectors.itemEditPrefix}-${created.id}`
            ).click()
            const nameInput = getWorkbenchLocator(page, scheduledTaskSelectors.formName)
            await nameInput.waitFor({ state: 'visible' })
            await nameInput.fill(TASK_NAME_EDITED)
            await page
              .getByTestId(`${scheduledTaskSelectors.formPartner}-option-${reboundPartner?.id}`)
              .click()
            await getWorkbenchLocator(page, scheduledTaskSelectors.formSave).click()
            await waitForScheduledTaskDrawerClosed(page)
          }
          const editedTasks = await listTasks(page)
          const edited = editedTasks.find((task) => task.name === TASK_NAME_EDITED)
          const editedCorrectly = Boolean(
            edited?.enabled && edited.partnerId === reboundPartner?.id
          )
          const countChipVisibleAfterEdit =
            Boolean(edited?.enabled) &&
            (await sidebarCountChip
              .waitFor({ state: 'visible' })
              .then(() => true)
              .catch(() => false)) &&
            (await titleCountChip
              .waitFor({ state: 'visible' })
              .then(() => true)
              .catch(() => false)) &&
            (await sidebarCountChip.textContent())?.trim() === '1' &&
            (await titleCountChip.textContent())?.trim() === '1'

          if (edited) {
            const editedItem = getWorkbenchLocator(
              page,
              `${scheduledTaskSelectors.itemPrefix}-${edited.id}`
            )
            await editedItem.getByRole('button', { name: `删除 ${TASK_NAME_EDITED}` }).click()
            const deleteOk = page.locator('.ant-modal-confirm-btns .ant-btn-dangerous')
            await deleteOk.waitFor({ state: 'visible' })
            await deleteOk.click()
          }
          const deletedCorrectly = (await listTasks(page)).every(
            (task) => task.name !== TASK_NAME_EDITED
          )
          const countChipHiddenAfterDelete =
            (await sidebarCountChip
              .waitFor({ state: 'hidden' })
              .then(() => true)
              .catch(() => false)) &&
            (await titleCountChip
              .waitFor({ state: 'hidden' })
              .then(() => true)
              .catch(() => false))

          return {
            drawerOpened,
            maskKeepsDrawerOpen,
            escapeKeepsDirtyDrawerOpen,
            drawerWidthMatches,
            fieldsOrdered,
            footerFixed,
            partnerListScroll,
            partnerIsFirstField,
            partnerRequiredBlocked,
            formStillOpenAfterMissingPartner,
            partnerOptionShowsAnimatedAvatar,
            partnerSelectionShowsAnimatedAvatar,
            createdCorrectly,
            itemShowsSummary,
            runNowConfirmCancelKeptIdle,
            disabledAfterToggle,
            enabledAfterToggle,
            countChipVisibleAfterEnable,
            editedCorrectly,
            countChipVisibleAfterEdit,
            deletedCorrectly,
            countChipHiddenAfterDelete
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.partnerIsFirstField &&
              result.drawerOpened &&
              result.maskKeepsDrawerOpen &&
              result.escapeKeepsDirtyDrawerOpen &&
              result.drawerWidthMatches &&
              result.fieldsOrdered &&
              result.footerFixed &&
              result.partnerListScroll.maxHeight === '320px' &&
              result.partnerListScroll.overflowY === 'auto' &&
              result.partnerListScroll.reachedBottom &&
              result.partnerRequiredBlocked &&
              result.formStillOpenAfterMissingPartner &&
              result.partnerOptionShowsAnimatedAvatar &&
              result.partnerSelectionShowsAnimatedAvatar &&
              result.createdCorrectly &&
              result.itemShowsSummary &&
              result.runNowConfirmCancelKeptIdle &&
              result.enabledAfterToggle &&
              result.countChipVisibleAfterEnable &&
              result.editedCorrectly &&
              result.countChipVisibleAfterEdit &&
              result.deletedCorrectly &&
              result.countChipHiddenAfterDelete,
            {
              name: 'scheduled-task-config-lifecycle',
              message:
                '定时任务伙伴选择应展示动态形象，新增、保存不建伙伴、必填拦截、编辑、启用、立即执行确认、数量 chip 与删除应完整闭环。',
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
