import { describe, it } from 'vitest'
import type { Page } from 'playwright'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchPrefixLocator,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForLatestAssistantFinalAnswerText,
  waitForLatestAssistantProcess,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'
import type { AiRunEvent } from '../../../../../src/shared/types'

const CASE_ID = 'ai-process-stream-and-final-answer'
const PROMPT =
  '请只依据当前工作区里的工作目录资料，整理对外口径确认结论：风险状态、主负责人、Bob 的后续动作。回答必须包含 Alice 和 Bob。'

type ActivityPanelSnapshot = {
  summaryText: string
  itemTexts: string[]
  hasChevronAffordances: boolean
  summaryTruncates: boolean
}

type ProcessRenderSnapshot = {
  thoughtCount: number
  activityPanels: ActivityPanelSnapshot[]
  standaloneTexts: string[]
  processRootText: string
}

const HIDDEN_PROCESS_TOOLS = new Set(['update_plan'])

const collectProcessRenderSnapshot = async (page: Page): Promise<ProcessRenderSnapshot> => {
  const processRoot = getWorkbenchPrefixLocator(page, workbenchSelectors.assistantProcessPrefix).last()
  await processRoot.waitFor({ state: 'visible', timeout: 30_000 })
  const processRootText = ((await processRoot.textContent()) || '').trim()
  const thoughtCount = await processRoot.getByTestId(workbenchSelectors.assistantThoughts).count()

  const blocks = getWorkbenchPrefixLocator(page, workbenchSelectors.assistantProcessItemPrefix)
  const blockCount = await blocks.count()
  const activityPanels: ActivityPanelSnapshot[] = []
  const standaloneTexts: string[] = []

  for (let index = 0; index < blockCount; index += 1) {
    const block = blocks.nth(index)
    const className = (await block.getAttribute('class')) || ''
    const isActivityPanel = className.includes('group/execution')
    const body = block.locator(':scope > summary + div')
    const hasExpandableBody = (await body.count()) > 0

    if (!isActivityPanel) {
      const text = ((await block.textContent()) || '').trim()
      if (text) standaloneTexts.push(text)
      continue
    }

    if (hasExpandableBody) {
      await block.evaluate((element) => {
        element.setAttribute('open', '')
      })
    }
    const summaryText = ((await block.locator(':scope > summary').textContent()) || '').trim()
    const itemTexts = hasExpandableBody
      ? (await body.locator(':scope > div').allTextContents())
          .map((text) => text.trim())
          .filter(Boolean)
      : []
    const hasChevronAffordances = (await block.locator(':scope > summary svg').count()) >= 1
    const summaryTruncates = (await block.locator(':scope > summary .truncate').count()) > 0
    activityPanels.push({
      summaryText,
      itemTexts,
      hasChevronAffordances,
      summaryTruncates
    })
  }

  return {
    thoughtCount,
    activityPanels,
    standaloneTexts,
    processRootText
  }
}

const listVisibleToolNames = (events: AiRunEvent[]): string[] =>
  Array.from(
    new Set(
      events
        .filter(
          (
            event
          ): event is Extract<AiRunEvent, { type: 'tool_call_started' | 'tool_call_result' }> =>
            (event.type === 'tool_call_started' || event.type === 'tool_call_result') &&
            !HIDDEN_PROCESS_TOOLS.has(event.toolName)
        )
        .map((event) => event.toolName)
    )
  )

/** Activity header: merge by tool kind; ≤3 kinds → short text /「N 次」/并但; >3 kinds → 已完成 n 项. */
const isCountOnlyActivityHeader = (summaryText: string): boolean =>
  /^已完成\s+\d+\s*项$/u.test(summaryText) ||
  /^\d+\s*项操作中有部分失败$/u.test(summaryText) ||
  /^\d+\s*项操作执行失败$/u.test(summaryText)

const isShortActivityHeader = (summaryText: string, itemCount: number): boolean => {
  if (itemCount <= 0) return summaryText.length > 0
  if (summaryText.includes('，')) return false
  // Old wording must not appear.
  if (/正在执行\s+\d+\s*项操作|已完成\s+\d+\s*项操作/u.test(summaryText)) return false

  if (isCountOnlyActivityHeader(summaryText)) {
    // Count form requires enough items to exceed 3 merged kinds.
    return itemCount > 3
  }

  if (/项操作/u.test(summaryText)) return false

  if (itemCount >= 2) {
    // Same-kind merge uses「N 次」; multi-kind uses 并/但.
    return /并|但|\d+\s*次/u.test(summaryText)
  }
  return summaryText.length > 0
}

const sampleThinkingWaitEarly = async (
  page: Page,
  processLocator: Awaited<ReturnType<typeof waitForLatestAssistantProcess>>,
  timeoutMs = 12_000
): Promise<{ sawThinkingWait: boolean; processTextDuringRun: string }> => {
  const deadline = Date.now() + timeoutMs
  let processTextDuringRun = ((await processLocator.textContent()) || '').trim()
  let sawThinkingWait = /让俺想想/u.test(processTextDuringRun)
  while (Date.now() < deadline && !sawThinkingWait) {
    processTextDuringRun = ((await processLocator.textContent()) || '').trim()
    if (/让俺想想/u.test(processTextDuringRun)) {
      sawThinkingWait = true
      break
    }
    const activityCount = await processLocator.locator('details.group\\/execution').count()
    if (activityCount > 0) break
    await page.waitForTimeout(120)
  }
  if (!sawThinkingWait) {
    processTextDuringRun = ((await processLocator.textContent()) || '').trim()
    sawThinkingWait = /让俺想想/u.test(processTextDuringRun)
  }
  return { sawThinkingWait, processTextDuringRun }
}

describe('workbench run e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'run',
        groups: ['process'],
        description:
          '真实 AI 总结 workspace 事实，验证 Thought/Activity 过程层渲染、工具平铺、header 规则与最终回答收口。',
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
          const processLocator = await waitForLatestAssistantProcess(page)
          const earlySample = await sampleThinkingWaitEarly(page, processLocator)
          const retryAndThinkingCoexist =
            /正在重试/u.test(earlySample.processTextDuringRun) &&
            /让俺想想/u.test(earlySample.processTextDuringRun)
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          const finalAnswerText = await waitForLatestAssistantFinalAnswerText(page)
          recordWorkbenchAiEvidence(runtime, evidence, 0.85)
          const processRender = await collectProcessRenderSnapshot(page)
          const visibleToolNames = listVisibleToolNames(evidence.events)
          return {
            sawThinkingWait: earlySample.sawThinkingWait,
            processTextDuringRun: earlySample.processTextDuringRun,
            retryAndThinkingCoexist,
            thinkingStuckAfterComplete: /让俺想想/u.test(processRender.processRootText),
            processRender,
            visibleToolNames,
            finalAnswerText,
            eventTypes: evidence.events.map((event) => event.type)
          }
        },
        assert: async (result, runtime) => {
          const panels = result.processRender.activityPanels
          const allItemTexts = panels.flatMap((panel) => panel.itemTexts)
          const allSummaryTexts = panels.map((panel) => panel.summaryText)
          const hasTools = result.visibleToolNames.length > 0
          const hasLearnSkill = result.visibleToolNames.includes('learn_skill')
          const hasDocxTool = result.visibleToolNames.some((name) => name.startsWith('docx_'))
          const headerRulesOk = panels.every((panel) =>
            isShortActivityHeader(panel.summaryText, panel.itemTexts.length)
          )
          const noFinalizingWait = !/让俺收尾|基本完成了/u.test(result.processRender.processRootText)
          const noColonItemLabels = allItemTexts.every((text) => !text.includes('：'))
          const activityStructureOk =
            !hasTools ||
            (panels.length > 0 &&
              panels.every(
                (panel) =>
                  panel.itemTexts.length > 0 &&
                  panel.hasChevronAffordances &&
                  panel.summaryTruncates
              ))
          const learnSkillCopyOk =
            !hasLearnSkill ||
            allItemTexts.some((text) => /已学会|正在学习/u.test(text)) ||
            allSummaryTexts.some((text) => /已学会|正在学习|已完成\s+\d+\s*项|技能/u.test(text))
          const docxCopyOk =
            !hasDocxTool ||
            allItemTexts.some((text) => text.includes('Word 文档')) ||
            allSummaryTexts.some(
              (text) => text.includes('Word 文档') || /已完成\s+\d+\s*项/u.test(text)
            )
          const thinkingSegmentOk =
            !result.retryAndThinkingCoexist &&
            !result.thinkingStuckAfterComplete &&
            (result.sawThinkingWait ||
              hasTools ||
              result.processRender.thoughtCount > 0 ||
              result.processTextDuringRun.length > 0)

          await runtime.assertThat(
            result.processTextDuringRun.length > 0 &&
              thinkingSegmentOk &&
              noFinalizingWait &&
              result.eventTypes.includes('answer_completed') &&
              result.eventTypes.includes('run_completed') &&
              /Alice|合规负责人/u.test(result.finalAnswerText) &&
              /Bob|财务接口人/u.test(result.finalAnswerText) &&
              !/chain[- ]?of[- ]?thought|思维链|<thinking|<\/thinking>/iu.test(
                result.finalAnswerText
              ) &&
              activityStructureOk &&
              headerRulesOk &&
              noColonItemLabels &&
              learnSkillCopyOk &&
              docxCopyOk,
            {
              name: 'workbench-ai-process-activity-render-real',
              message:
                '真实 AI run 应渲染 Thought/Activity 过程层（header 同类归并/并但/>3 类已完成 n 项、展开平铺、无收尾等待层、让俺想想不卡在完成后），并产出围绕工作区事实的最终 markdown，对齐 WB-COMPOSER-003、WB-COMPOSER-009、WB-COMPOSER-014、WB-CORE-005、WB-CORE-006。',
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
