import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createWorkbenchNewSession,
  getWorkbenchLocator,
  recordWorkbenchAiEvidence,
  selectWorkbenchWorkspace,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'file-change-run-scope'
const FIRST_FILE = 'run-scope-first.txt'
const SECOND_FILE = 'run-scope-second.txt'

const writeFileViaTerminalPrompt = (fileName: string, contents: string): string => {
  const command =
    process.platform === 'win32'
      ? `Set-Content -LiteralPath '${fileName}' -Value '${contents}' -NoNewline`
      : `printf '${contents}' > ${fileName}`
  return `请只使用 terminal_run，在工作区根目录执行：${command}。不要修改其他文件。`
}

const getRunStarted = (events: import('../../../../../src/shared/types').AiRunEvent[]) => {
  const event = events.find(
    (item): item is Extract<import('../../../../../src/shared/types').AiRunEvent, { type: 'run_started' }> =>
      item.type === 'run_started'
  )
  if (!event) throw new Error('run_started event is missing')
  return event
}

const getApplyEntryForFile = async (page: import('playwright').Page, fileName: string) => {
  const entry = page
    .locator(`[data-testid^="${workbenchSelectors.assistantTurnApplyPrefix}-"]`)
    .filter({ hasText: fileName })
    .first()
  await entry.waitFor({ state: 'visible', timeout: 30_000 })
  return entry
}

const readChangedFileList = async (page: import('playwright').Page) => {
  await getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerToggle).click()
  const explorer = getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerOverlay)
  await explorer.waitFor({ state: 'visible', timeout: 30_000 })
  const text = ((await explorer.textContent()) || '').trim()
  await page.keyboard.press('Escape')
  return text
}

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['apply'],
        description:
          '真实 UI 在不同伙伴的两个 run 分别写入文件后，右侧本次运行改动不得串入另一个 run 的记录。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })

          const firstStartedAtMs = Date.now()
          await sendWorkbenchMessage(page, writeFileViaTerminalPrompt(FIRST_FILE, 'first-run'))
          const firstEvidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            firstStartedAtMs,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, firstEvidence, 0.8)
          const firstRun = getRunStarted(firstEvidence.events)
          const firstEntry = await getApplyEntryForFile(page, FIRST_FILE)
          const firstCardText = ((await firstEntry.textContent()) || '').trim()
          await firstEntry.click()
          const firstChangedFileList = await readChangedFileList(page)

          await createWorkbenchNewSession(page)
          await selectWorkbenchWorkspace(page, setup.workspaceName)
          const secondStartedAtMs = Date.now()
          await sendWorkbenchMessage(page, writeFileViaTerminalPrompt(SECOND_FILE, 'second-run'))
          const secondEvidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            secondStartedAtMs,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, secondEvidence, 0.8)
          const secondRun = getRunStarted(secondEvidence.events)
          const secondEntry = await getApplyEntryForFile(page, SECOND_FILE)
          const secondCardText = ((await secondEntry.textContent()) || '').trim()
          await secondEntry.click()
          const secondChangedFileList = await readChangedFileList(page)

          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${firstRun.partnerId}`
          ).click()
          const restoredFirstEntry = await getApplyEntryForFile(page, FIRST_FILE)
          await restoredFirstEntry.click()
          const restoredFirstChangedFileList = await readChangedFileList(page)

          return {
            firstRunId: firstRun.runId,
            secondRunId: secondRun.runId,
            firstPartnerId: firstRun.partnerId,
            secondPartnerId: secondRun.partnerId,
            firstCardText,
            secondCardText,
            firstChangedFileList,
            secondChangedFileList,
            restoredFirstChangedFileList,
            firstTerminalCalls: firstEvidence.events.filter(
              (event) => event.type === 'tool_call_started' && event.toolName === 'terminal_run'
            ).length,
            secondTerminalCalls: secondEvidence.events.filter(
              (event) => event.type === 'tool_call_started' && event.toolName === 'terminal_run'
            ).length
          }
        },
        assert: async (result, runtime) => {
          const firstListIsIsolated =
            result.firstChangedFileList.includes('本次运行改动 1') &&
            result.firstChangedFileList.includes(FIRST_FILE) &&
            !result.firstChangedFileList.includes(SECOND_FILE)
          const secondListIsIsolated =
            result.secondChangedFileList.includes('本次运行改动 1') &&
            result.secondChangedFileList.includes(SECOND_FILE) &&
            !result.secondChangedFileList.includes(FIRST_FILE)
          const restoredFirstListIsIsolated =
            result.restoredFirstChangedFileList.includes('本次运行改动 1') &&
            result.restoredFirstChangedFileList.includes(FIRST_FILE) &&
            !result.restoredFirstChangedFileList.includes(SECOND_FILE)

          await runtime.assertThat(
            result.firstRunId !== result.secondRunId &&
              result.firstPartnerId !== result.secondPartnerId &&
              result.firstCardText.includes(FIRST_FILE) &&
              !result.firstCardText.includes(SECOND_FILE) &&
              result.secondCardText.includes(SECOND_FILE) &&
              !result.secondCardText.includes(FIRST_FILE) &&
              firstListIsIsolated &&
              secondListIsIsolated &&
              restoredFirstListIsIsolated &&
              result.firstTerminalCalls >= 1 &&
              result.secondTerminalCalls >= 1,
            {
              name: 'workbench-file-change-run-scope',
              message:
                '每条 assistant 修改入口和右侧本次运行改动必须只显示自身 partnerId 与 runId 的文件记录。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS * 2
  )
})
