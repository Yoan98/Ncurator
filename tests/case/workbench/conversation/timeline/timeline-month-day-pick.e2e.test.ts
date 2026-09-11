import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  dismissWorkbenchLlmConfigMissingNotification,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  navigateToWorkbench,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'
import {
  DAY_MS,
  startOfLocalDay,
  startOfLocalMonth
} from '../../../../../src/shared/workbench/messageTimeline'

const execFileAsync = promisify(execFile)

const CASE_ID = 'timeline-month-day-pick'
const TIMELINE_SEED_PARTNER_NAME = '时间轴 · 预览'
const LATER_DAY_TEXT = '[timeline-seed] 约一个半月前次日'
const EARLIEST_DAY_TEXT = '[timeline-seed] 约一个半月前'

const seedTimelineIntoUserData = async (userDataDir: string): Promise<void> => {
  const dbPath = path.join(userDataDir, 'app.sqlite')
  await execFileAsync(
    process.execPath,
    [path.join(process.cwd(), 'scripts/dev/seed-partner-timeline.mjs'), '--db', dbPath, '--force'],
    { cwd: process.cwd() }
  )
}

const readTopUserMessage = async (
  page: import('playwright').Page
): Promise<{ text: string; inView: boolean }> =>
  page.evaluate(() => {
    const scroller = document.querySelector('.nc-document-scroll')
    if (!(scroller instanceof HTMLElement)) return { text: '', inView: false }
    const scrollerRect = scroller.getBoundingClientRect()
    const users = [...document.querySelectorAll('[data-testid^="workbench-user-message"]')]
    const atTop = users.find((element) => {
      const rect = element.getBoundingClientRect()
      return rect.top >= scrollerRect.top - 2 && rect.top <= scrollerRect.top + 80
    })
    const text = ((atTop instanceof HTMLElement ? atTop.innerText : '') || '').replace(/\s+/g, ' ')
    return { text, inView: Boolean(atTop) }
  })

const waitForTopUserMatching = async (
  page: import('playwright').Page,
  match: 'later' | 'earliest'
): Promise<void> => {
  await page.waitForFunction((kind) => {
    const scroller = document.querySelector('.nc-document-scroll')
    if (!(scroller instanceof HTMLElement)) return false
    const scrollerRect = scroller.getBoundingClientRect()
    const users = [...document.querySelectorAll('[data-testid^="workbench-user-message"]')]
    const atTop = users.find((element) => {
      const rect = element.getBoundingClientRect()
      return rect.top >= scrollerRect.top - 2 && rect.top <= scrollerRect.top + 80
    })
    const text = ((atTop instanceof HTMLElement ? atTop.innerText : '') || '').replace(/\s+/g, ' ')
    if (kind === 'later') return text.includes('[timeline-seed] 约一个半月前次日')
    return text.includes('[timeline-seed] 约一个半月前') && !text.includes('次日')
  }, match)
}

const readActiveDotSizes = async (
  page: import('playwright').Page
): Promise<{ active: number; inactive: number }> =>
  page.evaluate(() => {
    const active = document.querySelector(
      '.nc-message-timeline-row.is-active .nc-message-timeline-dot'
    )
    const inactive = document.querySelector(
      '.nc-message-timeline-row:not(.is-active) .nc-message-timeline-dot'
    )
    return {
      active: active instanceof HTMLElement ? active.getBoundingClientRect().width : 0,
      inactive: inactive instanceof HTMLElement ? inactive.getBoundingClientRect().width : 0
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
        groups: ['timeline'],
        description:
          '月节点 DatePicker 选天瞬时跳转，同一天可再选，关闭弹层不穿透跳到该月最早日。',
        fixtures: [],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          await navigateToWorkbench(runtime.page, { waitForSessionListText: false })
          const restarted = await runtime.restartApp({
            prepareUserData: seedTimelineIntoUserData
          })
          const { page } = restarted
          await navigateToWorkbench(page)
          await page.getByRole('button', { name: '稍后再说' }).click({ timeout: 3_000 }).catch(() => undefined)
          await dismissWorkbenchLlmConfigMissingNotification(page)
          await getWorkbenchPrefixLocator(page, workbenchSelectors.partnerItemPrefix)
            .filter({ hasText: TIMELINE_SEED_PARTNER_NAME })
            .first()
            .click()

          const timeline = getWorkbenchLocator(page, workbenchSelectors.timeline)
          await timeline.waitFor({ state: 'visible' })

          const laterDayStart = startOfLocalDay(Date.now()) - 44 * DAY_MS
          const monthStart = startOfLocalMonth(laterDayStart)
          const monthSearch = getWorkbenchLocator(
            page,
            `${workbenchSelectors.timelineItemPrefix}-search-month-${monthStart}`
          )
          await monthSearch.waitFor({ state: 'visible' })
          await monthSearch.click()

          const popup = page.locator('.nc-message-timeline-datepicker-popup').last()
          await popup.waitFor({ state: 'visible' })
          const enabledDays = popup.locator(
            '.ant-picker-cell-in-view:not(.ant-picker-cell-disabled)'
          )
          const enabledCount = await enabledDays.count()
          const disabledCount = await popup
            .locator('.ant-picker-cell-in-view.ant-picker-cell-disabled')
            .count()
          const pickedCell = enabledDays.last()
          const pickedTitle = (await pickedCell.getAttribute('title')) || ''
          await pickedCell.click()
          await popup.waitFor({ state: 'hidden' })
          await waitForTopUserMatching(page, 'later')

          const afterPick = await readTopUserMessage(page)
          const sizesAfterPick = await readActiveDotSizes(page)
          const monthNodeStillPresent = await getWorkbenchLocator(
            page,
            `${workbenchSelectors.timelineItemPrefix}-month-${monthStart}`
          ).isVisible()
          await runtime.captureScreenshot({
            name: 'timeline-after-month-day-pick',
            message: '从月节点搜索选较晚一天后，消息贴顶且轴仍是月节点。'
          })

          await page.evaluate(() => {
            const scroller = document.querySelector('.nc-document-scroll')
            if (scroller instanceof HTMLElement) scroller.scrollTop = scroller.scrollHeight
          })
          await page.waitForFunction(() => {
            const scroller = document.querySelector('.nc-document-scroll')
            if (!(scroller instanceof HTMLElement)) return false
            const scrollerRect = scroller.getBoundingClientRect()
            const users = [...document.querySelectorAll('[data-testid^="workbench-user-message"]')]
            const atTop = users.find((element) => {
              const rect = element.getBoundingClientRect()
              return rect.top >= scrollerRect.top - 2 && rect.top <= scrollerRect.top + 80
            })
            const text = ((atTop instanceof HTMLElement ? atTop.innerText : '') || '').replace(
              /\s+/g,
              ' '
            )
            return !text.includes('[timeline-seed] 约一个半月前次日')
          })
          const afterToday = await readTopUserMessage(page)

          await monthSearch.click()
          const popupAgain = page.locator('.nc-message-timeline-datepicker-popup').last()
          await popupAgain.waitFor({ state: 'visible' })
          const sameDayCell = pickedTitle
            ? popupAgain.locator(`.ant-picker-cell-in-view[title="${pickedTitle}"]`)
            : popupAgain.locator('.ant-picker-cell-in-view:not(.ant-picker-cell-disabled)').last()
          await sameDayCell.click()
          await popupAgain.waitFor({ state: 'hidden' })
          await waitForTopUserMatching(page, 'later')
          const afterRepick = await readTopUserMessage(page)

          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.timelineItemPrefix}-month-${monthStart}`
          ).evaluate((element) => {
            if (element instanceof HTMLElement) element.click()
          })
          await waitForTopUserMatching(page, 'earliest')
          const afterMonthClick = await readTopUserMessage(page)
          await page.waitForTimeout(250)
          const afterMonthClickSettled = await readTopUserMessage(page)
          await runtime.captureScreenshot({
            name: 'timeline-after-month-node-click',
            message: '点击月节点后稳定停在该月最早有消息日。'
          })

          return {
            enabledCount,
            disabledCount,
            pickedTitle,
            monthNodeStillPresent,
            afterPickText: afterPick.text,
            afterPickInView: afterPick.inView,
            afterTodayText: afterToday.text,
            afterRepickText: afterRepick.text,
            afterMonthClickText: afterMonthClick.text,
            afterMonthClickSettledText: afterMonthClickSettled.text,
            activeDotWidth: sizesAfterPick.active,
            inactiveDotWidth: sizesAfterPick.inactive
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.enabledCount >= 2 &&
              result.disabledCount > 0 &&
              result.monthNodeStillPresent &&
              result.afterPickInView &&
              result.afterPickText.includes(LATER_DAY_TEXT) &&
              !result.afterTodayText.includes(LATER_DAY_TEXT) &&
              result.afterRepickText.includes(LATER_DAY_TEXT) &&
              result.afterMonthClickText.includes(EARLIEST_DAY_TEXT) &&
              !result.afterMonthClickText.includes('次日') &&
              result.afterMonthClickSettledText === result.afterMonthClickText &&
              result.activeDotWidth > result.inactiveDotWidth,
            {
              name: 'workbench-timeline-month-day-pick',
              message:
                '月节点搜索应能选有消息的天并瞬时贴顶，同一天可再选，关闭弹层不得跳到该月最早日，高亮节点应更大。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS
  )
})
