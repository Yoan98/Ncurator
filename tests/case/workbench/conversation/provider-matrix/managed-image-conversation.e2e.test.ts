import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import type { Locator } from 'playwright'
import { expect, it } from 'vitest'
import {
  accountNetwork,
  available,
  newTestEmail,
  openAccountMenu,
  withAccountFixture
} from '../../../../harness/e2e/account'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  createPartnerThroughWorkbenchUi,
  dismissWorkbenchLlmConfigMissingNotification,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  selectWorkbenchAttachmentThroughNativeDialog,
  sendWorkbenchMessage,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const caseId = 'managed-image-conversation'
const openingFunds = 500_000_000n
const modelLabel = 'DeepSeek V4.1 Flash'
const modelIcon = 'https://www.guanzhangai.cn/llm/deepseek.png'

const expectModelPresentation = async (location: Locator) => {
  await location.getByText(modelLabel, { exact: true }).waitFor()
  const icon = location.getByRole('img', { name: modelLabel, exact: true })
  expect(await icon.getAttribute('src')).toBe(modelIcon)
  await expect
    .poll(() => icon.evaluate((element: HTMLImageElement) => element.naturalWidth), {
      timeout: 10_000,
      message: 'The official model icon loads and decodes in Electron'
    })
    .toBeGreaterThan(0)
}

it(
  caseId,
  async () => {
    await withAccountFixture(
      async (setup, service) => {
        const model = service.model
        if (!model?.visionLive)
          throw new Error('Configure the isolated managed vision live profile')
        await runE2ECase({
          ...setup,
          caseId: 'managed-image-conversation',
          domain: 'workbench',
          suite: 'conversation',
          groups: ['provider-matrix'],
          description: '使用真实馆长模型连续读两张图片，核对图片顺序和实际费用。',
          fixtures: [],
          serviceMode: 'real',
          execution: 'live',
          windowMode: 'visible',
          runMode: 'single',
          execute: async (runtime) => {
            const { page } = runtime
            const directory = await mkdtemp(join(tmpdir(), 'ncurator-managed-image-'))
            runtime.registerResource({
              name: 'managed-image-inputs',
              phase: 'after-app-close',
              dispose: () => rm(directory, { recursive: true, force: true })
            })
            const paths = [join(directory, 'fixture-a.png'), join(directory, 'fixture-b.png')]
            await Promise.all(
              ['#e31321', '#1d38de'].map((color, index) => {
                const canvas = createCanvas(320, 320)
                const context = canvas.getContext('2d')
                context.fillStyle = color
                context.fillRect(0, 0, 320, 320)
                return writeFile(paths[index], canvas.toBuffer('image/png'))
              })
            )
            let web = await service.browserPage()
            const email = newTestEmail('vision')
            await service.authorize(runtime, web, email)
            web = await service.continueInBrowser(web)
            await service.recharge(web)
            await createPartnerThroughWorkbenchUi(page, '馆长图文续聊回归')
            await dismissWorkbenchLlmConfigMissingNotification(page)
            const picker = getWorkbenchLocator(page, workbenchSelectors.modelSelect).getByRole(
              'button'
            )
            await picker.click()
            const option = page.getByTestId(
              `${workbenchSelectors.modelSelectManagedOptionPrefix}-${model.id}`
            )
            await expectModelPresentation(option)
            await option.click()
            await expectModelPresentation(picker)

            const sendImage = async (path: string, text: string) => {
              const answers = getWorkbenchPrefixLocator(
                page,
                workbenchSelectors.assistantFinalAnswerPrefix
              )
              const previousAnswers = await answers.count()
              await selectWorkbenchAttachmentThroughNativeDialog(page, path)
              const startedAt = Date.now()
              await sendWorkbenchMessage(page, text)
              await page.getByRole('button', { name: '停止本次运行', exact: true }).waitFor()
              await expectModelPresentation(picker)
              const result = await waitForWorkbenchAiRunCompletion(
                runtime,
                startedAt,
                modelLabel,
                55_000
              ).catch(async (error: Error) => {
                const { calls, vision } = await service.evidence(email)
                runtime.signal({
                  name: 'managed-vision-provider-status',
                  message: '记录真实上游状态、图片块计数及已受理调用终态',
                  status: 'failed',
                  data: {
                    upstreamStatuses: vision?.upstreamStatuses ?? [],
                    imageCounts: vision?.imageRequests.map((images) => images.length) ?? [],
                    callStates: calls.map((call) => call.executionStatus)
                  }
                })
                throw error
              })
              expect(
                result.events.some(
                  (event) => event.type === 'tool_call_result' && event.toolName === 'read_image'
                )
              ).toBe(true)
              await expect.poll(() => answers.count()).toBeGreaterThan(previousAnswers)
              const finalAnswer = answers.last()
              await finalAnswer.waitFor({ state: 'visible' })
              return finalAnswer.innerText()
            }

            const first = await sendImage(
              paths[0],
              '请只用 read_image 查看本条图片附件一次，然后只回复图片的主要颜色。直接根据图片回答，无需测量像素。不要调用终端、运行脚本或使用其他工具。'
            )
            expect(first).toMatch(/红|red/iu)
            const firstEvidence = await service.evidence(email)
            const original = firstEvidence.vision?.imageRequests.find(
              (images) => images.length === 1
            )
            if (!original) throw new Error('The first image did not reach the upstream model')

            const second = await sendImage(
              paths[1],
              '请只用 read_image 查看本条新附件一次，沿用上一轮图片的会话上下文，按先后顺序只回复两张图片的主要颜色。不要重读第一张图，不要调用终端、运行脚本或使用其他工具。'
            )
            expect(second).toMatch(/(?:红|red)[\s\S]*(?:蓝|blue)/iu)
            const evidence = await service.evidence(email)
            const vision = evidence.vision
            if (!vision) throw new Error('Missing managed vision settlement evidence')
            expect(
              vision.imageRequests
                .slice(firstEvidence.calls.length)
                .some(
                  (images) =>
                    images.length === 2 && images[0] === original[0] && images[1] !== original[0]
                )
            ).toBe(true)

            const { modelPosts } = await accountNetwork(runtime)
            expect(modelPosts).toEqual(evidence.calls.map((call) => call.requestId))
            expect(new Set(modelPosts).size).toBe(modelPosts.length)
            expect(vision.imageRequests).toHaveLength(evidence.calls.length)
            expect(vision.upstreamStatuses).toEqual(evidence.calls.map(() => 200))
            expect(evidence.calls.length).toBeGreaterThanOrEqual(4)
            const charged = evidence.calls.reduce((sum, call) => {
              expect(call.executionStatus).toBe('completed')
              expect(call.feeDecision).toBe('charge')
              expect(BigInt(call.inputTokens ?? 0)).toBeGreaterThan(0n)
              return sum + BigInt(call.paidAmount)
            }, 0n)
            expect(charged).toBeGreaterThan(0n)
            expect(vision.wallet).toEqual({
              paidAvailableAmount: (openingFunds - charged).toString(),
              usageFrozenAmount: '0',
              debtAmount: '0'
            })
            const messages = await page.evaluate(async () => {
              const [partner] = await window.api.partnerList()
              return partner ? window.api.partnerMessageList(partner.id) : []
            })
            expect(
              messages
                .filter((message) => message.role === 'user')
                .map((message) => message.attachments?.map((attachment) => attachment.name))
            ).toEqual([['fixture-a.png'], ['fixture-b.png']])
            expect(JSON.stringify(messages)).not.toContain('data:image/')
            await openAccountMenu(page)
            const desktopBalance = Number(vision.wallet.paidAvailableAmount) / 100_000_000
            await expect
              .poll(() => available(page).getAttribute('title'))
              .toBe(`${desktopBalance} CNY`)

            await web.goto('https://www.guanzhangai.cn/account')
            await web.getByRole('heading', { name: '账户', exact: true }).waitFor()
            await web.getByRole('link', { name: '模型使用', exact: true }).click()
            await web.getByRole('heading', { name: '模型使用', exact: true }).waitFor()
            const rows = web.getByRole('row').filter({ hasText: modelLabel })
            await expect.poll(() => rows.count()).toBe(evidence.calls.length)
            const charges = new Map(evidence.calls.map((call) => [call.requestId, call.paidAmount]))
            for (const row of await rows.all()) {
              const [reply] = await Promise.all([
                web.waitForResponse((response) =>
                  new URL(response.url()).pathname.startsWith('/api/account/billing/model-calls/')
                ),
                row.getByRole('button', { name: modelLabel + '详情', exact: true }).click()
              ])
              expect(reply.status()).toBe(200)
              const { requestId, netPaid } = (await reply.json()) as {
                requestId: string
                netPaid: string
              }
              expect(charges.get(requestId)).toBe(netPaid)
              charges.delete(requestId)
              const title = web.getByText('模型调用详情', { exact: true })
              await title.waitFor()
              await web.getByRole('button', { name: 'Close', exact: true }).click()
              await title.waitFor({ state: 'hidden' })
            }
            expect(charges.size).toBe(0)
            await runtime.captureScreenshot({
              name: 'managed-image-conversation-complete',
              message: '同一会话两次图片读取完成，桌面显示结算后的余额'
            })
            return {
              calls: evidence.calls.length,
              totalCharged: charged.toString(),
              desktopBalance
            }
          },
          assert: async (result, runtime) =>
            runtime.assertThat(result.calls >= 4 && BigInt(result.totalCharged) > 0n, {
              name: 'managed-vision-completion-and-settlement',
              message: '两轮图文通过真实模型完成，账单与桌面余额一致',
              data: result
            })
        })
      },
      { vision: true }
    )
  },
  165_000
)
