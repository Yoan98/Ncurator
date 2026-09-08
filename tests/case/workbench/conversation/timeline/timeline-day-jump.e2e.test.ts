import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'
import { startOfLocalDay } from '../../../../../src/shared/workbench/messageTimeline'

const CASE_ID = 'timeline-day-jump'
const PROMPT = '请只回复 ok，用于时间轴跳转测试。'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['timeline'],
        description: '有消息后时间轴展示今天节点，点击后跳到当天最早一条消息。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(page, PROMPT)
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.6)

          const timeline = getWorkbenchLocator(page, workbenchSelectors.timeline)
          await timeline.waitFor({ state: 'visible' })
          await runtime.captureScreenshot({
            name: 'timeline-single-today',
            message: '仅今天节点：实线从最新节点向上渐隐，节点下方无线。'
          })
          const todayStart = startOfLocalDay(Date.now())
          const labels = ((await timeline.textContent()) || '').replace(/\s+/g, '')
          const timelineScrollable = await timeline.evaluate((element) => {
            const style = window.getComputedStyle(element)
            return (
              (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
              element.scrollHeight > element.clientHeight + 1
            )
          })
          const layoutBefore = await page.evaluate(() => {
            const sidebar = document.querySelector('[data-testid="workbench-sidebar"]')
            const composer = document.querySelector('[data-testid="workbench-composer-shell"]')
            const scroller = document.querySelector('.nc-document-scroll')
            return {
              sidebarTop: sidebar?.getBoundingClientRect().top ?? null,
              composerTop: composer?.getBoundingClientRect().top ?? null,
              scrollTop: scroller instanceof HTMLElement ? scroller.scrollTop : null
            }
          })
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.timelineItemPrefix}-day-${todayStart}`
          ).click()
          await page.waitForTimeout(400)
          const layoutAfter = await page.evaluate(() => {
            const sidebar = document.querySelector('[data-testid="workbench-sidebar"]')
            const composer = document.querySelector('[data-testid="workbench-composer-shell"]')
            const scroller = document.querySelector('.nc-document-scroll')
            return {
              sidebarTop: sidebar?.getBoundingClientRect().top ?? null,
              composerTop: composer?.getBoundingClientRect().top ?? null,
              scrollTop: scroller instanceof HTMLElement ? scroller.scrollTop : null
            }
          })
          const userMessage = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.userMessagePrefix
          ).first()
          await userMessage.waitFor({ state: 'visible' })
          const userMessageInView = await userMessage.evaluate((element) => {
            const scroller = document.querySelector('.nc-document-scroll')
            if (!(scroller instanceof HTMLElement)) return false
            const scrollerRect = scroller.getBoundingClientRect()
            const rect = element.getBoundingClientRect()
            return rect.top >= scrollerRect.top && rect.bottom <= scrollerRect.bottom + 80
          })
          const layoutUnchanged =
            layoutBefore.sidebarTop != null &&
            layoutAfter.sidebarTop != null &&
            layoutBefore.composerTop != null &&
            layoutAfter.composerTop != null &&
            layoutBefore.scrollTop != null &&
            layoutAfter.scrollTop != null &&
            Math.abs(layoutBefore.sidebarTop - layoutAfter.sidebarTop) < 1 &&
            Math.abs(layoutBefore.composerTop - layoutAfter.composerTop) < 1 &&
            Math.abs(layoutBefore.scrollTop - layoutAfter.scrollTop) < 1
          await runtime.captureScreenshot({
            name: 'timeline-after-jump',
            message: '点击今天后消息区落到当天最早一条，侧栏与 Composer 不跟着抖。'
          })

          return {
            labels,
            timelineScrollable,
            userMessageInView,
            layoutUnchanged,
            finalAnswerText: evidence.finalAnswerText
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.labels.includes('今天') &&
              !result.labels.includes('昨天') &&
              !result.labels.includes('前天') &&
              result.timelineScrollable === false &&
              result.userMessageInView &&
              result.layoutUnchanged &&
              result.finalAnswerText.trim().length > 0,
            {
              name: 'workbench-timeline-day-jump',
              message:
                '时间轴应仅展示有消息的今天，无独立滚动，点击已在视口内的今天不带动侧栏/Composer。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
