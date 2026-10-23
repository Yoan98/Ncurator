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
  selectScheduledTaskPartner,
  setupWorkbenchWithTempWorkspace,
  setWorkbenchInput,
  waitForScheduledTaskDrawerClosed,
  workbenchSelectors
} from '../../../harness/e2e/workbench'
import type { PartnerListItem, ScheduledTask } from '../../../../src/shared/types'

const approxCssPx = (value: string, expected: number, tolerance = 1): boolean => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && Math.abs(parsed - expected) <= tolerance
}

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
          '验证定时任务创建和编辑抽屉的标题关闭、未保存确认、字段顺序、描述滚动、伙伴列表及完整任务闭环。',
        fixtures: ['tests/fixtures/workspace'],
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
          const descriptionEditor = getWorkbenchLocator(
            page,
            scheduledTaskSelectors.formDescriptionInput
          )
          await saveButton.waitFor({ state: 'visible' })
          await descriptionEditor.waitFor({ state: 'visible' })
          const firstCreateEditorReady =
            (await descriptionEditor.isVisible()) &&
            (await page.getByText('页面出现异常，已停止渲染', { exact: true }).count()) === 0
          const drawer = page.locator('.scheduled-task-config-drawer')
          const drawerOpened = await drawer.evaluate((element) =>
            element.classList.contains('ant-drawer-open')
          )
          const closeButton = drawer.locator('.ant-drawer-close')
          await closeButton.waitFor({ state: 'visible' })
          const closeButtonNoDrag =
            (await closeButton.evaluate((element) =>
              getComputedStyle(element).getPropertyValue('-webkit-app-region')
            )) === 'no-drag'
          await closeButton.click()
          await waitForScheduledTaskDrawerClosed(page)
          const cleanHeaderCloseButtonWorks = !(await drawer.evaluate((element) =>
            element.classList.contains('ant-drawer-open')
          ))

          await getWorkbenchLocator(page, scheduledTaskSelectors.addButton).click()
          await saveButton.waitFor({ state: 'visible' })
          await page.locator('.ant-drawer-mask').click({ position: { x: 12, y: 12 } })
          const maskKeepsDrawerOpen = await drawer.evaluate((element) =>
            element.classList.contains('ant-drawer-open')
          )
          await getWorkbenchLocator(page, scheduledTaskSelectors.formName).fill('未保存的草稿')
          await closeButton.click()
          const discardConfirmation = page
            .locator('.ant-modal-confirm')
            .filter({ hasText: '放弃未保存的更改？' })
          await discardConfirmation.waitFor({ state: 'visible' })
          const dirtyHeaderClosePrompts = await discardConfirmation.isVisible()
          await discardConfirmation.getByRole('button', { name: '继续编辑', exact: true }).click()
          await discardConfirmation.waitFor({ state: 'hidden' })
          const dirtyHeaderCloseKeepsDrawerOpen = await drawer.evaluate((element) =>
            element.classList.contains('ant-drawer-open')
          )
          await page.keyboard.press('Escape')
          await discardConfirmation.waitFor({ state: 'visible' })
          await discardConfirmation.getByRole('button', { name: '继续编辑', exact: true }).click()
          await discardConfirmation.waitFor({ state: 'hidden' })
          const escapeKeepsDirtyDrawerOpen = await drawer.evaluate((element) =>
            element.classList.contains('ant-drawer-open')
          )
          await getWorkbenchLocator(page, scheduledTaskSelectors.formCancel).click()
          await discardConfirmation.getByRole('button', { name: '放弃修改', exact: true }).click()
          await discardConfirmation.waitFor({ state: 'hidden' })
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
          const fieldBoxes = await Promise.all(
            [
              scheduledTaskSelectors.formName,
              scheduledTaskSelectors.formDescription,
              scheduledTaskSelectors.formPartner,
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
          await getWorkbenchLocator(page, scheduledTaskSelectors.formName).fill(TASK_NAME)
          const longDescription = Array.from(
            { length: 36 },
            (_, index) => `任务描述滚动验证第 ${index + 1} 行，确认编辑区域限制高度并独立滚动。`
          ).join('\n')
          const descriptionDefaultHeight = await getWorkbenchLocator(
            page,
            scheduledTaskSelectors.formDescriptionInput
          ).evaluate((element) => getComputedStyle(element).height)
          await setWorkbenchInput(
            page,
            longDescription,
            scheduledTaskSelectors.formDescriptionInput
          )
          const descriptionScroll = await getWorkbenchLocator(
            page,
            scheduledTaskSelectors.formDescriptionInput
          ).evaluate((element) => {
            const style = getComputedStyle(element)
            const maxScrollTop = element.scrollHeight - element.clientHeight
            element.scrollTop = maxScrollTop
            const reachedBottom =
              maxScrollTop > 0 &&
              element.scrollTop + element.clientHeight >= element.scrollHeight - 1
            element.scrollTop = 0
            return {
              height: style.height,
              overflowY: style.overflowY,
              scrollHeight: element.scrollHeight,
              clientHeight: element.clientHeight,
              reachedBottom
            }
          })
          await setWorkbenchInput(page, TASK_PROMPT, scheduledTaskSelectors.formDescriptionInput)
          await fillScheduledTaskTime(page, '09:05')
          await saveButton.click()
          const partnerRequiredBlocked = (await listTasks(page)).length === 0
          const formStillOpenAfterMissingPartner = await saveButton.isVisible()
          const partnerList = getWorkbenchLocator(page, scheduledTaskSelectors.formPartner)
          await partnerList.scrollIntoViewIfNeeded()
          await partnerList.evaluate((element) => {
            element.scrollTop = 0
          })
          const partnerListMetrics = await partnerList.evaluate((element) => {
            const style = getComputedStyle(element)
            const listRect = element.getBoundingClientRect()
            const fullyVisibleOptionCount = [
              ...element.querySelectorAll('button[data-testid]')
            ].filter((option) => {
              const optionRect = option.getBoundingClientRect()
              return optionRect.top >= listRect.top + 1 && optionRect.bottom <= listRect.bottom - 1
            }).length
            return {
              maxHeight: style.maxHeight,
              overflowY: style.overflowY,
              scrollHeight: element.scrollHeight,
              clientHeight: element.clientHeight,
              fullyVisibleOptionCount
            }
          })
          const lastPartner = partnersBefore.at(-1)
          if (!lastPartner) throw new Error('failed to locate last scheduled-task partner')
          const lastPartnerOption = getWorkbenchLocator(
            page,
            `${scheduledTaskSelectors.formPartner}-option-${lastPartner.id}`
          )
          await lastPartnerOption.scrollIntoViewIfNeeded()
          const partnerListReachedEnd = await partnerList.evaluate((element) => {
            const maxScrollTop = element.scrollHeight - element.clientHeight
            return (
              maxScrollTop > 0 &&
              element.scrollTop + element.clientHeight >= element.scrollHeight - 1
            )
          })
          const lastPartnerVisibleAtScrollEnd = await lastPartnerOption.evaluate((option) => {
            const list = option.parentElement?.parentElement
            if (!(list instanceof HTMLElement)) return false
            const optionRect = option.getBoundingClientRect()
            const listRect = list.getBoundingClientRect()
            return optionRect.top >= listRect.top && optionRect.bottom <= listRect.bottom
          })
          if (!originalPartner) throw new Error('failed to locate original scheduled-task partner')
          await selectScheduledTaskPartner(page, originalPartner.id)
          const selectedPartnerOption = getWorkbenchLocator(
            page,
            `${scheduledTaskSelectors.formPartner}-option-${originalPartner.id}`
          )
          const partnerListShowsSelectedPartner =
            (await selectedPartnerOption.getAttribute('aria-pressed')) === 'true' &&
            (await selectedPartnerOption.innerText()).includes(originalPartner.name)
          const requiredFieldsBlocked: boolean[] = []
          const assertEmptyBlocked = async (message: string) => {
            await saveButton.click()
            await page.getByText(message, { exact: true }).first().waitFor({ state: 'visible' })
            requiredFieldsBlocked.push(
              (await saveButton.isVisible()) && (await listTasks(page)).length === 0
            )
          }
          await getWorkbenchLocator(page, scheduledTaskSelectors.formName).fill('')
          await assertEmptyBlocked('请填写任务名称')
          await getWorkbenchLocator(page, scheduledTaskSelectors.formName).fill(TASK_NAME)
          await setWorkbenchInput(page, '', scheduledTaskSelectors.formDescriptionInput)
          await assertEmptyBlocked('请填写任务描述')
          await setWorkbenchInput(page, TASK_PROMPT, scheduledTaskSelectors.formDescriptionInput)
          await getWorkbenchLocator(page, scheduledTaskSelectors.formScheduleType)
            .getByText('每周', { exact: true })
            .click()
          await assertEmptyBlocked('请选择星期几')
          await getWorkbenchLocator(page, scheduledTaskSelectors.formScheduleType)
            .getByText('每天', { exact: true })
            .click()
          // TimePicker disables clearing and the cycle always has a selected default.
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

          let editEditorReady = false
          let descriptionBackfilled = false
          let editCloseButtonNoDrag = false
          let editHeaderCloseButtonWorks = false
          if (item && created) {
            await getWorkbenchLocator(
              page,
              `${scheduledTaskSelectors.itemEditPrefix}-${created.id}`
            ).click()
            const nameInput = getWorkbenchLocator(page, scheduledTaskSelectors.formName)
            await nameInput.waitFor({ state: 'visible' })
            await descriptionEditor.waitFor({ state: 'visible' })
            descriptionBackfilled = (await descriptionEditor.innerText()).includes(TASK_PROMPT)
            editEditorReady =
              (await descriptionEditor.isVisible()) &&
              (await page.getByText('页面出现异常，已停止渲染', { exact: true }).count()) === 0
            editCloseButtonNoDrag =
              (await closeButton.evaluate((element) =>
                getComputedStyle(element).getPropertyValue('-webkit-app-region')
              )) === 'no-drag'
            await closeButton.click()
            await waitForScheduledTaskDrawerClosed(page)
            editHeaderCloseButtonWorks = !(await drawer.evaluate((element) =>
              element.classList.contains('ant-drawer-open')
            ))
            await getWorkbenchLocator(
              page,
              `${scheduledTaskSelectors.itemEditPrefix}-${created.id}`
            ).click()
            await nameInput.waitFor({ state: 'visible' })
            await descriptionEditor.waitFor({ state: 'visible' })
            await nameInput.fill(TASK_NAME_EDITED)
            if (!reboundPartner) throw new Error('failed to locate rebound scheduled-task partner')
            await selectScheduledTaskPartner(page, reboundPartner.id)
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

          let deleteCancelPreservedTask = false
          if (edited) {
            const editedItem = getWorkbenchLocator(
              page,
              `${scheduledTaskSelectors.itemPrefix}-${edited.id}`
            )
            await editedItem.getByRole('button', { name: `删除 ${TASK_NAME_EDITED}` }).click()
            const deleteOk = page.locator('.ant-modal-confirm-btns .ant-btn-dangerous')
            await deleteOk.waitFor({ state: 'visible' })
            await page.locator('.ant-modal-confirm-btns .ant-btn-default').click()
            await deleteOk.waitFor({ state: 'hidden' })
            deleteCancelPreservedTask = (await listTasks(page)).some(
              (task) => task.id === edited.id
            )
            await editedItem.getByRole('button', { name: `删除 ${TASK_NAME_EDITED}` }).click()
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
            requiredFieldsBlocked,
            deleteCancelPreservedTask,
            drawerOpened,
            firstCreateEditorReady,
            closeButtonNoDrag,
            cleanHeaderCloseButtonWorks,
            maskKeepsDrawerOpen,
            dirtyHeaderClosePrompts,
            dirtyHeaderCloseKeepsDrawerOpen,
            escapeKeepsDirtyDrawerOpen,
            drawerWidthMatches,
            fieldsOrdered,
            footerFixed,
            descriptionDefaultHeight,
            descriptionScroll,
            partnerRequiredBlocked,
            formStillOpenAfterMissingPartner,
            partnerListMetrics,
            partnerListReachedEnd,
            lastPartnerVisibleAtScrollEnd,
            partnerListShowsSelectedPartner,
            createdCorrectly,
            itemShowsSummary,
            runNowConfirmCancelKeptIdle,
            disabledAfterToggle,
            enabledAfterToggle,
            editEditorReady,
            descriptionBackfilled,
            editCloseButtonNoDrag,
            editHeaderCloseButtonWorks,
            countChipVisibleAfterEnable,
            editedCorrectly,
            countChipVisibleAfterEdit,
            deletedCorrectly,
            countChipHiddenAfterDelete
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.requiredFieldsBlocked.length === 3 &&
              result.requiredFieldsBlocked.every(Boolean) &&
              result.deleteCancelPreservedTask &&
              result.drawerOpened &&
              result.firstCreateEditorReady &&
              result.closeButtonNoDrag &&
              result.cleanHeaderCloseButtonWorks &&
              result.maskKeepsDrawerOpen &&
              result.dirtyHeaderClosePrompts &&
              result.dirtyHeaderCloseKeepsDrawerOpen &&
              result.escapeKeepsDirtyDrawerOpen &&
              result.drawerWidthMatches &&
              result.fieldsOrdered &&
              result.footerFixed &&
              approxCssPx(result.descriptionDefaultHeight, 120) &&
              approxCssPx(result.descriptionScroll.height, 120) &&
              result.descriptionScroll.overflowY === 'auto' &&
              result.descriptionScroll.scrollHeight > result.descriptionScroll.clientHeight &&
              result.descriptionScroll.reachedBottom &&
              result.partnerRequiredBlocked &&
              result.formStillOpenAfterMissingPartner &&
              approxCssPx(result.partnerListMetrics.maxHeight, 208) &&
              result.partnerListMetrics.overflowY === 'auto' &&
              result.partnerListMetrics.fullyVisibleOptionCount === 4 &&
              result.partnerListMetrics.scrollHeight > result.partnerListMetrics.clientHeight &&
              result.partnerListReachedEnd &&
              result.lastPartnerVisibleAtScrollEnd &&
              result.partnerListShowsSelectedPartner &&
              result.createdCorrectly &&
              result.itemShowsSummary &&
              result.runNowConfirmCancelKeptIdle &&
              result.enabledAfterToggle &&
              result.editEditorReady &&
              result.descriptionBackfilled &&
              result.editCloseButtonNoDrag &&
              result.editHeaderCloseButtonWorks &&
              result.countChipVisibleAfterEnable &&
              result.editedCorrectly &&
              result.countChipVisibleAfterEdit &&
              result.deletedCorrectly &&
              result.countChipHiddenAfterDelete,
            {
              name: 'scheduled-task-config-lifecycle',
              message:
                '定时任务应覆盖创建与编辑、标题关闭按钮的可点击区域、关闭与取消确认、伙伴列表限高滚动、描述默认高度与独立滚动及任务完整闭环。',
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
