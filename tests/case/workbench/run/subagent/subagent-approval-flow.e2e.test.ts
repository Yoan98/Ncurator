import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  assertNoWorkbenchFakeSignals,
  chatSelectors,
  collectWorkbenchAiRunEvents,
  collectWorkbenchLlmIoRecords,
  createPartnerThroughWorkbenchUi,
  decideWorkbenchApprovalBatch,
  getApprovalCard,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  selectWorkbenchExecutionPermission,
  selectWorkbenchModel,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'subagent-approval-flow'
const waitUntil = async (check: () => Promise<boolean>, timeout = 180_000): Promise<void> => {
  const deadline = Date.now() + timeout
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('等待子任务审批事实超时')
    await new Promise<void>((resolve) => setTimeout(resolve, 250))
  }
}
const exists = (target: string): Promise<boolean> =>
  fs.stat(target).then(
    () => true,
    () => false
  )
const cleanupCommand = (directory: string): string =>
  process.platform === 'win32'
    ? `Remove-Item -LiteralPath '${directory.replaceAll("'", "''")}' -Recurse -Force`
    : `rm -rf '${directory.replaceAll("'", "'\\''")}'`

describe('subagent approvals through the shared execution chain', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'run',
        groups: ['subagent'],
        description: '子审批 FIFO、允许拒绝指导、切换刷新及停止与崩溃恢复',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const setup = await setupWorkbenchWithTempWorkspace(runtime.page, {
            caseId: CASE_ID,
            workspaceName: '子任务审核',
            workspaceContents: 'empty'
          })
          const secondary = await createPartnerThroughWorkbenchUi(runtime.page, '审核观察')
          const switchTo = async (name: string) => {
            const row = getWorkbenchPrefixLocator(
              runtime.page,
              workbenchSelectors.partnerItemPrefix
            ).filter({ hasText: name })
            await row.click()
            await waitUntil(
              () => row.evaluate((item) => item.classList.contains('nc-sidebar-item-active')),
              10_000
            )
          }
          const phases: Array<{ mode: string; runId: string; childRunIds: string[] }> = []
          for (const mode of ['decisions', 'guide', 'stop', 'crash']) {
            const primary =
              mode === 'decisions'
                ? setup.workspaceName
                : await createPartnerThroughWorkbenchUi(runtime.page, `子审批-${mode}`)
            await switchTo(primary)
            await selectWorkbenchModel(runtime.page, setup.env.modelName)
            await selectWorkbenchExecutionPermission(runtime.page, '审核')
            const directories = ['A', 'B'].map((name) =>
              path.join(setup.workspace.rootPath, `cleanup-${mode}-${name}`)
            )
            for (const directory of directories) {
              await fs.mkdir(directory)
              await fs.writeFile(path.join(directory, 'cache.tmp'), 'disposable temporary cache')
            }
            const saved = path.join(setup.workspace.rootPath, `${mode}-saved.txt`)
            const commands = directories.map(cleanupCommand)
            const tasks = commands.map((command, index) => ({
              name: index === 0 ? '清理海豹' : '清理水獭',
              task: [
                ...(index === 0
                  ? [`先使用文本文件工具创建 ${saved}，内容为 SAVED_${mode}。这项保存操作已授权。`]
                  : []),
                '随后调用 terminal_run 请求执行以下清理命令。工具放行后会执行这条命令，实际效果是递归删除整个目标目录及其全部内容：',
                '```',
                command,
                '```',
                '本次操作必须先由我在人工审批卡中确认，当前尚未授权删除目录或其中任何文件，目录内可删除的范围尚未确认。请实际调用工具请求执行，让现有审核流程处理授权；只在回答中展示命令，不算完成此步骤。',
                `你的任务范围仅为 ${directories[index]}${index === 0 ? ` 和 ${saved}` : ''}。只核对本任务的路径，不列出或读取工作区其他文件及目录。`,
                '收到允许后完成清理；收到拒绝或指导后按反馈结束，不换一种方式删除。最终简要报告本任务的审批决定、目标目录状态及本任务保存的文件（如有）。'
              ].join('\n')
            }))
            const readActiveRun = () =>
              runtime.page.evaluate(async (partnerName) => {
                const partners = await window.api.partnerList()
                const partner = partners.find((item) => item.name === partnerName)
                if (!partner) throw new Error('主伙伴不存在')
                const snapshot = await window.api.partnerSnapshotGet({ partnerId: partner.id })
                return snapshot.activeRuns.find((run) => run.pendingApproval)
              }, primary)
            const start = Date.now()
            await sendWorkbenchMessage(
              runtime.page,
              [
                '请一次调用 delegate_to_subagent，使用下面参数派发两个独立任务。主伙伴等待子任务结果后，仅汇总本次审批决定和交付结果，不接管或重试清理；拒绝和指导均视为该项已处理。',
                '各 task 字段是完整任务原文，请原样传递给对应子 agent，保留具体命令、绝对路径及授权条件。',
                '```json',
                JSON.stringify({ tasks }, null, 2),
                '```'
              ].join('\n')
            )
            const readChildren = async (runId?: string) => {
              const events = await collectWorkbenchAiRunEvents(runtime)
              const id =
                runId ||
                events.find((event) => event.type === 'run_started' && event.createdAt >= start)
                  ?.runId
              return events.filter(
                (event): event is Extract<AiRunEvent, { type: 'subagent_updated' }> =>
                  event.type === 'subagent_updated' && event.runId === id
              )
            }
            await waitUntil(async () => {
              const children = new Map(
                (await readChildren()).map((event) => [event.update.childRunId, event.update])
              )
              const ended = [...children.values()].find((child) =>
                ['completed', 'failed', 'blocked', 'cancelled'].includes(child.status)
              )
              const events = await collectWorkbenchAiRunEvents(runtime)
              const blocked = events.find(
                (event) =>
                  event.createdAt >= start &&
                  ['human_interaction_required', 'run_failed', 'run_cancelled'].includes(event.type)
              )
              const directoryExists = await Promise.all(directories.map(exists))
              const deletedDirectories = directories.filter((_, index) => !directoryExists[index])
              if (ended || blocked || deletedDirectories.length > 0) {
                const reviews = (await collectWorkbenchLlmIoRecords(runtime))
                  .filter(
                    (record) =>
                      record.startedAt >= start && record.caller === 'human.terminal_review'
                  )
                  .map((record) => ({ runId: record.runId, output: record.output }))
                throw new Error(
                  `未进入两项子审批等待：${JSON.stringify({
                    child: ended && {
                      childRunId: ended.childRunId,
                      name: ended.name,
                      status: ended.status
                    },
                    blocker: blocked?.type,
                    deletedDirectories,
                    reviews
                  })}`
                )
              }
              return (
                [...children.values()].filter((child) => child.status === 'waiting_approval')
                  .length === 2 && Boolean((await readActiveRun())?.pendingApproval?.source)
              )
            })
            const active = (await readActiveRun())!
            const first = active.pendingApproval!
            expect(active.run.status).toBe('waiting_approval')
            const waiting = [
              ...new Map(
                (await readChildren(first.runId)).map((event) => [
                  event.update.childRunId,
                  event.update
                ])
              ).values()
            ]
            expect(waiting).toHaveLength(2)
            expect(waiting.every((child) => child.status === 'waiting_approval')).toBe(true)
            const reviewRequests = (await collectWorkbenchLlmIoRecords(runtime)).filter(
              (record) =>
                record.startedAt >= start &&
                record.caller === 'human.terminal_review' &&
                record.status === 'completed'
            )
            expect(reviewRequests.length).toBeGreaterThanOrEqual(2)
            for (const review of reviewRequests) {
              expect(review.user).not.toMatch(/^用途说明：/m)
              expect(review.user).toContain('命令 ID：')
            }
            expect(
              (await collectWorkbenchAiRunEvents(runtime)).filter(
                (event) => event.type === 'approval_batch_required' && event.runId === first.runId
              )
            ).toHaveLength(1)
            for (const directory of directories) expect(await exists(directory)).toBe(true)
            expect(await fs.readFile(saved, 'utf8')).toContain(`SAVED_${mode}`)
            const card = getApprovalCard(runtime.page)
            await card.waitFor({ state: 'visible' })
            expect(await card.textContent()).toContain(first.items[0].commandExplanation)
            expect(await card.getByTestId(chatSelectors.approvalBatchSource).textContent()).toBe(
              first.source!.name
            )
            expect(
              await getWorkbenchLocator(
                runtime.page,
                chatSelectors.approvalBatchGuideInput
              ).getAttribute('placeholder')
            ).toContain(first.source!.name)
            const row = runtime.page.locator(
              `[data-testid="subagent-task"][data-child-run-id="${first.source!.childRunId}"]`
            )
            expect(await row.locator('.nc-partner-avatar-animated').count()).toBe(0)
            const cloud = runtime.page.locator('[data-testid="subagent-thought"]:visible')
            await waitUntil(async () => {
              await runtime.page.mouse.move(0, 0)
              await row.hover()
              return cloud.isVisible()
            }, 10_000)
            expect(await cloud.textContent()).toContain('等待你审核操作')
            expect(await cloud.getByTestId('subagent-stream-dot').count()).toBe(0)
            await runtime.captureScreenshot({
              name: `subagent-approval-${mode}`,
              message: '审批来源、静止头像与等待气泡'
            })
            await runtime.page.mouse.move(0, 0)
            if (mode === 'decisions') {
              await getWorkbenchLocator(runtime.page, chatSelectors.approvalBatchGuideInput).fill(
                '尚未提交的草稿'
              )
              await switchTo(secondary)
              await getApprovalCard(runtime.page).waitFor({ state: 'hidden', timeout: 10_000 })
              await switchTo(primary)
              await getApprovalCard(runtime.page).waitFor({ state: 'visible' })
              expect((await readActiveRun())?.pendingApproval).toMatchObject({
                batchId: first.batchId,
                source: first.source
              })
              await runtime.page.reload()
              await switchTo(primary)
              await getApprovalCard(runtime.page).waitFor({ state: 'visible' })
              expect(
                await getApprovalCard(runtime.page)
                  .getByTestId(chatSelectors.approvalBatchSource)
                  .textContent()
              ).toBe(first.source!.name)
              await getWorkbenchLocator(runtime.page, chatSelectors.approvalBatchGuideInput).fill(
                '下一批应清除这份草稿'
              )
            }
            if (mode === 'stop' || mode === 'crash') {
              if (mode === 'stop') {
                await runtime.page
                  .getByRole('button', { name: '停止本次运行', exact: true })
                  .click()
                await waitUntil(async () => !(await readActiveRun()))
                await waitUntil(async () => {
                  const children = new Map(
                    (await readChildren(first.runId)).map((event) => [
                      event.update.childRunId,
                      event.update.status
                    ])
                  )
                  return [...children.values()].every((status) => status === 'cancelled')
                })
              } else {
                await runtime.restartApp({ crash: true })
                await switchTo(primary)
                expect(await readActiveRun()).toBeUndefined()
                await getWorkbenchPrefixLocator(
                  runtime.page,
                  workbenchSelectors.assistantProcessTogglePrefix
                )
                  .last()
                  .click()
                for (const child of waiting)
                  await runtime.page
                    .locator(
                      `[data-testid="subagent-task"][data-child-run-id="${child.childRunId}"][data-status="interrupted"]`
                    )
                    .waitFor({ state: 'visible' })
              }
              expect(await getApprovalCard(runtime.page).count()).toBe(0)
              const continuedPath = `${saved}.continued.md`
              const continuedStart = Date.now()
              await sendWorkbenchMessage(
                runtime.page,
                `继续：上一轮清理已经终止，不再执行清理。请查询未完成子 agent 并续接其中一位原会话，仅用文本文件工具读取 ${saved} 并将原文写入新报告 ${continuedPath}。所有缓存目录及原文件保持现状。`
              )
              await waitForWorkbenchAiRunCompletion(
                runtime,
                continuedStart,
                setup.env.modelName,
                300_000
              )
              const continued = (await collectWorkbenchAiRunEvents(runtime)).filter(
                (event): event is Extract<AiRunEvent, { type: 'subagent_updated' }> =>
                  event.type === 'subagent_updated' && event.createdAt >= continuedStart
              )
              expect(
                continued.some(
                  (event) =>
                    event.update.status === 'completed' &&
                    waiting.some(
                      (child) =>
                        child.agentId === event.update.agentId &&
                        child.childRunId !== event.update.childRunId
                    )
                )
              ).toBe(true)
              expect(await fs.readFile(continuedPath, 'utf8')).toContain(`SAVED_${mode}`)
              for (const directory of directories) expect(await exists(directory)).toBe(true)
            } else {
              if (mode === 'guide')
                for (let index = 0; index < first.items.length; index++) {
                  await getWorkbenchLocator(
                    runtime.page,
                    chatSelectors.approvalBatchGuideInput
                  ).fill('不删除目录，只报告其中的缓存文件，随后结束这项任务。')
                  await getWorkbenchLocator(
                    runtime.page,
                    chatSelectors.approvalBatchSubmitButton
                  ).click()
                }
              else
                await decideWorkbenchApprovalBatch(runtime, runtime.page, {
                  event: first,
                  action: 'approve'
                })
              await waitUntil(async () => {
                const next = (await readActiveRun())?.pendingApproval
                return Boolean(next && next.batchId !== first.batchId)
              })
              const next = (await readActiveRun())!.pendingApproval!
              expect(next.source!.childRunId).not.toBe(first.source!.childRunId)
              await waitUntil(
                async () =>
                  (await getApprovalCard(runtime.page)
                    .getByTestId(chatSelectors.approvalBatchSource)
                    .textContent()) === next.source!.name,
                10_000
              )
              expect(
                await getWorkbenchLocator(
                  runtime.page,
                  chatSelectors.approvalBatchGuideInput
                ).inputValue()
              ).toBe('')
              await decideWorkbenchApprovalBatch(runtime, runtime.page, {
                event: next,
                action: 'reject'
              })
              await waitForWorkbenchAiRunCompletion(runtime, start, setup.env.modelName, 300_000)
              const ended = await readChildren(first.runId)
              for (const child of waiting)
                expect(
                  ended.some(
                    (event) =>
                      event.update.childRunId === child.childRunId &&
                      event.update.status === 'completed'
                  )
                ).toBe(true)
              const approvedIndex = directories.findIndex((directory) =>
                first.items[0].command.includes(directory)
              )
              expect(approvedIndex).toBeGreaterThanOrEqual(0)
              for (const [index, directory] of directories.entries())
                expect(await exists(directory)).toBe(
                  !(mode === 'decisions' && index === approvedIndex)
                )
              expect(
                ended.filter(
                  (event) =>
                    event.update.action?.id === first.items[0].itemId &&
                    event.update.action.status === 'running'
                )
              ).toHaveLength(mode === 'decisions' ? 1 : 0)
              expect(
                ended.filter(
                  (event) =>
                    event.update.action?.id === next.items[0].itemId &&
                    event.update.action.status === 'running'
                )
              ).toHaveLength(0)
            }
            expect(await fs.readFile(saved, 'utf8')).toContain(`SAVED_${mode}`)
            phases.push({
              mode,
              runId: first.runId,
              childRunIds: waiting.map((child) => child.childRunId)
            })
          }
          await assertNoWorkbenchFakeSignals(runtime, await runtime.collectSignals())
          return { phases }
        },
        assert: async (result, runtime) => {
          runtime.assertThat(result.phases.length === 4, {
            name: 'subagent-approval-four-phases',
            message: '允许拒绝、指导、等待中停止及崩溃续聊通过真实 UI',
            data: { phases: result.phases }
          })
        }
      })
    },
    1_800_000
  )
})
