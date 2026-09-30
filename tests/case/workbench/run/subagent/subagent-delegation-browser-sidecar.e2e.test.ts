import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { runE2ECase, type E2ETestRuntime } from '../../../../harness/e2e/run-e2e-case'
import {
  selectWorkbenchModel,
  setupWorkbenchWithTempWorkspace,
  sendWorkbenchMessage,
  collectWorkbenchAiRunEvents,
  waitForWorkbenchAiRunCompletion,
  createPartnerThroughWorkbenchUi,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  waitForApplyEntryByFileName,
  waitForWorkbenchApplyPanelReady,
  waitForWorkbenchApplyRecordStatus,
  assertNoWorkbenchFakeSignals,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'
import type { AiRunEvent } from '../../../../../src/shared/types'

const CASE_ID = 'subagent-delegation-browser-sidecar'
const waitUntil = async (check: () => Promise<boolean>, timeout = 240_000): Promise<void> => {
  const deadline = Date.now() + timeout
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('等待子任务事实超时')
    await new Promise<void>((resolve) => setTimeout(resolve, 250))
  }
}
const updates = async (runtime: E2ETestRuntime, started: number) => {
  const events = await collectWorkbenchAiRunEvents(runtime)
  const run = events.find((event) => event.type === 'run_started' && event.createdAt >= started)
  return events.filter(
    (event): event is Extract<AiRunEvent, { type: 'subagent_updated' }> =>
      event.type === 'subagent_updated' && event.runId === run?.runId
  )
}

// Real website input: forms send server receipts, source facts are rendered by JavaScript.
const createSite = async () => {
  const receipts: string[] = []
  const slow: http.ServerResponse[] = []
  let slowRequests = 0
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://localhost')
    if (url.pathname === '/submit') {
      const value = url.searchParams.get('value') || ''
      receipts.push(value)
      response.end(`已提交 ${value}`)
      return
    }
    if (url.pathname === '/slow') {
      slowRequests++
      slow.push(response)
      return
    }
    if (url.pathname === '/facts') {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(
        `<!doctype html><title>事实资料</title><main id="facts"></main><script>document.querySelector('#facts').textContent = '核验事实：${url.searchParams.get('marker') || '31415'}。' + '这是经页面脚本渲染的实际资料，请核对事实并记录来源。'.repeat(25)</script>`
      )
      return
    }
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(
      '<!doctype html><title>独立提交页面</title><label>任务内容<input id="value" aria-label="任务内容"></label><button id="submit">提交</button><p id="status">尚未提交</p><script>document.querySelector("#submit").onclick=async()=>{const value=document.querySelector("#value").value;document.querySelector("#status").textContent=await(await fetch("/submit?value="+encodeURIComponent(value))).text()}</script>'
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('网站端口不可用')
  return {
    url: `http://127.0.0.1:${address.port}`,
    receipts,
    getSlowRequests: () => slowRequests,
    close: async () => {
      slow.forEach((response) => response.destroy())
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

describe('subagent browser and sidecar real UI', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'run',
        groups: ['subagent'],
        description: '子任务独立标签、sidecar、展开回退、停止与崩溃续聊',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const site = await createSite()
          runtime.registerResource({
            name: 'subagent-real-site',
            phase: 'before-app-close',
            dispose: site.close
          })
          const setup = await setupWorkbenchWithTempWorkspace(runtime.page, {
            caseId: CASE_ID,
            workspaceName: '分头协作'
          })
          const primary = setup.workspaceName
          const secondary = await createPartnerThroughWorkbenchUi(runtime.page, '后台观察')
          await getWorkbenchPrefixLocator(runtime.page, workbenchSelectors.partnerItemPrefix)
            .filter({ hasText: primary })
            .click()
          await selectWorkbenchModel(runtime.page, setup.env.modelName)
          const config = path.join(setup.workspace.rootPath, 'subagent-checkout-config.ts')
          const baseline = await fs.readFile(config, 'utf8')
          const report = path.join(setup.workspace.rootPath, '网页交接.md')
          const started = Date.now()
          await sendWorkbenchMessage(
            runtime.page,
            `请找三位临时帮手并行分头处理，并由你最后整合：第一位在内置浏览器打开 ${site.url}，填写 ALPHA_731 并提交，再读取资料 ${site.url}/facts?marker=31415 并核对该数字，最后将 ${config} 中 timeoutMs 改为 3000，其他字段不动；第二位独立在内置浏览器打开同一个 ${site.url}，填写 BETA_892 并提交，再读取 ${site.url}/facts?marker=27182 核对该数字；第三位搜索 Python 官方 csv reader 说明并返回官方来源链接。他们各自使用自己的标签。你把两个提交结果、资料数字和官方来源写到 ${report}，检查后交付。`
          )
          await waitUntil(async () =>
            (await updates(runtime, started)).some((event) => event.update.status === 'running')
          )
          const childRow = runtime.page.getByTestId('subagent-task').first()
          await childRow.locator('summary').click()
          expect(await childRow.getAttribute('open')).not.toBeNull()
          await childRow.locator('summary').click()
          expect(await childRow.getAttribute('open')).toBeNull()
          const panelToggle = getWorkbenchLocator(
            runtime.page,
            workbenchSelectors.contentPanelToggle
          )
          if ((await panelToggle.getAttribute('aria-label')) === '收起右侧栏')
            await panelToggle.click()
          await getWorkbenchPrefixLocator(runtime.page, workbenchSelectors.partnerItemPrefix)
            .filter({ hasText: secondary })
            .click()
          await getWorkbenchPrefixLocator(runtime.page, workbenchSelectors.partnerItemPrefix)
            .filter({ hasText: primary })
            .click()
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            started,
            setup.env.modelName,
            900_000
          )
          expect(site.receipts).toContain('ALPHA_731')
          expect(site.receipts).toContain('BETA_892')
          expect(
            site.receipts.filter((value) => !['ALPHA_731', 'BETA_892'].includes(value))
          ).toHaveLength(0)
          const firstUpdates = await updates(runtime, started)
          expect(
            new Set(
              firstUpdates
                .filter((event) => event.update.status === 'completed')
                .map((event) => event.update.childRunId)
            ).size
          ).toBe(3)
          expect(
            firstUpdates.filter(
              (event) =>
                event.update.action?.toolName === 'web_search' &&
                event.update.action.status === 'completed'
            ).length
          ).toBeGreaterThanOrEqual(3)
          const reportText = await fs.readFile(report, 'utf8')
          expect(reportText).toContain('31415')
          expect(reportText).toContain('27182')
          expect(reportText).toMatch(/https:\/\/docs.python.org/)
          expect(await panelToggle.getAttribute('aria-label')).toBe('展开右侧栏')
          const processToggle = getWorkbenchPrefixLocator(
            runtime.page,
            workbenchSelectors.assistantProcessTogglePrefix
          ).last()
          await processToggle.click()
          expect(await runtime.page.getByTestId('subagent-task').count()).toBe(3)
          await runtime.page.getByTestId('subagent-task').first().locator('summary').click()
          expect(await runtime.page.getByTestId('subagent-action').count()).toBeGreaterThan(0)
          expect(
            await getWorkbenchPrefixLocator(
              runtime.page,
              workbenchSelectors.partnerItemPrefix
            ).count()
          ).toBe(2)
          await (
            await waitForApplyEntryByFileName(runtime.page, 'subagent-checkout-config.ts')
          ).click()
          await waitForWorkbenchApplyPanelReady(runtime.page)
          await getWorkbenchLocator(runtime.page, workbenchSelectors.applyRevertButton).click()
          await getWorkbenchLocator(
            runtime.page,
            workbenchSelectors.applyRevertConfirmButton
          ).click()
          await waitForWorkbenchApplyRecordStatus(runtime.page, 'reverted')
          expect(await fs.readFile(config, 'utf8')).toBe(baseline)

          const runInterruptedPhase = async (crash: boolean) => {
            const start = Date.now()
            const slowBefore = site.getSlowRequests()
            const saved = path.join(setup.workspace.rootPath, crash ? '崩溃前.txt' : '停止前.txt')
            await sendWorkbenchMessage(
              runtime.page,
              `找两位临时帮手同时处理：第一位创建 ${saved}，内容为 SAVED_${crash ? 'CRASH' : 'STOP'}，完成后立刻交付；第二位在内置浏览器打开 ${site.url}/slow，等待网页加载后汇报。你等待两项完成后整合。`
            )
            await waitUntil(
              async () =>
                site.getSlowRequests() > slowBefore &&
                (await updates(runtime, start)).some((event) => event.update.status === 'completed')
            )
            const before = await updates(runtime, start)
            const completed = before.find((event) => event.update.status === 'completed')!
            if (crash) {
              await runtime.restartApp({ crash: true })
              await getWorkbenchPrefixLocator(runtime.page, workbenchSelectors.partnerItemPrefix)
                .filter({ hasText: primary })
                .click()
              await getWorkbenchPrefixLocator(
                runtime.page,
                workbenchSelectors.assistantProcessTogglePrefix
              )
                .last()
                .click()
              await runtime.page
                .getByTestId('subagent-task')
                .filter({ hasText: '已中断' })
                .last()
                .waitFor({ state: 'visible' })
              expect(
                await runtime.page
                  .locator(`[data-child-run-id="${completed.update.childRunId}"]`)
                  .getAttribute('data-status')
              ).toBe('completed')
            } else {
              await getWorkbenchLocator(runtime.page, workbenchSelectors.cancelButton).click()
              await waitUntil(async () =>
                (await updates(runtime, start)).some((event) => event.update.status === 'cancelled')
              )
            }
            expect(await fs.readFile(saved, 'utf8')).toContain(crash ? 'SAVED_CRASH' : 'SAVED_STOP')
            const continueStart = Date.now()
            await sendWorkbenchMessage(
              runtime.page,
              `继续：保留已经保存的 ${saved}，未完成的网页改为 ${site.url}/facts?marker=94217。请创建新的临时帮手读取资料，并写到 ${saved}.continued.md，说明先前已保存结果和新的核验数字。`
            )
            await waitForWorkbenchAiRunCompletion(
              runtime,
              continueStart,
              setup.env.modelName,
              600_000
            )
            const continued = await updates(runtime, continueStart)
            expect(
              continued.some(
                (event) =>
                  event.update.status === 'completed' &&
                  !before.some((previous) => previous.update.childRunId === event.update.childRunId)
              )
            ).toBe(true)
            expect(await fs.readFile(`${saved}.continued.md`, 'utf8')).toContain('94217')
          }
          await runInterruptedPhase(false)
          await runInterruptedPhase(true)
          const signals = await runtime.collectSignals()
          await assertNoWorkbenchFakeSignals(runtime, signals)
          return { evidence, receipts: site.receipts, phases: 4 }
        },
        assert: async (result, runtime) => {
          runtime.assertThat(result.phases === 4, {
            name: 'subagent-four-phases',
            message: '独立网页与 sidecar、展开回退、停止、异常退出与续聊均通过真实 UI',
            data: { receipts: result.receipts }
          })
        }
      })
    },
    2_400_000
  )
})
