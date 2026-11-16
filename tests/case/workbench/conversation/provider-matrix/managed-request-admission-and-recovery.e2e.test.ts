import { expect, it } from 'vitest'
import {
  accountNetwork,
  armAccountFault,
  available,
  newTestEmail,
  openAccountMenu,
  withAccountFixture
} from '../../../../harness/e2e/account'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  collectWorkbenchAiRunEvents,
  createPartnerThroughWorkbenchUi,
  dismissWorkbenchLlmConfigMissingNotification,
  getWorkbenchLocator,
  sendWorkbenchMessage,
  waitForWorkbenchAiEvent,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

it('managed-request-admission-and-recovery', async () => {
  await withAccountFixture(async (setup, service) => {
    const model = service.model
    if (!model?.visionLive) throw new Error('Configure the isolated managed model live profile')
    await runE2ECase({
      ...setup,
      caseId: 'managed-request-admission-and-recovery',
      domain: 'workbench',
      suite: 'conversation',
      description: '真实桌面验证零余额、停止已受理请求和原请求结果恢复。',
      fixtures: [],
      serviceMode: 'real',
      execution: 'live',
      windowMode: 'visible',
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const email = newTestEmail('request')
        let web = await service.browserPage()
        await service.authorize(runtime, web, email)
        web = await service.continueInBrowser(web)
        await createPartnerThroughWorkbenchUi(page, '馆长请求恢复回归')
        await dismissWorkbenchLlmConfigMissingNotification(page)
        await getWorkbenchLocator(page, workbenchSelectors.modelSelect).getByRole('button').click()
        await page
          .getByTestId(`${workbenchSelectors.modelSelectManagedOptionPrefix}-${model.id}`)
          .click()

        const start = async (text: string) => {
          const startedAt = Date.now()
          await sendWorkbenchMessage(page, text)
          return startedAt
        }
        await start('只回复 READY，不调用工具。')
        await waitForWorkbenchAiEvent(runtime, {
          name: 'managed-zero-balance-rejection',
          matches: (event) =>
            event.type === 'run_failed' &&
            event.providerCode === 'balance_insufficient' &&
            event.rawMessage?.includes('余额不足') === true
        })
        expect((await accountNetwork(runtime)).modelResponses).toEqual([402])
        expect((await service.evidence(email)).calls).toHaveLength(0)
        await service.recharge(web)

        const stopRunAt = await start('请从 1 开始逐行输出到 400，不调用任何工具。')
        const readStarted = async () =>
          (await collectWorkbenchAiRunEvents(runtime)).find(
            (event) => event.type === 'run_started' && event.createdAt >= stopRunAt
          )
        await expect.poll(async () => Boolean(await readStarted())).toBe(true)
        const started = await readStarted()
        await expect
          .poll(async () => (await service.evidence(email)).calls[0]?.executionStatus)
          .toBe('accepted')
        await page.getByRole('button', { name: '停止本次运行', exact: true }).click()
        await expect
          .poll(async () =>
            (await collectWorkbenchAiRunEvents(runtime)).some(
              (event) => event.type === 'run_cancelled' && event.runId === started?.runId
            )
          )
          .toBe(true)
        await expect
          .poll(async () => (await service.evidence(email)).calls[0]?.feeDecision)
          .toBe('waive')
        expect((await service.evidence(email)).calls[0].paidAmount).toBe('0')

        await armAccountFault(runtime, 'dropModelResult')
        const recoveryAt = await start('请只回复 READY。不要继续上轮任务或调用任何工具。')
        const recovered = await waitForWorkbenchAiRunCompletion(
          runtime,
          recoveryAt,
          model.label,
          55_000
        )
        expect(recovered.finalAnswerText.trim()).not.toBe('')
        const evidence = await service.evidence(email)
        const { modelPosts, modelLookups, droppedResults } = await accountNetwork(runtime)
        expect(modelPosts).toHaveLength(3)
        expect(new Set(modelPosts).size).toBe(3)
        expect(evidence.calls.map((call) => call.requestId)).toEqual(modelPosts.slice(1))
        expect(droppedResults).toBe(1)
        expect(modelLookups.filter((requestId) => requestId !== modelPosts[1])).toEqual([
          modelPosts[2]
        ])
        expect(evidence.calls[1]).toMatchObject({
          executionStatus: 'completed',
          feeDecision: 'charge'
        })
        const charge = BigInt(evidence.calls[1].paidAmount)
        expect(charge).toBeGreaterThan(0n)
        const wallet = evidence.vision?.wallet
        expect(wallet).toEqual({
          paidAvailableAmount: (500_000_000n - charge).toString(),
          usageFrozenAmount: '0',
          debtAmount: '0'
        })
        await openAccountMenu(page)
        const balance = Number(wallet!.paidAvailableAmount) / 100_000_000
        await expect.poll(() => available(page).getAttribute('title')).toBe(`${balance} CNY`)
        return { admitted: evidence.calls.length, recovered: droppedResults, balance }
      },
      assert: async (result, runtime) =>
        runtime.assertThat(result.admitted === 2 && result.recovered === 1, {
          name: 'managed-no-replay-after-cancel-or-lost-confirmation',
          message: '桌面停止后免收，完成确认丢失后只查回原请求和余额',
          data: result
        })
    })
  })
}, 165_000)
