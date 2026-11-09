import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiEvent,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'run-telemetry-production-isolation'
const queued = '补充：最后只列出关键点。'
const readOutbox = async (directory: string) =>
  readFile(path.join(directory, 'telemetry.json'), 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return null
    throw error
  })

describe('workbench telemetry production isolation', () => {
  it(CASE_ID, async () => {
    await runE2ECase({
      caseId: CASE_ID, domain: 'workbench', suite: 'run', groups: ['process'],
      description: '真实运行、追加及停止保持原流程，E2E 不产生生产埋点。',
      fixtures: [], serviceMode: 'real', execution: 'live', windowMode: 'visible', runMode: 'single',
      execute: async runtime => {
        const { page } = runtime
        const before = await readOutbox(runtime.userDataDir)
        const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID, workspaceContents: 'empty' })
        const input = path.join(setup.workspace.rootPath, 'telemetry-input.txt')
        await writeFile(input, '本次测试仅使用合成资料。\n', 'utf8')
        await sendWorkbenchMessage(page, `请用工具读取 ${input}，然后用一句话总结。`)
        const completed = await waitForWorkbenchAiEvent(runtime, { name: 'completed-run', matches: event => event.type === 'run_completed' })
        await sendWorkbenchMessage(page, '请逐条说明 50 种整理本地文档的办法，每条写 100 字。')
        const running = await waitForWorkbenchAiEvent(runtime, { name: 'second-run-started', matches: event => event.type === 'run_started' && event.runId !== completed.runId })
        await sendWorkbenchMessage(page, queued)
        await page.locator('[data-message-pending="true"]').filter({ hasText: queued }).waitFor({ state: 'visible', timeout: 15_000 })
        await getWorkbenchLocator(page, workbenchSelectors.sendButton).click()
        const cancelled = await waitForWorkbenchAiEvent(runtime, { name: 'cancelled-run', matches: event => event.type === 'run_cancelled' && event.runId === running.runId })
        return { completed: completed.type, cancelled: cancelled.type, queueUnchanged: before === await readOutbox(runtime.userDataDir) }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.completed === 'run_completed' && result.cancelled === 'run_cancelled' && result.queueUnchanged, {
          name: 'live-runs-without-production-telemetry', message: '实际完成、追加和停止成功，E2E 没有写入生产待发埋点。', data: result
        })
      }
    })
  }, WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS)
})
