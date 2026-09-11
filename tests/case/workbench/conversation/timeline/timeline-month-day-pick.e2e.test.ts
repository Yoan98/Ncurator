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
const RECENT_DAY_TEXT = '[timeline-seed] 四天前（近一周内）'
const TODAY_TEXT = '[timeline-seed] 今天刚刚说的话'

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
  match: 'later' | 'earliest' | 'recent' | 'today'
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
    if (kind === 'recent') return text.includes('[timeline-seed] 四天前（近一周内）')
    if (kind === 'today') return text.includes('[timeline-seed] 今天刚刚说的话')
    return text.includes('[timeline-seed] 约一个半月前') && !text.includes('次日')
  }, match)
}

const waitForActiveTimelineItem = async (
  page: import('playwright').Page,
  testId: string
): Promise<void> => {
  await page.waitForFunction((id) => {
    const active = document.querySelector(
      '.nc-message-timeline-row.is-active [data-testid^="workbench-timeline-item-"]'
    )
    return active instanceof HTMLElement && active.getAttribute('data-testid') === id
  }, testId)
}

const readActiveTimelineItemTestId = async (page: import('playwright').Page): Promise<string> =>
  page.evaluate(() => {
    const active = document.querySelector(
      '.nc-message-timeline-row.is-active [data-testid^="workbench-timeline-item-"]'
    )
    return active instanceof HTMLElement ? active.getAttribute('data-testid') || '' : ''
  })

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
          '打开伙伴或滚到底部后最新日贴顶且轴高亮该日；近端日第一次点击即贴顶不闪回；月节点 DatePicker 选天可再选，关闭弹层不穿透跳到该月最早日。',
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

          const todayStart = startOfLocalDay(Date.now())
          const expectedTodayActiveId = `${workbenchSelectors.timelineItemPrefix}-day-${todayStart}`
          await waitForTopUserMatching(page, 'today')
          await waitForActiveTimelineItem(page, expectedTodayActiveId)
          const afterOpen = await readTopUserMessage(page)
          const afterOpenActiveId = await readActiveTimelineItemTestId(page)

          const recentDayStart = startOfLocalDay(Date.now()) - 3 * DAY_MS
          const recentDayNode = getWorkbenchLocator(
            page,
            `${workbenchSelectors.timelineItemPrefix}-day-${recentDayStart}`
          )
          await recentDayNode.waitFor({ state: 'visible' })
          await recentDayNode.click()
          await waitForTopUserMatching(page, 'recent')
          await waitForActiveTimelineItem(
            page,
            `${workbenchSelectors.timelineItemPrefix}-day-${recentDayStart}`
          )
          const afterRecentClick = await readTopUserMessage(page)
          const afterRecentActiveId = await readActiveTimelineItemTestId(page)
          await page.waitForTimeout(300)
          const afterRecentSettled = await readTopUserMessage(page)
          const afterRecentSettledActiveId = await readActiveTimelineItemTestId(page)
          await runtime.captureScreenshot({
            name: 'timeline-after-recent-day-click',
            message: '近端日节点第一次点击后目标日贴顶，高亮不闪回月节点。'
          })

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
          await waitForTopUserMatching(page, 'today')
          await waitForActiveTimelineItem(page, expectedTodayActiveId)
          const afterScrollBottom = await readTopUserMessage(page)
          const afterScrollBottomActiveId = await readActiveTimelineItemTestId(page)
          await runtime.captureScreenshot({
            name: 'timeline-after-scroll-bottom',
            message: '滚到底部后今天贴顶，轴高亮今天。'
          })

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
            expectedTodayActiveId,
            afterOpenText: afterOpen.text,
            afterOpenInView: afterOpen.inView,
            afterOpenActiveId,
            expectedRecentActiveId: `${workbenchSelectors.timelineItemPrefix}-day-${recentDayStart}`,
            afterRecentClickText: afterRecentClick.text,
            afterRecentClickInView: afterRecentClick.inView,
            afterRecentActiveId,
            afterRecentSettledText: afterRecentSettled.text,
            afterRecentSettledActiveId,
            afterPickText: afterPick.text,
            afterPickInView: afterPick.inView,
            afterScrollBottomText: afterScrollBottom.text,
            afterScrollBottomInView: afterScrollBottom.inView,
            afterScrollBottomActiveId,
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
              result.afterOpenInView &&
              result.afterOpenText.includes(TODAY_TEXT) &&
              result.afterOpenActiveId === result.expectedTodayActiveId &&
              result.afterRecentClickInView &&
              result.afterRecentClickText.includes(RECENT_DAY_TEXT) &&
              result.afterRecentSettledText === result.afterRecentClickText &&
              result.afterRecentActiveId === result.expectedRecentActiveId &&
              result.afterRecentSettledActiveId === result.expectedRecentActiveId &&
              result.afterPickInView &&
              result.afterPickText.includes(LATER_DAY_TEXT) &&
              result.afterScrollBottomInView &&
              result.afterScrollBottomText.includes(TODAY_TEXT) &&
              result.afterScrollBottomActiveId === result.expectedTodayActiveId &&
              result.afterRepickText.includes(LATER_DAY_TEXT) &&
              result.afterMonthClickText.includes(EARLIEST_DAY_TEXT) &&
              !result.afterMonthClickText.includes('次日') &&
              result.afterMonthClickSettledText === result.afterMonthClickText &&
              result.activeDotWidth > result.inactiveDotWidth,
            {
              name: 'workbench-timeline-month-day-pick',
              message:
                '打开或滚到底部后今天应贴顶且轴高亮今天；近端日第一次点击应贴顶且不闪回月；月节点搜索应能选有消息的天并瞬时贴顶，同一天可再选，关闭弹层不得跳到该月最早日，高亮节点应更大。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS
  )
})
