import { expect, it } from 'vitest'
import {
  available,
  newTestEmail,
  openAccountMenu,
  readWebsiteWallet,
  refreshWallet,
  withAccountFixture
} from '../../../harness/e2e/account'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  createPartnerThroughWorkbenchUi,
  dismissWorkbenchLlmConfigMissingNotification,
  getWorkbenchLocator,
  sendWorkbenchMessage,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../harness/e2e/workbench'

it('balance-display-and-funds-state', async () => {
  await withAccountFixture(async (setup, service) => {
    const model = service.model
    if (!model || model.visionLive)
      throw new Error('Configure the isolated managed catalog profile')
    await runE2ECase({
      ...setup,
      caseId: 'balance-display-and-funds-state',
      domain: 'account',
      suite: 'overview',
      description: '核对零额、小额、精确值、退款冻结、结算中和欠费的跨端展示。',
      fixtures: [],
      serviceMode: 'real',
      execution: 'exclusive',
      windowMode: 'visible',
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const email = newTestEmail('small-balance')
        let web = await service.browserPage()
        await service.authorize(runtime, web, email)
        web = await service.continueInBrowser(web)
        const checkAmount = async (value: string, exact: string) => {
          await openAccountMenu(page)
          await expect.poll(() => available(page).innerText()).toBe(value)
          expect(await available(page).getAttribute('title')).toBe(exact + ' CNY')
          await page.keyboard.press('Escape')
        }
        await checkAmount('¥0.00', '0')
        const orderNo = await service.recharge(web)
        await refreshWallet(page)
        await checkAmount('¥5.00', '5')

        await createPartnerThroughWorkbenchUi(page, '小额余额回归')
        await dismissWorkbenchLlmConfigMissingNotification(page)
        await getWorkbenchLocator(page, workbenchSelectors.modelSelect).getByRole('button').click()
        await page
          .getByTestId(`${workbenchSelectors.modelSelectManagedOptionPrefix}-${model.id}`)
          .click()
        const startedAt = Date.now()
        await sendWorkbenchMessage(page, '确认隔离测试调用。')
        await waitForWorkbenchAiRunCompletion(runtime, startedAt, model.label, 20_000)
        const admin = await service.manager()
        await admin.goto('https://www.guanzhangai.cn/ops/orders?orderNo=' + orderNo)
        await admin
          .getByRole('region', { name: '充值详情' })
          .getByRole('link', { name: '办理退款', exact: true })
          .click()
        await admin.getByLabel('退款金额（元）').fill('4.99')
        await admin.getByRole('button', { name: '查看退款预览', exact: true }).click()
        await admin.getByRole('button', { name: '确认退款 ¥4.99', exact: true }).click()
        await admin.getByRole('heading', { name: '退款处理结果', exact: true }).waitFor()
        await admin
          .getByRole('row')
          .filter({ hasText: orderNo })
          .getByText('冻结中', { exact: true })
          .waitFor()
        await refreshWallet(page)

        await checkAmount('＜¥0.01', '0.009946')
        const calls = (await service.evidence(email)).calls
        expect(calls).toHaveLength(1)
        expect(calls[0]).toMatchObject({ paidAmount: '5400', feeDecision: 'charge' })

        await web.goto('https://www.guanzhangai.cn/account')
        await web.getByRole('heading', { name: '账户', exact: true }).waitFor()
        await web.getByRole('button', { name: '冻结金额 ¥4.99，查看构成', exact: true }).hover()
        const frozenDetails = web.getByRole('tooltip')
        await frozenDetails.getByText('冻结金额构成', { exact: true }).waitFor()
        await frozenDetails.getByText('退款冻结', { exact: true }).waitFor()
        expect(await frozenDetails.getByText('¥4.99', { exact: true }).count()).toBe(2)
        expect(await frozenDetails.getByText('模型调用预占', { exact: true }).count()).toBe(0)
        await web.getByText('＜¥0.01', { exact: true }).waitFor()
        const wallet = await readWebsiteWallet(web)
        expect(wallet).toMatchObject({ refundFrozen: '499000000', available: '994600' })
        await openAccountMenu(page)
        await runtime.captureScreenshot({
          name: 'nonzero-sub-cent-balance',
          message: '不足一分钱的可用金额保留为非零'
        })
        const exactBalance = await available(page).getAttribute('title')
        await page.keyboard.press('Escape')
        await service.arrangeSettlement(email, 'prepare')
        await refreshWallet(page)
        await openAccountMenu(page)
        await page.getByText('费用结算中', { exact: true }).waitFor()
        await web.reload()
        await web.getByText('费用结算中', { exact: true }).waitFor()
        await web.getByRole('button', { name: /^冻结金额 .+，查看构成$/u }).hover()
        await frozenDetails.getByText('模型调用预占', { exact: true }).waitFor()
        await frozenDetails.getByText('退款冻结', { exact: true }).waitFor()
        await frozenDetails.getByText('合计', { exact: true }).waitFor()
        expect((await readWebsiteWallet(web)).settlementPending).toBe(true)

        await service.arrangeSettlement(email, 'settle')
        await refreshWallet(page)
        await page.getByText('费用结算中', { exact: true }).waitFor({ state: 'hidden' })
        await checkAmount('−¥0.01', '-0.01')
        await web.reload()
        await web.getByText('欠费', { exact: true }).waitFor()
        expect(await readWebsiteWallet(web)).toMatchObject({
          available: '-1000000',
          settlementPending: false
        })
        return { modelCharges: calls.length, exactBalance }
      },
      assert: async ({ modelCharges, exactBalance }, runtime) =>
        runtime.assertThat(modelCharges === 1 && exactBalance === '0.009946 CNY', {
          name: 'sub-cent-balance-and-refund-freeze',
          message: '退款冻结单列，默认显示保留小额语义和实际精确值'
        })
    })
  })
}, 140_000)
