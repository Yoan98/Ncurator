import { expect, it } from 'vitest'
import {
  available,
  labels,
  menuItem,
  newTestEmail,
  openAccountMenu,
  readDesktopUserNo,
  withAccountFixture
} from '../../../../harness/e2e/account'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  createPartnerThroughWorkbenchUi,
  dismissWorkbenchLlmConfigMissingNotification,
  getWorkbenchLocator,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

it('managed-model-catalog', async () => {
  await withAccountFixture(async (setup, service) => {
    const model = service.model
    if (!model || model.visionLive)
      throw new Error('Configure the isolated managed catalog profile')
    await runE2ECase({
      ...setup,
      caseId: 'managed-model-catalog',
      domain: 'workbench',
      suite: 'conversation',
      groups: ['provider-matrix'],
      description: '核对馆长目录的登录边界、动态折扣、启停和选择保留。',
      fixtures: [],
      serviceMode: 'real',
      execution: 'exclusive',
      windowMode: 'visible',
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const modelName = model.label
        const loginPrompt = page.getByRole('button', {
          name: /登录享受 DeepSeek 模型\s*超低折扣/u
        })
        const picker = getWorkbenchLocator(page, workbenchSelectors.modelSelect).getByRole('button')
        const option = page.getByTestId(
          `${workbenchSelectors.modelSelectManagedOptionPrefix}-${model.id}`
        )
        const refresh = getWorkbenchLocator(page, workbenchSelectors.modelSelectCatalogRefresh)
        const inspector = getWorkbenchLocator(page, workbenchSelectors.inspector)
        await createPartnerThroughWorkbenchUi(page, '馆长目录回归')
        await dismissWorkbenchLlmConfigMissingNotification(page)
        const initial = await picker.innerText()
        await picker.click()
        await loginPrompt.waitFor()
        expect(await option.count()).toBe(0)
        await page.keyboard.press('Escape')

        let web = await service.browserPage()
        const email = newTestEmail('catalog')
        await service.authorize(runtime, web, email)
        web = await service.continueInBrowser(web)
        await openAccountMenu(page)
        await expect.poll(() => available(page).innerText()).toBe('¥0.00')
        await page.keyboard.press('Escape')
        expect(await picker.innerText()).toBe(initial)
        await picker.click()
        await option.getByText('DeepSeek V4.1 Flash', { exact: true }).waitFor()
        const icon = option.getByRole('img', { name: 'DeepSeek V4.1 Flash', exact: true })
        await expect.poll(() => icon.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
        await option.getByText(/7\.5\s*折/u).waitFor()
        await option.hover()
        await inspector.getByText('馆长余额', { exact: true }).waitFor()
        expect(await inspector.getByText(/折扣随.+官方定价动态调整/u).count()).toBe(0)
        await inspector.getByText(/7\.5\s*折/u).waitFor()
        expect(await inspector.getByText(/百万 Token|参考价|峰时|谷时/u).count()).toBe(0)
        expect(await inspector.getByText(/fixture-model|Synthetic supplier/u).count()).toBe(0)
        await option.click()
        await picker.getByText(modelName, { exact: true }).waitFor()

        const admin = await service.manager()
        await admin.goto('https://www.guanzhangai.cn/ops/models')
        await admin.getByRole('button', { name: '编辑 ' + modelName, exact: true }).click()
        await admin.getByLabel(/折扣系数/u).fill('0.8')
        await admin.getByRole('button', { name: '预览新售价', exact: true }).click()
        await admin
          .getByRole('dialog')
          .getByRole('button', { name: '确认保存', exact: true })
          .click()
        await admin.getByText('新售价已保存。', { exact: true }).waitFor()
        await admin.getByLabel('费用档位', { exact: true }).click()
        await admin.locator('.ant-select-dropdown:visible').getByText('低', { exact: true }).click()
        const description = '馆长目录条目的公开简介。折扣随模型的官方定价动态调整。'
        const descriptionField = admin.getByLabel('模型说明', { exact: true })
        if (!(await descriptionField.isVisible())) {
          await admin.getByText('更多设置', { exact: true }).click()
        }
        await descriptionField.fill(description)
        await admin.getByRole('button', { name: '保存模型', exact: true }).click()
        await admin.getByText('配置已保存。', { exact: true }).waitFor()

        await picker.click()
        await refresh.click()
        await option.getByText(/8\s*折/u).waitFor()
        expect(await option.getAttribute('aria-selected')).toBe('true')
        await option.hover()
        await inspector.getByText(/8\s*折/u).waitFor()
        await inspector.getByText(description, { exact: true }).waitFor()
        await inspector.getByText('价格档位', { exact: true }).waitFor()
        await inspector.getByText('较低', { exact: true }).waitFor()
        await runtime.captureScreenshot({
          name: 'managed-model-catalog-refreshed',
          message: '桌面刷新后显示后台保存的馆长模型简介和价格档位'
        })
        await page.keyboard.press('Escape')
        await service.recharge(web)
        await picker.getByText(modelName, { exact: true }).waitFor()

        await admin.getByRole('switch', { name: '启用模型', exact: true }).click()
        await admin.getByRole('button', { name: '保存模型', exact: true }).click()
        await admin.getByRole('row').filter({ hasText: modelName }).getByText('已停用').waitFor()
        await picker.click()
        await refresh.click()
        await option.waitFor({ state: 'hidden' })
        await page.keyboard.press('Escape')
        await picker.getByText('已下架，请重新选择', { exact: true }).waitFor()

        await openAccountMenu(page)
        await menuItem(page, labels.signOut).click()
        await picker.getByText('请先登录馆长', { exact: true }).waitFor()
        await picker.click()
        await loginPrompt.waitFor()
        expect(await option.count()).toBe(0)
        await page.keyboard.press('Escape')
        const nextWeb = await service.browserPage()
        const nextEmail = newTestEmail('second-catalog')
        await service.authorize(runtime, nextWeb, nextEmail)
        await picker.click()
        expect(await option.count()).toBe(0)
        expect(await readDesktopUserNo(page)).toBe(await service.userNumber(nextWeb))
        await runtime.captureScreenshot({
          name: 'managed-model-catalog-unavailable',
          message: '停用的馆长条目不会在新账号的选择列表中出现'
        })
        return {
          chargeCount: (await service.evidence(email)).calls.length,
          cachedOptionsAfterSwitch: await option.count()
        }
      },
      assert: async (result, runtime) =>
        runtime.assertThat(result.chargeCount === 0 && result.cachedOptionsAfterSwitch === 0, {
          name: 'managed-catalog-no-charge-or-stale-option',
          message: '目录查看、刷新、切换账号与充值保持正确的收费及模型选择边界',
          data: result
        })
    })
  })
}, 150_000)
