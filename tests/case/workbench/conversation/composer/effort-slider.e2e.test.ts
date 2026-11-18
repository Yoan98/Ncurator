import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { listConfiguredLiveLlmTargets } from '../../../../harness/core/liveProviders'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  configureLiveModelThroughSettingsUi,
  getWorkbenchLocator,
  navigateToWorkbench,
  selectWorkbenchModel,
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
/** 目录里主型号的展示名，用于回读胶囊文本。 */
const PRIMARY_LABEL = 'Qwen3.8 Flash'
const STOPS = ['low', 'medium', 'xhigh'] as const

type EffortResult = {
  initialTier: string
  chosenTier: string
  secondaryTier: string
  stopCountOk: boolean
  switchedBackTier: string
  restoredTier: string
  restoredModel: string
}

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase<EffortResult>({
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
          const target = listConfiguredLiveLlmTargets().find(
            (entry) => entry.providerId === 'dashscope'
          )
          if (!target) {
            throw new Error('effort-slider 需要 AI_LIVE_KEY_DASHSCOPE 以配置真实目录渠道')
          }
          await configureLiveModelThroughSettingsUi(page, target)
          await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceContents: 'empty',
            configureModel: false
          })
          await navigateToWorkbench(page, { waitForSessionListText: false })

          // 全量回归的默认连接可能是 custom；本用例必须显式选择目录中的目标型号。
          await selectWorkbenchModel(page, PRIMARY, { preferCustom: false })
          const effortCard = page.getByTestId(workbenchSelectors.effortCard)
          const effortModelName = page.getByTestId(workbenchSelectors.effortModelName)
          const tierOf = async (target = page): Promise<string> =>
            (await target.getByTestId(workbenchSelectors.effortValue).innerText()).trim()
          const pillOf = async (target = page): Promise<string> =>
            (await target.getByTestId(workbenchSelectors.effortPill).innerText()).trim()
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
          if (!initialTier) throw new Error('初始档位名为空')
          if ((await pillOf()) !== initialTier) {
            throw new Error(`胶囊档位与卡片不一致：${await pillOf()} / ${initialTier}`)
          }

          // 2) 档位集合与目录一致：三档齐全，客户端不补齐。
          let stopCountOk = true
          for (const stop of STOPS) {
            const count = await page
              .getByTestId(`${workbenchSelectors.effortStopPrefix}-${stop}`)
              .count()
            if (count !== 1) stopCountOk = false
          }

          // 3) 点档位小点切到与初始档不同的档位。
          const targetTier = initialTier === 'XHigh' ? 'low' : 'xhigh'
          await page.getByTestId(`${workbenchSelectors.effortStopPrefix}-${targetTier}`).click()
          const expectedChosen = targetTier === 'low' ? 'Low' : 'XHigh'
          await page.waitForFunction(
            (input: { testId: string; tier: string }) =>
              document.querySelector(`[data-testid="${input.testId}"]`)?.textContent?.trim() ===
              input.tier,
            { testId: workbenchSelectors.effortValue, tier: expectedChosen },
            { timeout: 20_000 }
          )
          const chosenTier = await tierOf()

          // 4) 切到另一个开放强度的模型：档位不能沿用上一模型。
          await effortModelName.click()
          await pickModel(SECONDARY)
          await effortCard.waitFor({ state: 'visible', timeout: 30_000 })
          const secondaryTier = await tierOf()
          if (!secondaryTier) throw new Error('切换到第二模型后档位为空')
          if (secondaryTier === chosenTier) {
            throw new Error(`切换模型后沿用了上一模型的档位 ${chosenTier}`)
          }

          // 5) 切回原模型：恢复它上次选定的档位（WB-COMPOSER-018-AC3）。
          await effortModelName.click()
          await pickModel(PRIMARY)
          await effortCard.waitFor({ state: 'visible', timeout: 30_000 })
          await page.waitForFunction(
            (input: { testId: string; tier: string }) =>
              document.querySelector(`[data-testid="${input.testId}"]`)?.textContent?.trim() ===
              input.tier,
            { testId: workbenchSelectors.effortValue, tier: chosenTier },
            { timeout: 20_000 }
          )
          const switchedBackTier = await tierOf()

          // 6) 重启后模型与档位随伙伴恢复（WB-COMPOSER-018-AC3）。
          const restarted = await runtime.restartApp()
          const page2 = restarted.page
          await navigateToWorkbench(page2, { waitForSessionListText: false })
          await page2.waitForFunction(
            (testId: string) => Boolean(document.querySelector(`[data-testid="${testId}"]`)),
            workbenchSelectors.effortPill,
            { timeout: 90_000 }
          )
          const restoredTier = (
            await page2.getByTestId(workbenchSelectors.effortPill).innerText()
          ).trim()
          const restoredModel = (
            await getWorkbenchLocator(page2, workbenchSelectors.modelSelect).innerText()
          )
            .replace(/\s+/g, ' ')
            .trim()

          return {
            initialTier,
            chosenTier,
            secondaryTier,
            stopCountOk,
            switchedBackTier,
            restoredTier,
            restoredModel
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.stopCountOk &&
              result.chosenTier !== result.initialTier &&
              result.secondaryTier !== result.chosenTier &&
              result.switchedBackTier === result.chosenTier &&
              result.restoredTier === result.chosenTier &&
              result.restoredModel.includes(PRIMARY_LABEL),
            {
              message: [
                '思考强度：档位来源、切档、切模型回落与切走再切回/重启恢复',
                `初始=${result.initialTier} 选中=${result.chosenTier} 第二模型=${result.secondaryTier}`,
                `切回=${result.switchedBackTier} 重启后=${result.restoredTier}`,
                `重启后模型=${result.restoredModel}`
              ].join('；'),
              data: { ...result }
            }
          )
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
