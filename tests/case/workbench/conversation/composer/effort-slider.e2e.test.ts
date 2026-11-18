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
 * 档位只从官方目录来，因此用内置渠道走预设模式（配置名与渠道名一致才匹配）。
 * 选 dashscope：它有两个都开放强度的型号，才能真正验证「切走再切回」。
 *
 * 交互按 PRD：当前模型有强度时点胶囊只弹强度卡片，要点卡片里的模型名才让位给模型面板。
 */
const CASE_ID = 'effort-slider'
const PRIMARY = 'qwen3.8-flash'
const SECONDARY = 'qwen3.8-max'

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
          const effortValue = page.getByTestId(workbenchSelectors.effortValue)
          const effortPill = page.getByTestId(workbenchSelectors.effortPill)
          const effortModelName = page.getByTestId(workbenchSelectors.effortModelName)
          const tierOf = async () => (await effortValue.innerText()).trim()

          /** 从模型面板里选一个预设型号。 */
          const pickModel = async (modelName: string) => {
            const option = page.getByTestId(
              `${workbenchSelectors.modelSelectPresetOptionPrefix}-${modelName}`
            )
            await option.waitFor({ state: 'visible', timeout: 30_000 })
            await option.click()
          }

          // 1) 目录配了强度：胶囊回显档位名。
          await effortCard.waitFor({ state: 'visible', timeout: 30_000 })
          const initialTier = await tierOf()
          expect(initialTier.length).toBeGreaterThan(0)
          await expect
            .poll(async () => (await effortPill.innerText()).trim(), { timeout: 15_000 })
            .toBe(initialTier)

          // 2) 点档位小点切到最高档，档位名与胶囊同步。
          const stops = ['low', 'medium', 'xhigh']
          for (const stop of stops) {
            expect(
              await page.getByTestId(`${workbenchSelectors.effortStopPrefix}-${stop}`).count()
            ).toBe(1)
          }
          /* 挑一个与初始档不同的档位来切：初始档可能正好是最高档，
             直接用最高档断言会因「点了没变化」误判。 */
          const target = initialTier === 'XHigh' ? 'low' : 'xhigh'
          await page.getByTestId(`${workbenchSelectors.effortStopPrefix}-${target}`).click()
          await expect.poll(tierOf).not.toBe(initialTier)
          const chosenTier = await tierOf()
          await expect
            .poll(async () => (await effortPill.innerText()).trim(), { timeout: 10_000 })
            .toBe(chosenTier)

          // 3) 切到另一个开放强度的模型：档位不能沿用上一模型。
          await effortModelName.click()
          await pickModel(SECONDARY)
          await effortCard.waitFor({ state: 'visible', timeout: 30_000 })
          const secondaryInit = await tierOf()
          expect(secondaryInit.length).toBeGreaterThan(0)
          expect(secondaryInit).not.toBe(chosenTier)

          // 4) 切回原模型：恢复它上次选定的档位（WB-COMPOSER-018-AC3）。
          await effortModelName.click()
          await pickModel(PRIMARY)
          await effortCard.waitFor({ state: 'visible', timeout: 30_000 })
          expect(await tierOf()).toBe(chosenTier)

          // 5) 重启后档位随伙伴恢复。
          const restarted = await runtime.restartApp()
          const page2 = restarted.page
          await navigateToWorkbench(page2, { waitForSessionListText: false })
          const effortCard2 = page2.getByTestId(workbenchSelectors.effortCard)
          const visible = await effortCard2
            .waitFor({ state: 'visible', timeout: 30_000 })
            .then(() => true)
            .catch(() => false)
          if (!visible) throw new Error('重启后强度卡片未出现')
          expect((await page2.getByTestId(workbenchSelectors.effortValue).innerText()).trim()).toBe(
            chosenTier
          )
          expect((await page2.getByTestId(workbenchSelectors.effortPill).innerText()).trim()).toBe(
            chosenTier
          )
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
