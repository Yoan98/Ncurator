import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  collectWorkbenchAiRunEvents,
  decideWorkbenchApprovalBatch,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'terminal-unicode-file-list'
const CHINESE_DIRECTORY = '中文目录'
const CHINESE_FILE = 'sample-edit_中文.docx'

const isApprovalRequired = (
  event: AiRunEvent
): event is Extract<AiRunEvent, { type: 'approval_batch_required' }> =>
  event.type === 'approval_batch_required'

describe('workbench terminal unicode e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'run',
        groups: ['process'],
        description: '真实 Electron 与真实 AI 通过终端读取中文目录和中文文件名。',
        fixtures: ['tests/fixtures/workspace'],
        launchMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const setup = await setupWorkbenchWithTempWorkspace(runtime.page, {
            caseId: CASE_ID,
            rootBindingMode: 'ipc'
          })
          await fs.mkdir(path.join(setup.workspace.rootPath, CHINESE_DIRECTORY))
          await fs.writeFile(path.join(setup.workspace.rootPath, CHINESE_FILE), 'unicode fixture')
          const startedAtMs = Date.now()
          const handledApprovals = new Set<string>()

          try {
            await sendWorkbenchMessage(
              runtime.page,
              `请只使用 terminal_run 执行 ls -1 查看工作区根目录，然后明确写出目录名“${CHINESE_DIRECTORY}”和文件名“${CHINESE_FILE}”。不要猜测文件名。`
            )

            const deadline = Date.now() + WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
            let events: AiRunEvent[] = []
            for (;;) {
              events = await collectWorkbenchAiRunEvents(runtime)
              const approval = events
                .filter(isApprovalRequired)
                .find((event) => !handledApprovals.has(event.batchId))
              if (approval) {
                handledApprovals.add(approval.batchId)
                await decideWorkbenchApprovalBatch(runtime, runtime.page, {
                  event: approval,
                  action: 'approve'
                })
                continue
              }
              const failed = events.find((event) => event.type === 'run_failed')
              if (failed?.type === 'run_failed') throw new Error(failed.message)
              if (events.some((event) => event.type === 'run_completed')) break
              if (Date.now() >= deadline) throw new Error('terminal unicode flow timed out')
              await runtime.page.waitForTimeout(500)
            }

            const finalAnswerText =
              events
                .filter(
                  (event): event is Extract<AiRunEvent, { type: 'answer_completed' }> =>
                    event.type === 'answer_completed'
                )
                .at(-1)?.text || ''
            const terminalResults = events
              .filter(
                (event): event is Extract<AiRunEvent, { type: 'tool_call_result' }> =>
                  event.type === 'tool_call_result' && event.toolName === 'terminal_run'
              )
              .map((event) => JSON.stringify(event.result || {}))
              .join('\n')

            recordWorkbenchAiEvidence(
              runtime,
              {
                modelName: setup.env.modelName,
                durationMs: Date.now() - startedAtMs,
                events,
                finalAnswerText
              },
              0.9
            )

            return {
              finalAnswerText,
              terminalResults,
              terminalRunCalled: events.some(
                (event) => event.type === 'tool_call_started' && event.toolName === 'terminal_run'
              )
            }
          } finally {
            await setup.workspace.cleanup()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.terminalRunCalled &&
              result.terminalResults.includes(CHINESE_DIRECTORY) &&
              result.terminalResults.includes(CHINESE_FILE) &&
              result.finalAnswerText.includes(CHINESE_DIRECTORY) &&
              result.finalAnswerText.includes(CHINESE_FILE) &&
              !result.terminalResults.includes('????'),
            {
              name: 'workbench-real-terminal-preserves-unicode-file-names',
              message: '真实终端工具输出和最终答复都应保留完整中文文件名，不能变成问号。',
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
