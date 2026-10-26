import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  ensureWorkbenchContentPanelExpanded,
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
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceContents: 'empty'
          })
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
            return rect.top >= scrollerRect.top - 2 && rect.top <= scrollerRect.top + 80
          })
          const chromeUnchanged =
            layoutBefore.sidebarTop != null &&
            layoutAfter.sidebarTop != null &&
            layoutBefore.composerTop != null &&
            layoutAfter.composerTop != null &&
            Math.abs(layoutBefore.sidebarTop - layoutAfter.sidebarTop) < 1 &&
            Math.abs(layoutBefore.composerTop - layoutAfter.composerTop) < 1
          await runtime.captureScreenshot({
            name: 'timeline-after-jump',
            message: '点击今天后最早消息贴顶，侧栏与 Composer 不跟着抖。'
          })

          const readChatTitlebar = () =>
            page.evaluate((selectors) => {
              const topbar = document.querySelector(`[data-testid="${selectors.topbar}"]`)
              if (!(topbar instanceof HTMLElement)) return null
              const rect = topbar.getBoundingClientRect()
              const toggle = topbar.querySelector(`[data-testid="${selectors.contentPanelToggle}"]`)
              return {
                height: rect.height,
                appRegion: getComputedStyle(topbar).getPropertyValue('-webkit-app-region'),
                blankHitRegions: [rect.left + 8, rect.left + rect.width / 2, rect.right - 8].map(
                  (x) => {
                    const hit = document.elementFromPoint(x, rect.top + rect.height / 2)
                    return hit ? getComputedStyle(hit).getPropertyValue('-webkit-app-region') : ''
                  }
                ),
                toggleAppRegion: toggle
                  ? getComputedStyle(toggle).getPropertyValue('-webkit-app-region')
                  : null
              }
            }, workbenchSelectors)
          const collapsedChatTitlebar = await readChatTitlebar()

          await ensureWorkbenchContentPanelExpanded(page)
          const expandedChatTitlebar = await readChatTitlebar()

          return {
            collapsedChatTitlebar,
            expandedChatTitlebar,
            labels,
            timelineScrollable,
            userMessageInView,
            chromeUnchanged,
            finalAnswerText: evidence.finalAnswerText
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            [result.collapsedChatTitlebar, result.expandedChatTitlebar].every(
              (titlebar) =>
                titlebar !== null &&
                Math.round(titlebar.height) === 44 &&
                titlebar.appRegion === 'drag' &&
                titlebar.blankHitRegions.every((region) => region === 'drag')
            ) && result.collapsedChatTitlebar?.toggleAppRegion === 'no-drag',
            {
              name: 'chat-titlebar-blank-space-remains-draggable',
              message:
                '聊天标题栏整体及左右留白、中部均应为拖动区，右侧面板开关保持可点击，对齐 WB-CORE-008-AC1。',
              data: {
                collapsed: result.collapsedChatTitlebar,
                expanded: result.expandedChatTitlebar
              }
            }
          )
          await runtime.assertThat(
            result.labels.includes('今天') &&
              !result.labels.includes('昨天') &&
              !result.labels.includes('前天') &&
              result.timelineScrollable === false &&
              result.userMessageInView &&
              result.chromeUnchanged &&
              result.finalAnswerText.trim().length > 0,
            {
              name: 'workbench-timeline-day-jump',
              message:
                '时间轴应仅展示有消息的今天，无独立滚动，点击今天应将最早消息贴顶且不带动侧栏/Composer。',
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
