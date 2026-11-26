import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'vitest'
import { partnerMemorySelectors as memorySelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  configureLiveModelThroughSettingsUi,
  createPartnerThroughWorkbenchUi,
  navigateToWorkbench,
  waitForPartnerMemory,
  selectWorkbenchModel,
  sendWorkbenchMessage,
  waitForWorkbenchAiRunCompletion,
  collectWorkbenchLlmIoRecords,
  loadWorkbenchLiveModelEnv,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'chat-without-knowledge-model'

describe('workbench conversation', () => {
  it(
    CASE_ID,
    async () => {
      const modelsPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-chat-empty-models-'))
      try {
        await runE2ECase({
          caseId: CASE_ID,
          domain: 'workbench',
          suite: 'conversation',
          groups: ['composer'],
          description: '无工作空间、无向量模型仍可完成真实聊天，且不下载或启动 embedding。',
          fixtures: [],
          serviceMode: 'real',
          execution: 'live',
          windowMode: 'background',
          runMode: 'single',
          extraEnv: { NCURATOR_MODELS_PATH: modelsPath },
          execute: async (runtime) => {
            const { page } = runtime
            const target = loadWorkbenchLiveModelEnv()
            await configureLiveModelThroughSettingsUi(page, target)
            await navigateToWorkbench(page)
            await createPartnerThroughWorkbenchUi(page, '普通聊天')
            await selectWorkbenchModel(page, target.modelName)
            const startedAt = Date.now()
            await sendWorkbenchMessage(page, '你好，请用一句话回复我。')
            const evidence = await waitForWorkbenchAiRunCompletion(
              runtime,
              startedAt,
              target.modelName
            )
            const partner = (await page.evaluate(() => window.api.partnerList())).find(
              (item) => item.name === '普通聊天'
            )
            if (!partner) throw new Error('Partner missing')
            const trigger = page.getByTestId(memorySelectors.trigger)
            const topbarIcons = await page.evaluate(
              (ids) => {
                const memory = document.querySelector(`[data-testid="${ids.memory}"]`)!
                const clear = document.querySelector(`[data-testid="${ids.clear}"] > span`)!
                return [ids.left, ids.right].map((id) => {
                  const icon = document.querySelector(`[data-testid="${id}"] svg`)!
                  const rect = icon.getBoundingClientRect()
                  const clearRect = clear.getBoundingClientRect()
                  const memoryRect = memory.getBoundingClientRect()
                  const alignedBar =
                    id === ids.left && document.querySelector('.nc-window-frame-windows')
                      ? document.querySelector('.nc-left-titlebar-chrome')!.getBoundingClientRect()
                      : memoryRect
                  return {
                    width: rect.width,
                    height: rect.height,
                    clearWidth: clearRect.width,
                    centerOffset:
                      rect.top + rect.height / 2 - alignedBar.top - alignedBar.height / 2
                  }
                })
              },
              {
                memory: memorySelectors.trigger,
                clear: workbenchSelectors.clearContextButton,
                left: workbenchSelectors.partnersToggle,
                right: workbenchSelectors.contentPanelToggle
              }
            )
            await runtime.assertThat(
              topbarIcons.every(
                (icon) =>
                  Math.abs(icon.width - icon.clearWidth) <= 0.05 &&
                  Math.abs(icon.height - icon.clearWidth) <= 0.05 &&
                  Math.abs(icon.centerOffset) < 1
              ),
              {
                name: 'chat-titlebar-icon-alignment',
                message: '两侧折叠图标与清空记录同尺寸，并与记忆入口纵向居中。',
                data: topbarIcons
              }
            )
            await trigger.click()
            const pane = page.getByTestId(`${memorySelectors.panePrefix}-cooperation_preferences`)
            const baseline =
              '保持自然表达。验证类诉求要求看真实证据：涉及记忆、工具或系统状态时，要用数据库查询或终端实际输出证明生效与否，并说明证据来源路径，不接受口头断言。\n' +
              Array.from(
                { length: 50 },
                (_, i) => `长期约定${i + 1}：交付时说明结论与依据，保留重要事实。`
              ).join('\n')
            await pane.locator('.monaco-editor textarea').last().focus()
            await page.keyboard.insertText(baseline)
            await waitForPartnerMemory(
              page,
              partner.id,
              (snapshot) => snapshot.memories[0].confirmed === baseline
            )
            const projectBaseline =
              '验证类诉求要求看真实证据：涉及记忆、工具或系统状态时，要用数据库查询或终端实际输出证明生效与否，并说明证据来源路径，不接受口头断言。'
            await page.getByTestId(`${memorySelectors.tabPrefix}-project_background`).click()
            const projectPane = page.getByTestId(`${memorySelectors.panePrefix}-project_background`)
            await projectPane.locator('.monaco-editor textarea').last().focus()
            await page.keyboard.insertText(projectBaseline)
            await waitForPartnerMemory(
              page,
              partner.id,
              (snapshot) => snapshot.memories[1].confirmed === projectBaseline
            )
            await trigger.click()
            const proposalStartedAt = Date.now()
            await sendWorkbenchMessage(
              page,
              '请依次调用 memory 工具完成以下 5 次修改，不要等我审核：1.合作偏好换行追加 MEMORY-APPEND-A；2.合作偏好换行追加 MEMORY-APPEND-B；3.合作偏好将唯一原文“自然表达”改成“清楚表达”；4.合作偏好将刚才改后的唯一原文“清楚表达”改成“直接表达”；5.项目背景换行追加“项目代号 MEMORY-PROJECT-731”。每次独立调用，完成后只回复已提交。'
            )
            const proposed = await waitForWorkbenchAiRunCompletion(
              runtime,
              proposalStartedAt,
              target.modelName
            )
            const pendingSnapshot = await page.evaluate(
              (id) => window.api.partnerMemoryGet(id),
              partner.id
            )
            await page.getByTestId(memorySelectors.dot).waitFor({ state: 'visible' })
            await trigger.click()
            const redDots = await page
              .getByTestId(memorySelectors.panel)
              .locator('.nc-memory-dot')
              .count()
            await pane.locator('.nc-memory-marker.removed').first().waitFor({ state: 'visible' })
            await pane.locator('.nc-memory-marker.added').first().waitFor({ state: 'visible' })
            await runtime.captureScreenshot({
              name: 'long-memory-diff',
              message: '真实 AI 生成的长记忆逐字差异、类别红点和红绿轨道。'
            })
            const rail = pane.locator('.nc-memory-rail')
            const overviewStyle = await rail.evaluate((element) => {
              const thumb = element.querySelector<HTMLElement>('.nc-memory-viewport')!
              const mark = element.querySelector<HTMLElement>('.nc-memory-marker')!
              return {
                width: element.getBoundingClientRect().width,
                thumbWidth: thumb.getBoundingClientRect().width,
                radius: getComputedStyle(thumb).borderRadius,
                border: getComputedStyle(thumb).borderTopWidth,
                borderStyle: getComputedStyle(thumb).borderTopStyle,
                dpr: window.devicePixelRatio,
                markerWidth: mark.getBoundingClientRect().width,
                hasTitle: [...element.querySelectorAll('[title]')].length > 0
              }
            })

            await rail.click({ position: { x: 6, y: 5 } })
            await runtime.captureScreenshot({
              name: 'memory-character-diff',
              message: '合作偏好顶部的逐字删除和增加。'
            })
            const readDiffLayout = async (category: string) =>
              page.getByTestId(`${memorySelectors.panePrefix}-${category}`).evaluate((pane) => {
                const host = pane.querySelector('.nc-memory-editor')!
                const original = host.querySelector('.editor.original')!
                const modified = host.querySelector('.editor.modified')!
                const bounds = host.getBoundingClientRect()
                const starts = [...modified.querySelectorAll('.view-lines > .view-line')].flatMap(
                  (line) => {
                    const box = line.getBoundingClientRect()
                    if (box.bottom <= bounds.top || box.top >= bounds.bottom) return []
                    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
                    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                      const start = (node.textContent ?? '').search(/\S/)
                      if (start < 0) continue
                      const range = document.createRange()
                      range.setStart(node, start)
                      range.setEnd(node, start + 1)
                      return [
                        {
                          text: line.textContent,
                          left: range.getBoundingClientRect().left - bounds.left
                        }
                      ]
                    }
                    return []
                  }
                )
                return {
                  originalWidth: original.getBoundingClientRect().width,
                  modifiedLeft: modified.getBoundingClientRect().left - bounds.left,
                  starts
                }
              })
            const replacementLayout = await readDiffLayout('cooperation_preferences')
            await page.getByTestId(`${memorySelectors.tabPrefix}-project_background`).click()
            await projectPane.locator('.nc-memory-marker.added').waitFor({ state: 'visible' })
            const appendLayout = await readDiffLayout('project_background')
            await runtime.captureScreenshot({
              name: 'memory-wrapped-append-diff',
              message: '长中文记忆换行与追加 diff 对齐，旧稿不露出裁切文字。'
            })
            await runtime.assertThat(
              [replacementLayout, appendLayout].every(
                (layout) =>
                  layout.originalWidth <= 0.05 &&
                  Math.abs(layout.modifiedLeft) <= 0.05 &&
                  layout.starts.length >= 3 &&
                  layout.starts.every((line) => Math.abs(line.left) <= 0.5)
              ),
              {
                name: 'memory-inline-diff-text-alignment',
                message: '替换与追加 diff 均不保留旧稿窄栏，所有可见中文换行从同一起点显示。',
                data: { replacementLayout, appendLayout }
              }
            )
            await page.getByTestId(`${memorySelectors.tabPrefix}-cooperation_preferences`).click()
            const railTopBefore = await pane
              .locator('.nc-memory-viewport')
              .evaluate((element) => parseFloat((element as HTMLElement).style.top))
            const bounds = await rail.boundingBox()
            if (!bounds) throw new Error('Memory rail missing')
            await rail.click({ position: { x: 6, y: bounds.height - 6 } })
            const railTopAfter = await pane
              .locator('.nc-memory-viewport')
              .evaluate((element) => parseFloat((element as HTMLElement).style.top))
            await page.getByTestId(`${memorySelectors.tabPrefix}-project_background`).click()
            await page.getByTestId(`${memorySelectors.tabPrefix}-cooperation_preferences`).click()
            await page.waitForFunction(
              ({ paneId, expected }) => {
                const thumb = document.querySelector<HTMLElement>(
                  `[data-testid="${paneId}"] .nc-memory-viewport`
                )
                return thumb && Math.abs(parseFloat(thumb.style.top) - expected) < 1
              },
              {
                paneId: `${memorySelectors.panePrefix}-cooperation_preferences`,
                expected: railTopAfter
              }
            )
            await pane.locator('.monaco-editor textarea').last().focus()
            await page.keyboard.press('ControlOrMeta+End')
            await page.keyboard.insertText('\nUSER-MEMORY-EDIT-593')
            await waitForPartnerMemory(page, partner.id, (snapshot) =>
              Boolean(snapshot.memories[0].draft?.endsWith('USER-MEMORY-EDIT-593'))
            )
            await page
              .getByTestId(memorySelectors.panel)
              .getByTestId(memorySelectors.accept)
              .click()
            await page
              .getByTestId(`${memorySelectors.tabDotPrefix}-cooperation_preferences`)
              .waitFor({ state: 'hidden' })
            await pane.locator('.monaco-editor textarea').last().focus()
            await page.keyboard.press('ControlOrMeta+z')
            await waitForPartnerMemory(
              page,
              partner.id,
              (snapshot) => !snapshot.memories[0].confirmed.endsWith('USER-MEMORY-EDIT-593')
            )
            await page.keyboard.press('ControlOrMeta+Shift+z')
            await waitForPartnerMemory(page, partner.id, (snapshot) =>
              snapshot.memories[0].confirmed.endsWith('USER-MEMORY-EDIT-593')
            )
            await page
              .getByTestId(`${memorySelectors.tabDotPrefix}-project_background`)
              .waitFor({ state: 'visible' })
            await page.getByTestId(`${memorySelectors.tabPrefix}-project_background`).click()
            await page
              .getByTestId(memorySelectors.panel)
              .getByTestId(memorySelectors.reject)
              .click()
            await page.getByTestId(memorySelectors.dot).waitFor({ state: 'hidden' })
            await trigger.click()
            const confirmedSnapshot = await page.evaluate(
              (id) => window.api.partnerMemoryGet(id),
              partner.id
            )
            const nextStartedAt = Date.now()
            await sendWorkbenchMessage(page, '只回复收到，不要修改记忆。')
            await waitForWorkbenchAiRunCompletion(runtime, nextStartedAt, target.modelName)
            const nextRequest = (await collectWorkbenchLlmIoRecords(runtime))
              .filter(
                (record) => record.startedAt >= nextStartedAt && record.caller === 'human.brain'
              )
              .at(-1)
            const memoryResult = {
              initialUnchanged: pendingSnapshot.memories[0].confirmed === baseline,
              appendsAccumulated:
                pendingSnapshot.memories[0].draft?.includes('MEMORY-APPEND-A') &&
                pendingSnapshot.memories[0].draft?.includes('MEMORY-APPEND-B'),
              latestEdit: pendingSnapshot.memories[0].draft?.includes('直接表达'),
              pendingCategories: pendingSnapshot.memories.filter((item) => item.draft !== null)
                .length,
              memoryCalls: proposed.events.filter(
                (event) =>
                  event.type === 'tool_call_result' &&
                  event.result?.toolName === 'memory' &&
                  event.result.ok
              ).length,
              overviewStyle,
              redDots,
              railTopBefore,
              railTopAfter,
              confirmedEdited:
                confirmedSnapshot.memories[0].confirmed.endsWith('USER-MEMORY-EDIT-593'),
              rejectedProject:
                confirmedSnapshot.memories[1].confirmed === projectBaseline &&
                confirmedSnapshot.memories[1].draft === null,
              nextSystemUpdated: Boolean(
                nextRequest?.requestWire?.messages.some(
                  (message) =>
                    message.role === 'system' &&
                    message.content.includes('USER-MEMORY-EDIT-593') &&
                    !message.content.includes('MEMORY-PROJECT-731')
                )
              )
            }
            const state = await page.evaluate(async () => ({
              embedding: await window.api.getEmbeddingStatus(),
              download: await window.api.getActiveDownload()
            }))
            return {
              state,
              memoryResult,
              files: await fs.readdir(modelsPath, { recursive: true }),
              completed: evidence.events.some((event) => event.type === 'run_completed')
            }
          },
          assert: async (result, runtime) => {
            await runtime.assertThat(
              result.memoryResult.initialUnchanged &&
                result.memoryResult.appendsAccumulated &&
                result.memoryResult.latestEdit &&
                result.memoryResult.pendingCategories === 2 &&
                result.memoryResult.memoryCalls >= 5 &&
                Math.abs(result.memoryResult.overviewStyle.width - 18) <= 0.05 &&
                Math.abs(result.memoryResult.overviewStyle.thumbWidth - 18) <= 0.05 &&
                Math.abs(result.memoryResult.overviewStyle.markerWidth - 7) <= 0.05 &&
                Math.abs(
                  parseFloat(result.memoryResult.overviewStyle.border) -
                    Math.max(1, Math.floor(result.memoryResult.overviewStyle.dpr)) /
                      result.memoryResult.overviewStyle.dpr
                ) <= 0.05 &&
                result.memoryResult.overviewStyle.borderStyle === 'solid' &&
                result.memoryResult.overviewStyle.radius === '2px' &&
                !result.memoryResult.overviewStyle.hasTitle &&
                result.memoryResult.redDots === 2 &&
                result.memoryResult.railTopAfter > result.memoryResult.railTopBefore &&
                result.memoryResult.confirmedEdited &&
                result.memoryResult.rejectedProject &&
                result.memoryResult.nextSystemUpdated &&
                result.completed &&
                result.files.length === 0 &&
                result.state.download === null &&
                result.state.embedding.status === 'uninitialized' &&
                result.state.embedding.pid === null,
              {
                name: 'chat-without-knowledge-model',
                message:
                  '真实聊天完成，空模型目录未变化、无下载任务或 embedding 进程，对齐 WB-COMPOSER-001-AC5。',
                data: result
              }
            )
          }
        })
      } finally {
        await fs.rm(modelsPath, { recursive: true, force: true })
      }
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
