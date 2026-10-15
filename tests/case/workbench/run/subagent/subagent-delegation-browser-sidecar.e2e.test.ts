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
  waitForWorkbenchAiEvent,
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
const ACTIVE_CLOUD_SELECTOR =
  '.ant-tooltip:not(.ant-tooltip-hidden):not([class*="-leave"]) [data-testid="subagent-thought"]:visible'
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

const readCloudSnapshot = async (cloud: Locator) =>
  await cloud.evaluateAll((elements) => {
    if (elements.length !== 1) return null
    const element = elements[0]
    const tooltip = element.closest<HTMLElement>('.ant-tooltip')
    if (
      !tooltip ||
      tooltip.matches('.ant-tooltip-hidden, [class*="-leave"]') ||
      Number(getComputedStyle(tooltip).opacity) !== 1
    )
      return null
    const lines = element.querySelector<HTMLElement>('.nc-subagent-thought-lines')
    const outline = element.querySelector<SVGPathElement>('.nc-subagent-thought-outline path')
    const matrix = outline?.getScreenCTM()
    if (!lines || !outline || !matrix) return null
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) return null
    const inverse = matrix.inverse()
    const bounds = lines.getBoundingClientRect()
    const corners = [
      [bounds.left, bounds.top],
      [bounds.right, bounds.top],
      [bounds.left, bounds.bottom],
      [bounds.right, bounds.bottom]
    ]
    const dot = element.querySelector('[data-testid="subagent-stream-dot"]')
    return {
      childRunId: element.getAttribute('data-child-run-id'),
      message: element.querySelector('[data-testid="subagent-message"]')?.textContent || '',
      streamAnimation: dot ? getComputedStyle(dot).animationName : null,
      inside:
        corners.every(([x, y]) =>
          outline.isPointInFill(new DOMPoint(x, y).matrixTransform(inverse))
        ) &&
        lines.scrollWidth <= lines.clientWidth &&
        getComputedStyle(lines).overflowX === 'hidden'
    }
  })

const assertCloudTextInside = async (cloud: Locator): Promise<void> => {
  const deadline = Date.now() + 10_000
  let snapshot = await readCloudSnapshot(cloud)
  while (!snapshot) {
    if (Date.now() > deadline) throw new Error('子任务云未进入可测量的稳定可见状态')
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
    snapshot = await readCloudSnapshot(cloud)
  }
  expect(snapshot.inside).toBe(true)
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
          // Read-only DOM observer checks repeated automatic messages in the same child,
          // plus a full two-second hold. Hover/focus observations are excluded.
          const autoCycle = runtime.page.evaluate(
            () =>
              new Promise<{
                elapsedMs: number
                messages: Array<{ childRunId: string; messageId: string }>
              }>((resolve, reject) => {
                const messages = new Map<string, { childRunId: string; messageId: string }>()
                let elapsedMs: number | undefined
                let cycle: { key: string; streamed?: boolean; endedAt?: number } | undefined
                const transitions: string[] = []
                let lastState = ''
                const started = performance.now()
                const timer = window.setInterval(() => {
                  if (performance.now() - started > 240_000) {
                    window.clearInterval(timer)
                    reject(
                      new Error(
                        `未观察到同一子任务多轮自动云及完整隐藏周期：${JSON.stringify({ elapsedMs, messages: [...messages.values()], transitions })}`
                      )
                    )
                    return
                  }
                  const cloud = [
                    ...document.querySelectorAll<HTMLElement>('[data-testid="subagent-thought"]')
                  ].find(
                    (element) =>
                      element.getClientRects().length > 0 && !element.closest('.ant-tooltip-hidden')
                  )
                  const manual =
                    [
                      ...document.querySelectorAll<HTMLElement>('[data-testid="subagent-task"]')
                    ].some((row) => row.matches(':hover, :focus')) ||
                    Boolean(cloud?.matches(':hover'))
                  const key = cloud?.dataset.messageId
                    ? `${cloud.dataset.childRunId}:${cloud.dataset.messageId}`
                    : undefined
                  const text = cloud
                    ?.querySelector('[data-testid="subagent-message"]')
                    ?.textContent?.trim()
                  const streaming = Boolean(
                    cloud?.querySelector('[data-testid="subagent-stream-dot"]')
                  )
                  const state = `${key || 'hidden'}:${streaming ? 'stream' : 'ended'}:${manual ? 'manual' : 'auto'}`
                  if (state !== lastState) {
                    transitions.push(state)
                    if (transitions.length > 20) transitions.shift()
                    lastState = state
                  }
                  if (manual) {
                    cycle = undefined
                    return
                  }
                  if (cloud && key && text) {
                    if (streaming)
                      messages.set(key, {
                        childRunId: cloud.dataset.childRunId!,
                        messageId: cloud.dataset.messageId!
                      })
                    if (cycle?.key !== key) cycle = { key }
                    if (streaming) {
                      cycle.streamed = true
                      cycle.endedAt = undefined
                    } else cycle.endedAt ??= performance.now()
                  } else if (cycle?.endedAt && !cloud) {
                    if (cycle.streamed) elapsedMs ??= performance.now() - cycle.endedAt
                    cycle = undefined
                  } else if (key !== cycle?.key) {
                    cycle = undefined
                  }
                  const counts = new Map<string, number>()
                  for (const message of messages.values())
                    counts.set(message.childRunId, (counts.get(message.childRunId) || 0) + 1)
                  if (elapsedMs !== undefined && [...counts.values()].some((count) => count >= 2)) {
                    window.clearInterval(timer)
                    resolve({ elapsedMs, messages: [...messages.values()] })
                  }
                }, 25)
              })
          )
          // Handle rejection immediately even if another UI assertion fails first.
          void autoCycle.catch(() => {})
          const started = Date.now()
          await sendWorkbenchMessage(
            runtime.page,
            `请一次派发三位临时帮手分头处理，每位开始操作前先简短告诉我正在做什么，网页帮手提交表单后再用一句话报告进展，并由你最后整合：第一位在内置浏览器打开 ${site.url}，填写 ALPHA_731 并提交，提交后用内置浏览器截图保存到 ${screenshot} 并保留表单页面，另外用网页资料抓取读取 ${site.url}/facts?marker=31415 并核对该数字，最后用文本编辑工具将 ${config} 中 timeoutMs 改为 3000，其他字段不动；第二位独立在内置浏览器打开同一个 ${site.url}，填写 BETA_892 并提交，提交后保留表单页面，另外用网页资料抓取读取 ${site.url}/facts?marker=27182 核对该数字；第三位搜索 Python 官方 csv reader 说明返回官方来源链接。网页帮手各自使用自己的标签。你用文本编辑工具把两个提交结果、资料数字和官方来源写到 ${report}，检查后交付。`
          )
          const pendingRow = runtime.page
            .locator('[data-testid="subagent-task"][data-status="running"]')
            .first()
          await pendingRow.waitFor({ state: 'visible', timeout: 120_000 })
          await pendingRow.hover()
          const delegatedChildRunIds = new Set(
            (await updates(runtime, started)).map((event) => event.update.childRunId)
          )
          expect(delegatedChildRunIds.size).toBeGreaterThanOrEqual(3)
          const pendingChildRunId = await pendingRow.getAttribute('data-child-run-id')
          const pendingCloud = runtime.page.locator(
            `[data-testid="subagent-thought"][data-child-run-id="${pendingChildRunId}"]:visible`
          )
          await pendingCloud.waitFor({ state: 'visible' })
          expect(await pendingCloud.getByTestId('subagent-message').textContent()).toBe(
            '我在思考中'
          )
          expect(await pendingCloud.getByTestId('subagent-stream-dot').count()).toBe(0)
          await assertCloudTextInside(pendingCloud)
          await runtime.captureScreenshot({
            name: 'subagent-cloud-thinking',
            message: '首段文字尚未到达时悬浮显示思考提示，无空白云或文字流黑球'
          })
          await runtime.page.mouse.move(0, 0)
          await waitUntil(
            async () => !(await pendingRow.evaluate((row) => row.matches(':hover, :focus'))),
            5000
          )
          // No hover: the real public text stream opens the cloud and shows its trailing dot.
          const automaticCloud = runtime.page.locator(ACTIVE_CLOUD_SELECTOR)
          const automaticDeadline = Date.now() + 120_000
          let automaticSnapshot = await readCloudSnapshot(automaticCloud)
          while (
            !automaticSnapshot ||
            automaticSnapshot.streamAnimation === null ||
            !automaticSnapshot.message.trim()
          ) {
            if (Date.now() > automaticDeadline) throw new Error('未观察到唯一的自动文字流云')
            await runtime.page.waitForTimeout(50)
            automaticSnapshot = await readCloudSnapshot(automaticCloud)
          }
          expect(automaticSnapshot.inside).toBe(true)
          expect(automaticSnapshot.streamAnimation).toBe('nc-subagent-dot-breathe')
          await runtime.captureScreenshot({
            name: 'subagent-cloud-auto',
            message: '未悬浮时最新公开消息自动显示，文字及黑球位于云内'
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
          const queuedChildRunId = await queuedRow.getAttribute('data-child-run-id')
          await queuedRow.hover()
          const queuedCloud = runtime.page.locator(
            `[data-testid="subagent-thought"][data-child-run-id="${queuedChildRunId}"]:visible`
          )
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
            const visible = await readCloudSnapshot(runtime.page.locator(ACTIVE_CLOUD_SELECTOR))
            if (visible?.childRunId === previewChildRunId) return true
            await runtime.page.mouse.move(0, 0)
            await childRow.hover()
            return false
          }, 10_000)
          const liveCloud = runtime.page.locator(
            `[data-testid="subagent-thought"][data-child-run-id="${previewChildRunId}"]:visible`
          )
          expect(await liveCloud.getByTestId('subagent-message').count()).toBe(1)
          expect(
            (await liveCloud.getByTestId('subagent-message').textContent())?.trim()
          ).toBeTruthy()
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
          await liveCloud.waitFor({ state: 'hidden' })
          await childRow.focus()
          await liveCloud.waitFor({ state: 'visible' })
          await getWorkbenchLocator(runtime.page, workbenchSelectors.input).focus()
          await liveCloud.waitFor({ state: 'hidden' })
          const cycle = await autoCycle
          expect(cycle.elapsedMs).toBeGreaterThanOrEqual(1800)
          expect(cycle.elapsedMs).toBeLessThan(3500)
          runtime.signal({
            name: 'subagent-auto-cloud-hold',
            message: '同一子任务连续新文案均自动开云，真实文字流结束后云停留约两秒隐藏',
            data: cycle
          })
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
            async () =>
              (await runtime.page.getByTestId('subagent-task').count()) ===
              delegatedChildRunIds.size,
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
              latest.size === delegatedChildRunIds.size &&
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
          ).toBe(delegatedChildRunIds.size)
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
          expect(await runtime.page.getByTestId('subagent-task').count()).toBe(
            delegatedChildRunIds.size
          )
          const completedChild = runtime.page.locator(
            `[data-testid="subagent-task"][data-child-run-id="${previewChildRunId}"]`
          )
          expect(await completedChild.textContent()).not.toMatch(/干活中|已干完/)
          expect(await completedChild.locator('.nc-partner-avatar-animated').count()).toBe(0)
          await completedChild.hover()
          const completedCloud = runtime.page.locator(
            `[data-testid="subagent-thought"][data-child-run-id="${previewChildRunId}"]:visible`
          )
          await completedCloud.waitFor({ state: 'visible' })
          const completedResult = firstUpdates.find(
            (event) =>
              event.update.childRunId === previewChildRunId && event.update.status === 'completed'
          )?.update.result
          expect(completedResult).toBeTruthy()
          expect(await completedCloud.getByTestId('subagent-message').textContent()).toBe('已完成')
          expect(await completedCloud.getByTestId('subagent-message').count()).toBe(1)
          expect(await completedCloud.getByTestId('subagent-stream-dot').count()).toBe(0)
          await assertCloudTextInside(completedCloud)
          expect(
            await completedCloud.evaluate((cloud) => {
              const lines = cloud.querySelector('.nc-subagent-thought-lines')!
              const style = getComputedStyle(lines)
              const bounds = cloud.getBoundingClientRect()
              return (
                bounds.width <= 220.05 &&
                bounds.height <= 96.05 &&
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
          await runtime.captureScreenshot({
            name: 'subagent-cloud-completed',
            message: '完成后的实际交付消息、紧凑云面与自动滚底'
          })
          await runtime.page.mouse.move(0, 0)
          await waitUntil(
            async () =>
              (await runtime.page.locator('[data-testid="subagent-thought"]:visible').count()) ===
              0,
            10_000
          )
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
            await waitUntil(
              async () =>
                (await runtime.page.locator('[data-testid="subagent-thought"]:visible').count()) ===
                0,
              10_000
            )
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
              const pendingChildRunId = await pendingRow.getAttribute('data-child-run-id')
              const pendingCloud = runtime.page.locator(
                `[data-testid="subagent-thought"][data-child-run-id="${pendingChildRunId}"]:visible`
              )
              await pendingCloud.waitFor({ state: 'visible' })
              expect(await pendingCloud.getByTestId('subagent-stream-dot').count()).toBe(0)
              await assertCloudTextInside(pendingCloud)
              // Manual reading survives longer than the automatic two-second hold.
              await runtime.page.waitForTimeout(2200)
              expect(await pendingCloud.isVisible()).toBe(true)
              await runtime.page.mouse.move(0, 0)
              await waitUntil(
                async () => !(await pendingRow.evaluate((row) => row.matches(':hover, :focus'))),
                5000
              )
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
            const replacementUrl = `${site.url}/facts?marker=94217`
            await sendWorkbenchMessage(
              runtime.page,
              `继续：先查询未完成子 agent，续接原会话，把下面完整的新任务原样交给它：\n用内置浏览器打开 ${replacementUrl} 并核对页面数字；旧的 /slow 网页不再访问。读取已保存的 ${saved}，保持该文件原样；用文本编辑工具写 ${saved}.continued.md，说明先前已保存的文件内容和这次新页面的核验数字。`
            )
            const dispatch = await waitForWorkbenchAiEvent(runtime, {
              name: 'resume-with-new-page-task',
              matches: (event) =>
                event.type === 'tool_call_started' &&
                event.toolName === 'delegate_to_subagent' &&
                event.createdAt >= continueStart
            })
            if (dispatch.type !== 'tool_call_started') throw new Error('缺少续接派发证据')
            expect(JSON.stringify(dispatch.input)).toContain(replacementUrl)
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
                  before.some(
                    (previous) =>
                      previous.update.agentId === event.update.agentId &&
                      previous.update.childRunId !== event.update.childRunId &&
                      previous.update.status !== 'completed'
                  )
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
  it('subagent-delegation-display', async () => {
    await runE2ECase({
      caseId: 'subagent-delegation-display',
      domain: 'workbench',
      suite: 'run',
      groups: ['subagent'],
      description: '派发只显示助手，失败云保留真实错误并支持刷新恢复',
      fixtures: [],
      serviceMode: 'real',
      execution: 'live',
      windowMode: 'visible',
      runMode: 'single',
      execute: async (runtime) => {
        const setup = await setupWorkbenchWithTempWorkspace(runtime.page, {
          caseId: 'subagent-delegation-display',
          workspaceName: '派发展示'
        })
        await createPartnerThroughWorkbenchUi(runtime.page, '派发失败')
        await selectWorkbenchModel(runtime.page, setup.env.modelName)
        await selectWorkbenchExecutionPermission(runtime.page, '完全访问')
        const missingAgentId = 'missing-subagent-cloud-e2e'
        const failureStart = Date.now()
        await sendWorkbenchMessage(
          runtime.page,
          [
            '请只调用一次 delegate_to_subagent，原样传递下面参数。会话 ID 是指定输入，不能替换。工具报错后简短说明并结束，不查询、不重试、不创建新助手。',
            JSON.stringify({ agents: [{ agentId: missingAgentId, instruction: '仅回复收到' }] })
          ].join('\n')
        )
        const failure = await waitForWorkbenchAiEvent(runtime, {
          name: 'subagent-dispatch-failed',
          timeoutMs: 30_000,
          matches: (event) =>
            event.type === 'assistant_process_item_failed' && event.failedAt >= failureStart
        })
        if (failure.type !== 'assistant_process_item_failed') throw new Error('缺少派发失败事实')
        await waitForWorkbenchAiRunCompletion(runtime, failureStart, setup.env.modelName, 120_000)
        const showFailureCloud = async (): Promise<void> => {
          const toggle = getWorkbenchPrefixLocator(
            runtime.page,
            workbenchSelectors.assistantProcessTogglePrefix
          ).last()
          await toggle.waitFor({ state: 'visible' })
          if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
          const row = runtime.page.locator(
            `[data-testid="subagent-task"][data-agent-id="${missingAgentId}"]`
          )
          await row.waitFor({ state: 'visible' })
          expect(await row.count()).toBe(1)
          expect(await row.getAttribute('data-child-run-id')).toBeNull()
          expect(await row.innerText()).toBe('临时帮手')
          await row.hover()
          await waitUntil(async () => {
            const cloud = runtime.page.locator('[data-testid="subagent-thought"]:visible')
            return (
              (await cloud.count()) === 1 &&
              (await cloud.innerText()).includes(`我干失败了：${failure.error}`)
            )
          }, 10_000)
          expect(
            await getWorkbenchPrefixLocator(runtime.page, workbenchSelectors.assistantProcessPrefix)
              .locator('details > summary')
              .filter({ hasText: '分头处理' })
              .count()
          ).toBe(0)
        }
        await showFailureCloud()
        await runtime.captureScreenshot({
          name: 'subagent-cloud-dispatch-failed',
          message: '派发启动前失败在云中显示实际原因，无 Activity'
        })
        await runtime.page.reload()
        await showFailureCloud()

        await runtime.page.mouse.move(0, 0)
        const successStart = Date.now()
        await sendWorkbenchMessage(
          runtime.page,
          '创建一位名为“数字帮手”的子助手，让它独立核对 17 加 25 的结果并返回数字。请使用 delegate_to_subagent 分配，由你最后汇总。'
        )
        const dispatch = await waitForWorkbenchAiEvent(runtime, {
          name: 'subagent-new-argument-contract',
          matches: (event) =>
            event.type === 'tool_call_started' &&
            event.toolName === 'delegate_to_subagent' &&
            event.createdAt >= successStart
        })
        if (dispatch.type !== 'tool_call_started') throw new Error('缺少真实派发')
        expect(dispatch.input).toMatchObject({
          agents: [{ name: '数字帮手', instruction: expect.any(String) }]
        })
        expect('tasks' in dispatch.input).toBe(false)
        await waitForWorkbenchAiRunCompletion(runtime, successStart, setup.env.modelName, 120_000)
        const children = await updates(runtime, successStart)
        expect(
          children.some(
            (event) => event.update.status === 'completed' && event.update.result?.includes('42')
          )
        ).toBe(true)
        const toggle = getWorkbenchPrefixLocator(
          runtime.page,
          workbenchSelectors.assistantProcessTogglePrefix
        ).last()
        if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
        expect(
          await runtime.page
            .locator('[data-testid="subagent-task"]')
            .filter({ hasText: '数字帮手' })
            .count()
        ).toBe(1)
        expect(
          await getWorkbenchPrefixLocator(runtime.page, workbenchSelectors.assistantProcessPrefix)
            .locator('details > summary')
            .filter({ hasText: '分头处理' })
            .count()
        ).toBe(0)
        await assertNoWorkbenchFakeSignals(runtime, await runtime.collectSignals())
        return { completed: true }
      },
      assert: async (result) => {
        expect(result.completed).toBe(true)
      }
    })
  }, 300_000)
})
