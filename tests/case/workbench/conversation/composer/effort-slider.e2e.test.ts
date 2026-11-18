import { describe, it } from 'vitest'
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
 * 档位只从官方目录来，因此用内置渠道走预设模式（配置名与渠道名一致才匹配）。
 * 选 dashscope：它有两个都开放强度的型号，才能真正验证「切走再切回」。
 *
 * 交互按 PRD：当前模型有强度时点胶囊只弹强度卡片，要点卡片里的模型名才让位给模型面板。
 */
const CASE_ID = 'effort-slider'
const PRIMARY = 'qwen3.8-flash'
const SECONDARY = 'qwen3.8-max'

const fail = (message: string): never => {
  throw new Error(message)
}

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['composer'],
        description: '验证思考强度档位来源、点档切档、切模型回落与切走再切回恢复。',
        fixtures: [],
        serviceMode: 'real',
        // 只读目录与本地交互，不发起 AI 调用。
        execution: 'normal',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceContents: 'empty',
            configureModel: true
          })
          await navigateToWorkbench(page, { waitForSessionListText: false })

          const modelSelect = getWorkbenchLocator(page, workbenchSelectors.modelSelect)
          const effortCard = page.getByTestId(workbenchSelectors.effortCard)
          const effortModelName = page.getByTestId(workbenchSelectors.effortModelName)
          const tierOf = async (target = page) =>
            (await target.getByTestId(workbenchSelectors.effortValue).innerText()).trim()
          const waitTier = async (tier: string, target = page): Promise<void> => {
            await target.waitForFunction(
              (input: { testId: string; tier: string }) =>
                document.querySelector(`[data-testid="${input.testId}"]`)?.textContent?.trim() ===
                input.tier,
              { testId: workbenchSelectors.effortValue, tier },
              { timeout: 30_000 }
            )
          }
          const pickModel = async (modelName: string): Promise<void> => {
            const option = page.getByTestId(
              `${workbenchSelectors.modelSelectPresetOptionPrefix}-${modelName}`
            )
            await option.waitFor({ state: 'visible', timeout: 30_000 })
            await option.click()
          }

          // 1) 目录配了强度：卡片出现，档位名与胶囊一致。
          await effortCard.waitFor({ state: 'visible', timeout: 30_000 })
          const initialTier = await tierOf()
          if (!initialTier) fail('初始档位名为空')
          await page.waitForFunction(
            (input: { testId: string; tier: string }) =>
              document.querySelector(`[data-testid="${input.testId}"]`)?.textContent?.trim() ===
              input.tier,
            { testId: workbenchSelectors.effortPill, tier: initialTier },
            { timeout: 15_000 }
          )

          // 2) 档位集合与目录一致：三档齐全，客户端不补齐。
          for (const stop of ['low', 'medium', 'xhigh']) {
            const count = await page
              .getByTestId(`${workbenchSelectors.effortStopPrefix}-${stop}`)
              .count()
            if (count !== 1) fail(`档位 ${stop} 的小点数量为 ${count}`)
          }

          // 3) 点档位小点切到与初始档不同的档位。
          const targetTier = initialTier === 'XHigh' ? 'low' : 'xhigh'
          await page.getByTestId(`${workbenchSelectors.effortStopPrefix}-${targetTier}`).click()
          await waitTier(targetTier === 'low' ? 'Low' : 'XHigh')
          const chosenTier = await tierOf()

          // 4) 切到另一个开放强度的模型：档位不能沿用上一模型。
          await effortModelName.click()
          await pickModel(SECONDARY)
          await effortCard.waitFor({ state: 'visible', timeout: 30_000 })
          const secondaryTier = await tierOf()
          if (!secondaryTier) fail('切换到第二模型后档位为空')
          if (secondaryTier === chosenTier) fail(`切换模型后沿用了上一模型的档位 ${chosenTier}`)

          // 5) 切回原模型：恢复它上次选定的档位（WB-COMPOSER-018-AC3）。
          await effortModelName.click()
          await pickModel(PRIMARY)
          await effortCard.waitFor({ state: 'visible', timeout: 30_000 })
          await waitTier(chosenTier)

          // 6) 重启后档位随伙伴恢复（胶囊回显即可，卡片需点开才显示）。
          const restarted = await runtime.restartApp()
          const page2 = restarted.page
          await navigateToWorkbench(page2, { waitForSessionListText: false })
          await page2.waitForFunction(
            (input: { testId: string; tier: string }) =>
              document.querySelector(`[data-testid="${input.testId}"]`)?.textContent?.trim() ===
              input.tier,
            { testId: workbenchSelectors.effortPill, tier: chosenTier },
            { timeout: 60_000 }
          )
          await getWorkbenchLocator(page2, workbenchSelectors.modelSelect).click()
          const card2 = page2.getByTestId(workbenchSelectors.effortCard)
          await card2.waitFor({ state: 'visible', timeout: 30_000 })
          const restoredTier = await tierOf(page2)
          if (restoredTier !== chosenTier) {
            fail(`重启后档位 ${restoredTier} != ${chosenTier}`)
          }
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
