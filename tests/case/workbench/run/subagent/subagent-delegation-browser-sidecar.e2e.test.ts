import type { Locator } from 'playwright'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { runE2ECase, type E2ETestRuntime } from '../../../../harness/e2e/run-e2e-case'
import {
  selectWorkbenchModel,
  selectWorkbenchExecutionPermission,
  selectWorkbenchResourceMenuItem,
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

const assertCloudTextInside = async (cloud: Locator): Promise<void> => {
  expect(
    await cloud.evaluate((element) => {
      const lines = element.querySelector<HTMLElement>('.nc-subagent-thought-lines')!
      const outline = element.querySelector<SVGPathElement>('.nc-subagent-thought-outline path')!
      const inverse = outline.getScreenCTM()!.inverse()
      const bounds = lines.getBoundingClientRect()
      const corners = [
        [bounds.left, bounds.top],
        [bounds.right, bounds.top],
        [bounds.left, bounds.bottom],
        [bounds.right, bounds.bottom]
      ]
      return (
        corners.every(([x, y]) =>
          outline.isPointInFill(new DOMPoint(x, y).matrixTransform(inverse))
        ) &&
        lines.scrollWidth <= lines.clientWidth &&
        getComputedStyle(lines).overflowX === 'hidden'
      )
    })
  ).toBe(true)
}

// Real website input: forms send server receipts, source facts are rendered by JavaScript.
const createSite = async () => {
  const receipts: string[] = []
  const instances = new Map<string, string>()
  const rendered: string[] = []
  const slow: http.ServerResponse[] = []
  let slowRequests = 0
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://localhost')
    if (url.pathname === '/submit') {
      if (request.method !== 'POST') {
        response.writeHead(405)
        response.end('需要通过页面提交')
        return
      }
      let body = ''
      request.on('data', (chunk) => {
        body += chunk.toString()
      })
      request.on('end', () => {
        try {
          const payload = JSON.parse(body) as { value?: string; instance?: string }
          if (
            typeof payload.value !== 'string' ||
            typeof payload.instance !== 'string' ||
            !payload.instance
          )
            throw new Error('missing page instance')
          receipts.push(payload.value)
          instances.set(payload.value, payload.instance)
          response.setHeader('content-type', 'text/plain; charset=utf-8')
          response.end(`已提交 ${payload.value}`)
        } catch {
          response.writeHead(400)
          response.end('提交内容不完整')
        }
      })
      return
    }
    if (url.pathname === '/render') {
      rendered.push(url.searchParams.get('marker') || '')
      response.end('ok')
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
        `<!doctype html><title>事实资料</title><main><h1>事实核验资料</h1><p id="facts"></p></main><script>document.querySelector('#facts').textContent = '核验事实：${url.searchParams.get('marker') || '31415'}。' + '这是经页面脚本渲染的实际资料，请核对事实并记录来源。'.repeat(25); fetch('/render?marker=${url.searchParams.get('marker') || '31415'}')</script>`
      )
      return
    }
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(
      '<!doctype html><title>独立提交页面</title><label>任务内容<input id="value" aria-label="任务内容"></label><button id="submit">提交</button><p id="status">尚未提交</p><script>sessionStorage.instance ||= crypto.randomUUID(); document.querySelector("#submit").onclick=async()=>{const value=document.querySelector("#value").value;document.querySelector("#status").textContent=await(await fetch("/submit",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({value,instance:sessionStorage.instance})})).text()}</script>'
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('网站端口不可用')
  return {
    url: `http://127.0.0.1:${address.port}`,
    receipts,
    instances,
    rendered,
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
        description: '子任务独立标签、sidecar、头像气泡与统一回退、停止与崩溃续聊',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        extraEnv: { NCURATOR_WEB_SEARCH_LOOPBACK_FETCH: '0' },
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
          await selectWorkbenchExecutionPermission(runtime.page, '完全访问')
          const config = path.join(setup.workspace.rootPath, 'subagent-checkout-config.ts')
          const baseline = await fs.readFile(config, 'utf8')
          const report = path.join(setup.workspace.rootPath, '网页交接.md')
          const screenshot = path.join(setup.workspace.rootPath, '表单核验.png')
          const initialPanelToggle = getWorkbenchLocator(
            runtime.page,
            workbenchSelectors.contentPanelToggle
          )
          if ((await initialPanelToggle.getAttribute('aria-label')) === '展开右侧栏')
            await initialPanelToggle.click()
          const fileFilter = runtime.page.getByPlaceholder('筛选文件…')
          if (!(await fileFilter.isVisible().catch(() => false))) {
            const explorerToggle = getWorkbenchLocator(
              runtime.page,
              workbenchSelectors.workspaceExplorerToggle
            )
            if (await explorerToggle.isVisible().catch(() => false)) await explorerToggle.click()
            else await selectWorkbenchResourceMenuItem(runtime, 'file')
          }
          await fileFilter.fill('subagent-checkout-config.ts')
          await runtime.page.getByTitle('subagent-checkout-config.ts', { exact: true }).click()
          const selectedResource = getWorkbenchPrefixLocator(
            runtime.page,
            workbenchSelectors.resourceTabPrefix
          ).filter({ hasText: 'subagent-checkout-config.ts' })
          await selectedResource
            .locator('button[aria-current="page"]')
            .waitFor({ state: 'visible' })
          expect(await selectedResource.locator('button[aria-current="page"]').count()).toBe(1)
          await selectWorkbenchModel(runtime.page, setup.env.modelName)
          await waitUntil(
            async () =>
              !(
                await getWorkbenchLocator(
                  runtime.page,
                  workbenchSelectors.modelSelect
                ).textContent()
              )?.includes('选择模型'),
            10_000
          )
          await runtime.page.mouse.move(0, 0)
          // Read-only DOM observer measures one real automatic text cycle, including
          // visibility after text ends. A newer message may legitimately supersede it.
          const autoCycle = runtime.page.evaluate(
            () =>
              new Promise<{ elapsedMs: number }>((resolve, reject) => {
                let cycle: { key: string; endedAt?: number } | undefined
                const started = performance.now()
                const timer = window.setInterval(() => {
                  if (performance.now() - started > 120_000) {
                    window.clearInterval(timer)
                    reject(new Error('未观察到真实自动云的完整显示周期'))
                    return
                  }
                  const cloud = [
                    ...document.querySelectorAll<HTMLElement>('[data-testid="subagent-thought"]')
                  ].find(
                    (element) =>
                      element.getClientRects().length > 0 && !element.closest('.ant-tooltip-hidden')
                  )
                  const key = cloud
                    ? `${cloud.dataset.childRunId}:${cloud.dataset.messageStartedAt}`
                    : undefined
                  const text = cloud
                    ?.querySelector('[data-testid="subagent-message"]')
                    ?.textContent?.trim()
                  const streaming = Boolean(
                    cloud?.querySelector('[data-testid="subagent-stream-dot"]')
                  )
                  if (cloud && key && text && streaming) {
                    cycle = { key }
                  } else if (cycle && key === cycle.key && !streaming) {
                    cycle.endedAt ??= performance.now()
                  } else if (cycle?.endedAt && !cloud) {
                    window.clearInterval(timer)
                    resolve({ elapsedMs: performance.now() - cycle.endedAt })
                  } else if (key !== cycle?.key) {
                    cycle = undefined
                  }
                }, 25)
              })
          )
          const started = Date.now()
          await sendWorkbenchMessage(
            runtime.page,
            `请一次派发三位临时帮手分头处理，并由你最后整合：第一位在内置浏览器打开 ${site.url}，填写 ALPHA_731 并提交，提交后用内置浏览器截图保存到 ${screenshot} 并保留表单页面，另外用网页资料抓取读取 ${site.url}/facts?marker=31415 并核对该数字，最后将 ${config} 中 timeoutMs 改为 3000，其他字段不动；第二位独立在内置浏览器打开同一个 ${site.url}，填写 BETA_892 并提交，提交后保留表单页面，另外用网页资料抓取读取 ${site.url}/facts?marker=27182 核对该数字；第三位搜索 Python 官方 csv reader 说明返回官方来源链接。网页帮手各自使用自己的标签。你把两个提交结果、资料数字和官方来源写到 ${report}，检查后交付。`
          )
          // No hover: the real public text stream opens the cloud and shows its trailing dot.
          const automaticCloud = runtime.page.locator('[data-testid="subagent-thought"]:visible')
          await waitUntil(
            async () =>
              (await automaticCloud.count()) === 1 &&
              (await automaticCloud.getByTestId('subagent-stream-dot').count()) === 1 &&
              Boolean((await automaticCloud.getByTestId('subagent-message').textContent())?.trim()),
            120_000
          )
          await assertCloudTextInside(automaticCloud)
          await runtime.captureScreenshot({
            name: 'subagent-cloud-auto',
            message: '未悬浮时最新公开消息自动显示，文字及黑球位于云内'
          })
          const cycle = await autoCycle
          expect(cycle.elapsedMs).toBeGreaterThanOrEqual(1800)
          expect(cycle.elapsedMs).toBeLessThan(3500)
          runtime.signal({
            name: 'subagent-auto-cloud-hold',
            message: '真实文字流结束后云停留约两秒自动隐藏',
            data: cycle
          })
          await waitUntil(async () =>
            (await updates(runtime, started)).some((event) => event.update.status === 'running')
          )
          const queuedRow = runtime.page
            .locator('[data-testid="subagent-task"][data-status="queued"]')
            .last()
          await queuedRow.waitFor({ state: 'visible', timeout: 120_000 })
          expect(await queuedRow.locator('.nc-partner-avatar-animated').count()).toBe(0)
          expect(await queuedRow.locator('.grayscale').count()).toBe(1)
          await queuedRow.hover()
          const queuedCloud = runtime.page.locator('[data-testid="subagent-thought"]:visible')
          await queuedCloud.waitFor({ state: 'visible' })
          expect(await queuedCloud.getAttribute('data-child-run-id')).toBe(
            await queuedRow.getAttribute('data-child-run-id')
          )
          expect(await queuedCloud.getByTestId('subagent-message').textContent()).toBe('我在排队')
          await assertCloudTextInside(queuedCloud)
          expect(await queuedCloud.getByTestId('subagent-stream-dot').count()).toBe(0)
          await runtime.captureScreenshot({
            name: 'subagent-cloud-queued',
            message: '灰色排队行及排队云提示'
          })
          await runtime.page.mouse.move(0, 0)
          await queuedCloud.waitFor({ state: 'hidden' })
          let previewChildRunId = ''
          await waitUntil(async () => {
            const action = (await updates(runtime, started)).find((event) =>
              event.update.action?.text.trim()
            )
            previewChildRunId = action?.update.childRunId || ''
            return Boolean(previewChildRunId)
          })
          const childRow = runtime.page.locator(
            `[data-testid="subagent-task"][data-child-run-id="${previewChildRunId}"]`
          )
          expect(await childRow.locator('.nc-partner-avatar-animated').count()).toBe(1)
          expect(await childRow.textContent()).not.toMatch(/干活中|已干完/)
          expect(
            await runtime.page
              .getByTestId('subagent-group')
              .first()
              .evaluate((group) => getComputedStyle(group).flexDirection)
          ).toBe('column')
          await waitUntil(async () => {
            const visible = runtime.page.locator('[data-testid="subagent-thought"]:visible')
            if (
              (await visible.count()) === 1 &&
              (await visible.getAttribute('data-child-run-id')) === previewChildRunId
            )
              return true
            await runtime.page.mouse.move(0, 0)
            await childRow.hover()
            return false
          }, 10_000)
          await waitUntil(
            async () =>
              runtime.page
                .locator('[data-testid="subagent-thought"]:visible')
                .evaluate(
                  (cloud) => Number(getComputedStyle(cloud.closest('.ant-tooltip')!).opacity) === 1
                ),
            10_000
          )
          const liveCloud = runtime.page.locator('[data-testid="subagent-thought"]:visible')
          await liveCloud
            .getByTestId('subagent-stream-dot')
            .waitFor({ state: 'visible', timeout: 120_000 })
          expect(
            await liveCloud
              .getByTestId('subagent-stream-dot')
              .evaluate((dot) => getComputedStyle(dot).animationName)
          ).toBe('nc-subagent-dot-breathe')
          expect(await liveCloud.getByTestId('subagent-message').count()).toBe(1)
          await assertCloudTextInside(liveCloud)
          await waitUntil(
            async () =>
              liveCloud
                .locator('.nc-subagent-thought-lines')
                .evaluate(
                  (lines) =>
                    Math.abs(lines.scrollHeight - lines.clientHeight - lines.scrollTop) <= 2
                ),
            10_000
          )
          await runtime.captureScreenshot({
            name: 'subagent-cloud-running',
            message: '运行中的竖排头像列表与最新消息云朵气泡'
          })
          await runtime.page.mouse.move(0, 0)
          await runtime.page
            .locator('[data-testid="subagent-thought"]:visible')
            .waitFor({ state: 'hidden' })
          await childRow.focus()
          await runtime.page
            .locator('[data-testid="subagent-thought"]:visible')
            .waitFor({ state: 'visible' })
          await getWorkbenchLocator(runtime.page, workbenchSelectors.input).focus()
          await runtime.page
            .locator('[data-testid="subagent-thought"]:visible')
            .waitFor({ state: 'hidden' })
          const panelToggle = getWorkbenchLocator(
            runtime.page,
            workbenchSelectors.contentPanelToggle
          )
          if ((await panelToggle.getAttribute('aria-label')) === '收起右侧栏')
            await panelToggle.click()
          await waitUntil(
            async () => (await panelToggle.getAttribute('aria-label')) === '展开右侧栏',
            10_000
          )
          await getWorkbenchPrefixLocator(runtime.page, workbenchSelectors.partnerItemPrefix)
            .filter({ hasText: secondary })
            .click()
          await waitUntil(async () =>
            getWorkbenchPrefixLocator(runtime.page, workbenchSelectors.partnerItemPrefix)
              .filter({ hasText: secondary })
              .evaluate((row) => row.classList.contains('nc-sidebar-item-active'))
          )
          await waitUntil(
            async () => (await runtime.page.getByTestId('subagent-task').count()) === 0,
            10_000
          )
          await getWorkbenchPrefixLocator(runtime.page, workbenchSelectors.partnerItemPrefix)
            .filter({ hasText: primary })
            .click()
          await waitUntil(async () =>
            getWorkbenchPrefixLocator(runtime.page, workbenchSelectors.partnerItemPrefix)
              .filter({ hasText: primary })
              .evaluate((row) => row.classList.contains('nc-sidebar-item-active'))
          )
          await waitUntil(
            async () => (await runtime.page.getByTestId('subagent-task').count()) === 3,
            10_000
          )
          let pageGeometry: Array<{
            id: number
            viewport: number[]
            instance: string
            drawn: boolean
          }> = []
          await waitUntil(async () => {
            pageGeometry = await runtime.electronApp.evaluate(
              async ({ BrowserWindow, WebContentsView, webContents }, prefix) => {
                const windows = BrowserWindow.getAllWindows()
                const visibleWindows = windows.filter(
                  (window) => window.isVisible() && !window.getParentWindow()
                )
                if (visibleWindows.length !== 1)
                  throw new Error(
                    `后台标签不应创建用户可见的独立窗口：${JSON.stringify(visibleWindows.map((window) => ({ id: window.id, url: window.webContents.getURL() })))}`
                  )
                const pages = webContents
                  .getAllWebContents()
                  .filter((contents) => contents.getURL() === `${prefix}/`)
                if (
                  pages.some((contents) =>
                    windows.some((window) => window.webContents.id === contents.id)
                  )
                )
                  throw new Error('表单标签应属于内嵌视图，不能成为独立窗口')
                return Promise.all(
                  pages.map(async (contents) => ({
                    id: contents.id,
                    drawn: windows.some((window) =>
                      window.contentView.children.some(
                        (view) =>
                          view instanceof WebContentsView &&
                          view.webContents.id === contents.id &&
                          view.getVisible()
                      )
                    ),
                    ...(await contents.executeJavaScript(
                      '({ viewport: [innerWidth, innerHeight], instance: sessionStorage.instance })'
                    ))
                  }))
                )
              },
              site.url
            )
            return (
              pageGeometry.length >= 2 &&
              pageGeometry.every((page) => !page.drawn && page.viewport.every((size) => size > 0))
            )
          }, 90_000)
          runtime.signal({
            name: 'subagent-page-geometry',
            message: '独立后台标签隐藏显示且保持有效 viewport，未创建额外窗口',
            data: pageGeometry
          })
          await waitUntil(async () => {
            const latest = new Map(
              (await updates(runtime, started)).map((event) => [
                event.update.childRunId,
                event.update.status
              ])
            )
            if (
              latest.size === 3 &&
              [...latest.values()].every((status) => status !== 'running' && status !== 'queued')
            )
              return true
            expect(await panelToggle.getAttribute('aria-label')).toBe('展开右侧栏')
            return false
          }, 900_000)
          await panelToggle.click()
          await selectedResource
            .locator('button[aria-current="page"]')
            .waitFor({ state: 'visible' })
          expect(await selectedResource.locator('button[aria-current="page"]').count()).toBe(1)
          await panelToggle.click()
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            started,
            setup.env.modelName,
            900_000
          )
          expect(site.receipts).toContain('ALPHA_731')
          expect(site.receipts).toContain('BETA_892')
          expect(site.instances.get('ALPHA_731')).not.toBe(site.instances.get('BETA_892'))
          const image = await fs.readFile(screenshot)
          expect([...image.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
          expect(image.readUInt32BE(16)).toBeGreaterThan(0)
          expect(image.readUInt32BE(20)).toBeGreaterThan(0)
          expect(site.rendered).toEqual(expect.arrayContaining(['31415', '27182']))
          const subagentEvents = await updates(runtime, started)
          const webCallIds = new Set(
            subagentEvents.flatMap((event) =>
              event.update.action?.toolName === 'web_search' ? [event.update.action.id] : []
            )
          )
          const childIo = (await runtime.collectSignals()).llmIoEntries
            .map((entry) => entry.record)
            .filter((record) => record.ownerRunId === subagentEvents[0].runId)
          for (const marker of ['31415', '27182']) {
            expect(
              childIo.some((record) =>
                record.requestWire?.messages.some(
                  (message) =>
                    message.role === 'tool' &&
                    Boolean(message.toolCallId && webCallIds.has(message.toolCallId)) &&
                    typeof message.content === 'string' &&
                    message.content.includes(`核验事实：${marker}。`) &&
                    message.content.includes('这是经页面脚本渲染的实际资料') &&
                    !message.content.includes('document.querySelector') &&
                    !message.content.includes('python3 -c')
                )
              )
            ).toBe(true)
          }
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
          const childStreams = (await collectWorkbenchAiRunEvents(runtime)).filter(
            (event) => event.type === 'subagent_stream' && event.runId === subagentEvents[0].runId
          )
          expect(childStreams.filter((event) => event.delta).length).toBeGreaterThan(3)
          expect(childStreams.some((event) => event.delta && !event.reset)).toBe(true)
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
          const processToggle = getWorkbenchPrefixLocator(
            runtime.page,
            workbenchSelectors.assistantProcessTogglePrefix
          ).last()
          await processToggle.click()
          expect(await runtime.page.getByTestId('subagent-task').count()).toBe(3)
          const completedChild = runtime.page.locator(
            `[data-testid="subagent-task"][data-child-run-id="${previewChildRunId}"]`
          )
          expect(await completedChild.textContent()).not.toMatch(/干活中|已干完/)
          expect(await completedChild.locator('.nc-partner-avatar-animated').count()).toBe(0)
          await completedChild.hover()
          await runtime.page
            .locator('[data-testid="subagent-thought"]:visible')
            .waitFor({ state: 'visible' })
          const completedCloud = runtime.page.locator('[data-testid="subagent-thought"]:visible')
          const completedResult = firstUpdates.find(
            (event) =>
              event.update.childRunId === previewChildRunId && event.update.status === 'completed'
          )?.update.result
          expect(completedResult).toBeTruthy()
          expect(await completedCloud.getByTestId('subagent-message').textContent()).toBe(
            completedResult
          )
          expect(await completedCloud.getByTestId('subagent-message').count()).toBe(1)
          expect(await completedCloud.getByTestId('subagent-stream-dot').count()).toBe(0)
          await assertCloudTextInside(completedCloud)
          expect(
            await completedCloud.evaluate((cloud) => {
              const lines = cloud.querySelector('.nc-subagent-thought-lines')!
              const style = getComputedStyle(lines)
              const bounds = cloud.getBoundingClientRect()
              return (
                bounds.width <= 220 &&
                bounds.height <= 96 &&
                style.whiteSpace === 'pre-wrap' &&
                style.scrollbarWidth === 'none'
              )
            })
          ).toBe(true)
          await waitUntil(
            async () =>
              completedCloud
                .locator('.nc-subagent-thought-lines')
                .evaluate(
                  (lines) =>
                    Math.abs(lines.scrollHeight - lines.clientHeight - lines.scrollTop) <= 2
                ),
            10_000
          )
          await waitUntil(
            async () =>
              runtime.page
                .locator('[data-testid="subagent-thought"]:visible')
                .evaluate(
                  (cloud) => Number(getComputedStyle(cloud.closest('.ant-tooltip')!).opacity) === 1
                ),
            10_000
          )
          await runtime.captureScreenshot({
            name: 'subagent-cloud-completed',
            message: '完成后的实际交付消息、紧凑云面与自动滚底'
          })
          await runtime.page.mouse.move(0, 0)
          await runtime.page
            .locator('[data-testid="subagent-thought"]:visible')
            .waitFor({ state: 'hidden' })
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
            const phasePartner = await createPartnerThroughWorkbenchUi(
              runtime.page,
              crash ? '崩溃恢复' : '停止恢复'
            )
            await selectWorkbenchModel(runtime.page, setup.env.modelName)
            await selectWorkbenchExecutionPermission(runtime.page, '完全访问')
            const start = Date.now()
            const slowBefore = site.getSlowRequests()
            const saved = path.join(setup.workspace.rootPath, crash ? '崩溃前.txt' : '停止前.txt')
            await sendWorkbenchMessage(
              runtime.page,
              `这是新的独立任务，${crash ? '本次要创建一个名叫“崩溃前.txt”的新文件，先前“停止前.txt”保持原样。' : '本次要保存“停止前.txt”。'}找两位临时帮手同时处理：第一位创建 ${saved}，内容仅为 SAVED_${crash ? 'CRASH' : 'STOP'}，核对本次文件路径和实际内容后立刻交付；第二位在内置浏览器打开 ${site.url}/slow，等待网页加载后汇报。你等待两项完成后整合。`
            )
            await waitUntil(
              async () =>
                site.getSlowRequests() > slowBefore &&
                (await updates(runtime, start)).some((event) => event.update.status === 'completed')
            )
            await runtime.page.mouse.move(0, 0)
            await getWorkbenchLocator(runtime.page, workbenchSelectors.input).focus()
            // The genuine pending navigation leaves a gap after text output; no test delay
            // is added to the model or tool. Auto clouds must expire while the tool still runs.
            await runtime.page
              .locator('[data-testid="subagent-thought"]:visible')
              .waitFor({ state: 'hidden', timeout: 10_000 })
            const before = await updates(runtime, start)
            const completed = before.find((event) => event.update.status === 'completed')!
            expect(await fs.readFile(saved, 'utf8')).toContain(crash ? 'SAVED_CRASH' : 'SAVED_STOP')
            if (crash) {
              await runtime.restartApp({ crash: true })
              await getWorkbenchPrefixLocator(runtime.page, workbenchSelectors.partnerItemPrefix)
                .filter({ hasText: phasePartner })
                .click()
              await getWorkbenchPrefixLocator(
                runtime.page,
                workbenchSelectors.assistantProcessTogglePrefix
              )
                .last()
                .click()
              await runtime.page
                .locator('[data-testid="subagent-task"][data-status="interrupted"]')
                .last()
                .waitFor({ state: 'visible' })
              expect(
                await runtime.page.locator('[data-testid="subagent-thought"]:visible').count()
              ).toBe(0)
              expect(
                await runtime.page
                  .locator(`[data-child-run-id="${completed.update.childRunId}"]`)
                  .getAttribute('data-status')
              ).toBe('completed')
            } else {
              const loadingPages = await runtime.electronApp.evaluate(({ webContents }) =>
                webContents
                  .getAllWebContents()
                  .filter(
                    (contents) =>
                      contents.isLoadingMainFrame() && !contents.getURL().startsWith('file:')
                  )
                  .map((contents) => contents.id)
              )
              expect(loadingPages.length).toBeGreaterThan(0)
              const pendingChild = runtime.page
                .locator('[data-testid="subagent-task"][data-status="running"]')
                .last()
              await pendingChild.hover()
              const pendingCloud = runtime.page.locator('[data-testid="subagent-thought"]:visible')
              await pendingCloud.waitFor({ state: 'visible' })
              expect(await pendingCloud.getByTestId('subagent-stream-dot').count()).toBe(0)
              await assertCloudTextInside(pendingCloud)
              // Manual reading survives longer than the automatic two-second hold.
              await runtime.page.waitForTimeout(2200)
              expect(await pendingCloud.isVisible()).toBe(true)
              await runtime.page.mouse.move(0, 0)
              await pendingCloud.waitFor({ state: 'hidden' })
              await runtime.page.getByRole('button', { name: '停止本次运行', exact: true }).click()
              await waitUntil(async () => {
                const latest = new Map(
                  (await updates(runtime, start)).map((event) => [
                    event.update.childRunId,
                    event.update.status
                  ])
                )
                return (
                  latest.size === 2 &&
                  [...latest.values()].includes('cancelled') &&
                  [...latest.values()].every((status) => status !== 'running')
                )
              })
              await waitUntil(async () =>
                runtime.electronApp.evaluate(
                  ({ BrowserWindow, WebContentsView, webContents }, ids) =>
                    ids.every((id) => {
                      const contents = webContents.fromId(id)
                      return (
                        (!contents || !contents.isLoadingMainFrame()) &&
                        !BrowserWindow.getAllWindows().some((window) =>
                          window.contentView.children.some(
                            (view) => view instanceof WebContentsView && view.webContents.id === id
                          )
                        )
                      )
                    }),
                  loadingPages
                )
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
          return { evidence, receipts: site.receipts, phases: 3 }
        },
        assert: async (result, runtime) => {
          runtime.assertThat(result.phases === 3, {
            name: 'subagent-browser-lifecycle-phases',
            message: '浏览器与 sidecar、回退、停止和崩溃续聊通过真实 UI',
            data: { receipts: result.receipts }
          })
        }
      })
    },
    1_800_000
  )
})
