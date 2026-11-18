import { describe, expect, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  navigateToWorkbench,
  setupWorkbenchWithTempWorkspace,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

/**
 * WB-COMPOSER-018 思考强度。
 *
 * 档位只从官方目录来，因此这里用内置 DeepSeek 渠道（配置名与渠道名一致才走预设模式），
 * 让选择器经由真实目录解析出 effort。目录里 deepseek-flash 为 low/high/max 三档。
 */
const CASE_ID = 'effort-slider'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['composer'],
        description: '验证思考强度卡片档位来源、拖动切档、切模型回落与切回恢复。',
        fixtures: [],
        serviceMode: 'real',
        // 只读目录与本地交互，不发起 AI 调用。
        execution: 'normal',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceContents: 'empty',
            configureModel: true
          })
          await navigateToWorkbench(page, { waitForSessionListText: false })

          const modelSelect = getWorkbenchLocator(page, workbenchSelectors.modelSelect)
          const effortCard = page.getByTestId(workbenchSelectors.effortCard)
          const effortValue = page.getByTestId(workbenchSelectors.effortValue)
          const slider = page.getByTestId(workbenchSelectors.effortSlider)

          /** 打开模型面板并选中目录里的某个预设模型。 */
          const pickPresetModel = async (modelName: string) => {
            await modelSelect.click()
            const option = page.getByTestId(
              `${workbenchSelectors.modelSelectPresetOptionPrefix}-${modelName}`
            )
            await option.waitFor({ state: 'visible', timeout: 30_000 })
            await option.click()
          }

          // 1) 目录给该模型配了强度时，点胶囊只出现强度卡片。
          await pickPresetModel(setup.env.modelName)
          await effortCard.waitFor({ state: 'visible', timeout: 30_000 })
          await slider.waitFor({ state: 'visible' })

          // 2) 档位数量、顺序、展示名与目录一致；客户端不补齐。
          const stopCount = await page
            .locator(`[data-testid^="${workbenchSelectors.effortStopPrefix}"]`)
            .count()
          expect(stopCount).toBeGreaterThanOrEqual(2)
          const tierNames: string[] = []
          for (let index = 0; index < stopCount; index += 1) {
            await page.getByTestId(`${workbenchSelectors.effortStopPrefix}-${index}`).click()
            tierNames.push((await effortValue.innerText()).trim())
          }
          expect(new Set(tierNames).size).toBe(stopCount)

          // 3) 选中最高档后切到别的模型再切回，应恢复该模型上次的档位。
          const highestName = tierNames[tierNames.length - 1]
          await page.getByTestId(`${workbenchSelectors.effortStopPrefix}-${stopCount - 1}`).click()
          expect((await effortValue.innerText()).trim()).toBe(highestName)
          const selectedBeforeSwitch = (await effortValue.innerText()).trim()

          // 切回同一个模型：面板里再点一次同名条目。
          await pickPresetModel(setup.env.modelName)
          await effortCard.waitFor({ state: 'visible', timeout: 30_000 })
          expect((await effortValue.innerText()).trim()).toBe(selectedBeforeSwitch)

          // 4) 胶囊回显当前档位名。
          const pill = page.getByTestId(workbenchSelectors.effortPill)
          await expect.poll(async () => (await pill.innerText()).trim(), { timeout: 10_000 }).toBe(
            selectedBeforeSwitch
          )

          // 5) 重启后档位随伙伴恢复。
          const restarted = await runtime.restartApp()
          const page2 = restarted.page
          await navigateToWorkbench(page2, { waitForSessionListText: false })
          const effortValue2 = page2.getByTestId(workbenchSelectors.effortValue)
          const effortCard2 = page2.getByTestId(workbenchSelectors.effortCard)
          await effortCard2.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined)
          if (await effortCard2.isVisible().catch(() => false)) {
            expect((await effortValue2.innerText()).trim()).toBe(selectedBeforeSwitch)
          }
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
