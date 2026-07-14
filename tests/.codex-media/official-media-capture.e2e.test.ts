import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { launchElectronApp } from '../harness/e2e/electronApp'
import {
  configureLiveModelThroughSettingsUi,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  loadWorkbenchLiveModelEnv,
  navigateToWorkbench,
  prepareSelectedWorkspaceFilesThroughSettingsUi,
  selectWorkbenchModel,
  selectWorkbenchWorkspace,
  workbenchSelectors
} from '../harness/e2e/workbench'
import {
  bindWorkspaceRootThroughIpc,
  createWorkspaceThroughSettingsUi,
  getSettingsLocator,
  navigateToSettingsSection
} from '../harness/e2e/settings'

const OUTPUT_ROOT = '/Users/test/work-space/ncurator-media-preview/real-capture'
const SOURCE_WORKSPACE = '/Users/test/work-space/ncurator-media-preview/demo-workspace'
const WORKSPACE_ROOT = path.join(OUTPUT_ROOT, 'workspace-run')
const WORKSPACE_NAME = '明远科技客户会议'
const PROMPT =
  '下午 3 点要和明远科技开项目复盘会。请根据会议纪要、需求确认单、交付记录和客户反馈，整理一份会前简报，包含客户最关心的 3 件事、已完成事项、当前风险，以及会上需要确认的 5 个问题。请生成《明远科技会前简报.docx》，并在结论后标出依据。'

const frameName = (index: number): string => `frame-${String(index).padStart(5, '0')}.jpg`

describe('official media real product capture', () => {
  it(
    'captures the actual product running the customer meeting task',
    async () => {
      await rm(OUTPUT_ROOT, { recursive: true, force: true })
      await mkdir(path.join(OUTPUT_ROOT, 'raw', 'typing'), { recursive: true })
      await mkdir(path.join(OUTPUT_ROOT, 'raw', 'run'), { recursive: true })
      await mkdir(path.join(OUTPUT_ROOT, 'raw', 'answer'), { recursive: true })
      await mkdir(path.join(OUTPUT_ROOT, 'raw', 'docx'), { recursive: true })
      await mkdir(path.join(OUTPUT_ROOT, 'screenshots'), { recursive: true })
      await cp(SOURCE_WORKSPACE, WORKSPACE_ROOT, { recursive: true, force: true })
      await rm(path.join(WORKSPACE_ROOT, '明远科技会前简报.docx'), { force: true })

      const env = loadWorkbenchLiveModelEnv()
      const launched = await launchElectronApp({ launchMode: 'real', windowMode: 'background' })
      const { electronApp, page } = launched
      const tracePath = path.join(OUTPUT_ROOT, 'product-run-trace.zip')
      const timestamps: Array<{ section: string; index: number; at: number }> = []

      try {
        await electronApp.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0]
          window?.setContentSize(1600, 1000)
        })
        await page.setViewportSize({ width: 1600, height: 1000 })

        await configureLiveModelThroughSettingsUi(page, env)

        await navigateToSettingsSection(page, 'model')
        const liveRow = page.locator('tbody tr').filter({ hasText: 'Live Model' }).first()
        await liveRow.waitFor({ state: 'visible' })
        await page.screenshot({
          path: path.join(OUTPUT_ROOT, 'screenshots', 'feature-cost-real.png'),
          type: 'png'
        })

        await navigateToSettingsSection(page, 'workspace')
        const workspaceId = await createWorkspaceThroughSettingsUi(page, WORKSPACE_NAME)
        await bindWorkspaceRootThroughIpc(page, WORKSPACE_ROOT)
        await navigateToSettingsSection(page, 'model')
        await navigateToSettingsSection(page, 'workspace')
        await prepareSelectedWorkspaceFilesThroughSettingsUi(page, workspaceId)

        await navigateToWorkbench(page, { waitForSessionListText: false })
        await selectWorkbenchWorkspace(page, WORKSPACE_NAME)
        const newConversation = page.getByRole('button', {
          name: `在 ${WORKSPACE_NAME} 中新建对话`
        })
        if (await newConversation.count()) {
          await newConversation.click()
        }
        await selectWorkbenchWorkspace(page, WORKSPACE_NAME)
        await selectWorkbenchModel(page, env.modelName)

        const input = getWorkbenchLocator(page, workbenchSelectors.input)
        await input.click()
        await page.screenshot({
          path: path.join(OUTPUT_ROOT, 'raw', 'typing', frameName(0)),
          type: 'jpeg',
          quality: 94
        })
        let typingIndex = 1
        for (let offset = 0; offset < PROMPT.length; offset += 4) {
          const chunk = PROMPT.slice(offset, offset + 4)
          await page.keyboard.insertText(chunk)
          await page.waitForTimeout(22)
          await page.screenshot({
            path: path.join(OUTPUT_ROOT, 'raw', 'typing', frameName(typingIndex)),
            type: 'jpeg',
            quality: 94
          })
          timestamps.push({ section: 'typing', index: typingIndex, at: Date.now() })
          typingIndex += 1
        }
        await page.screenshot({
          path: path.join(OUTPUT_ROOT, 'screenshots', 'task-ready-real.png'),
          type: 'png'
        })

        const startedAt = Date.now()
        await getWorkbenchLocator(page, workbenchSelectors.sendButton).click()
        let runIndex = 0
        let completed = false
        let failure = ''
        const decidedApprovalBatches = new Set<string>()

        while (!completed && !failure && Date.now() - startedAt < 900_000) {
          await page.screenshot({
            path: path.join(OUTPUT_ROOT, 'raw', 'run', frameName(runIndex)),
            type: 'jpeg',
            quality: 92
          })
          timestamps.push({ section: 'run', index: runIndex, at: Date.now() })
          runIndex += 1

          const signals = await launched.collectSignals()
          const events = signals.aiRunEventEntries.map((entry) => entry.event)
          const failed = events.find((event) => event.type === 'run_failed')
          if (failed?.type === 'run_failed') {
            failure = failed.error
            break
          }

          const approval = events
            .filter((event) => event.type === 'approval_batch_required')
            .at(-1)
          if (
            approval?.type === 'approval_batch_required' &&
            !decidedApprovalBatches.has(approval.batchId)
          ) {
            const approveButton = page.locator(
              '[data-testid="chat-approval-batch-approve-button"]'
            )
            for (let item = 0; item < approval.items.length; item += 1) {
              await approveButton.waitFor({ state: 'visible' })
              await approveButton.click()
              await page.waitForTimeout(350)
            }
            decidedApprovalBatches.add(approval.batchId)
          }

          completed = events.some((event) => event.type === 'run_completed')
          await page.waitForTimeout(120)
        }

        expect(failure).toBe('')
        expect(completed).toBe(true)

        await page.waitForTimeout(800)
        const finalAnswer = getWorkbenchPrefixLocator(
          page,
          workbenchSelectors.assistantFinalAnswerPrefix
        ).last()
        await finalAnswer.waitFor({ state: 'visible' })
        await finalAnswer.scrollIntoViewIfNeeded()
        await page.screenshot({
          path: path.join(OUTPUT_ROOT, 'screenshots', 'feature-knowledge-real.png'),
          type: 'png'
        })

        for (let index = 0; index < 36; index += 1) {
          if (index > 11 && index % 3 === 0) {
            await getWorkbenchLocator(page, workbenchSelectors.messageList).evaluate((element) => {
              element.scrollTop += 90
            })
          }
          await page.screenshot({
            path: path.join(OUTPUT_ROOT, 'raw', 'answer', frameName(index)),
            type: 'jpeg',
            quality: 94
          })
          await page.waitForTimeout(65)
        }

        const applyEntry = getWorkbenchPrefixLocator(
          page,
          workbenchSelectors.assistantTurnApplyPrefix
        ).last()
        await applyEntry.waitFor({ state: 'visible' })
        await applyEntry.scrollIntoViewIfNeeded()
        await applyEntry.click()
        await getWorkbenchLocator(page, workbenchSelectors.applyPanel).waitFor({ state: 'visible' })
        await getWorkbenchLocator(page, workbenchSelectors.documentView).waitFor({
          state: 'visible'
        })
        await page.waitForTimeout(1400)
        await page.screenshot({
          path: path.join(OUTPUT_ROOT, 'screenshots', 'feature-autonomous-real.png'),
          type: 'png'
        })

        for (let index = 0; index < 42; index += 1) {
          if (index > 12 && index % 3 === 0) {
            await getWorkbenchLocator(page, workbenchSelectors.documentView).evaluate((element) => {
              const scrollHost =
                Array.from(element.querySelectorAll('*')).find(
                  (node) =>
                    node instanceof HTMLElement &&
                    node.scrollHeight > node.clientHeight + 40 &&
                    getComputedStyle(node).overflowY !== 'visible'
                ) || element
              if (scrollHost instanceof HTMLElement) scrollHost.scrollTop += 100
            })
          }
          await page.screenshot({
            path: path.join(OUTPUT_ROOT, 'raw', 'docx', frameName(index)),
            type: 'jpeg',
            quality: 94
          })
          await page.waitForTimeout(65)
        }

        await writeFile(
          path.join(OUTPUT_ROOT, 'capture-manifest.json'),
          JSON.stringify(
            {
              prompt: PROMPT,
              workspaceName: WORKSPACE_NAME,
              modelName: env.modelName,
              typingFrameCount: typingIndex,
              runFrameCount: runIndex,
              timestamps
            },
            null,
            2
          ),
          'utf8'
        )
      } finally {
        await launched.close({ tracePath })
      }
    },
    1_200_000
  )
})
