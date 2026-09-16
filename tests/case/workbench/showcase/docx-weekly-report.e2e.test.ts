import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { AiLlmUsage, AiRunEvent } from '../../../../src/shared/types'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  configureLiveModelThroughSettingsUi,
  createPartnerThroughWorkbenchUi,
  getWorkbenchLocator,
  loadWorkbenchLiveModelEnv,
  prepareWorkbenchWorkspaceThroughUi,
  readDocxPlainText,
  recordWorkbenchAiEvidence,
  selectWorkbenchModel,
  sendWorkbenchMessage,
  waitForApplyEntryByFileName,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../harness/e2e/workbench'

const CASE_ID = 'docx-weekly-report'
const FILE_NAME = '云枢智服-9月第2周经营周报.docx'
const EXPORT_DIR = path.resolve('tests/logs/workbench/showcase-export/docx-weekly-report')
const USD_CNY = 7.2
const PROMPT = [
  '根据工作区里的《站会纪要-0908.txt》《客户风险-星河.txt》《本周数字.md》，',
  '写一份可发给管理层的《云枢智服 9 月第 2 周经营周报》。',
  '要有本周进展、关键数字、风险与负责人、下周计划。语气正式，能直接转发。',
  `写到工作区，文件名用「${FILE_NAME}」。`
].join('')

const STANDUP_NOTES = `云枢 9/8 站会 随便记一下

交付
- 星河项目验收又拖了，苏明远说客户还在改验收口径，原定 9/12 大概率赶不上
- 内部联调周四才完，文档还缺两页
- 方立群：Q3 新增 ARR 目前 380 万，比目标慢

回款
- 星河 2 期尾款 126 万卡在验收，何书婷催了两次
- 清和 48 万这周能进

其它
- 郑晓彤：续费两家在观望，一家明确要看星河验收结果再签
- 陈嘉禾让出一页能直接转管理层的周报，别再贴站会原文
`

const XINGHE_RISK = `客户风险备忘 星河 / 内部勿外发

项目：星河智能仓储一期+二期
合同额：一期已确认 860 万；二期尾款 126 万，验收通过后 10 个工作日内付款
我方承诺：按期交付率 95%（例会纪要 8/21，陈嘉禾在场）
现状：
1. 客户验收条款从“功能清单”改成“连续 7 天无 P1”
2. 对方法务还要补充违约金上限
3. 若 9 月内验收不掉，二期尾款和续费都会一起停

建议：本周给林总一版可执行的风险说明，负责人苏明远 / 何书婷，不要写“风险已解除”。
`

const WEEKLY_NUMBERS = `# 本周数字（财务草稿，未对外）

- 本周确认收入：186 万（含清和 48 万）
- 本月累计确认收入：612 万
- 毛利率（月累计）：67.1%
- 在手订单：星河二期尾款 126 万；清和已回款
- 续费率（滚动 12 个月）：124%
- 本周新增线索 11 个，其中 3 个进入方案阶段

口径：收入含订阅，不含未验收的实施尾款。
`

const isDeepseekPeak = (date: Date): boolean => {
  const utcDay = date.getUTCDay()
  if (utcDay === 0 || utcDay === 6) return false
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes()
  return (minutes >= 60 && minutes < 240) || (minutes >= 360 && minutes < 600)
}

const collectUsage = (events: readonly AiRunEvent[]) => {
  let calls = 0
  let unavailableCalls = 0
  let inputTokens = 0
  let outputTokens = 0
  let cachedInputTokens = 0
  let cacheMissInputTokens = 0

  for (const event of events) {
    if (event.type !== 'activity' || event.status !== 'completed') continue
    const usage = event.details?.usage as AiLlmUsage | undefined
    if (!usage) continue
    calls += 1
    if (usage.source === 'unavailable') {
      unavailableCalls += 1
      continue
    }
    const input = usage.inputTokens || 0
    const cached = usage.cachedInputTokens || 0
    inputTokens += input
    outputTokens += usage.outputTokens || 0
    cachedInputTokens += cached
    cacheMissInputTokens += usage.cacheMissInputTokens || Math.max(0, input - cached)
  }

  return {
    calls,
    unavailableCalls,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheMissInputTokens
  }
}

const priceUsdPerMillion = (peak: boolean) =>
  peak
    ? { hit: 0.006, miss: 0.3, output: 1.2 }
    : { hit: 0.003, miss: 0.15, output: 0.6 }

const roundCny = (value: number): number => Math.round(value * 100) / 100

const seedWorkspace = async (): Promise<string> => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-showcase-docx-'))
  await fs.writeFile(path.join(rootPath, '站会纪要-0908.txt'), STANDUP_NOTES, 'utf8')
  await fs.writeFile(path.join(rootPath, '客户风险-星河.txt'), XINGHE_RISK, 'utf8')
  await fs.writeFile(path.join(rootPath, '本周数字.md'), WEEKLY_NUMBERS, 'utf8')
  return rootPath
}

describe('workbench showcase e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'showcase',
        groups: ['docx'],
        description: '官网样例：根据零散材料生成可发给管理层的 Word 周报，并截取预览页。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const env = loadWorkbenchLiveModelEnv()
          const rootPath = await seedWorkspace()
          runtime.registerResource({
            name: `showcase-workspace:${rootPath}`,
            phase: 'after-app-close',
            dispose: async () => {
              await fs.rm(rootPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
            }
          })
          await configureLiveModelThroughSettingsUi(page, env)
          await prepareWorkbenchWorkspaceThroughUi(page, {
            workspaceName: '云枢周报资料',
            rootPath
          })
          await createPartnerThroughWorkbenchUi(page, '云枢周报资料')
          await selectWorkbenchModel(page, env.modelName)

          const startedAtMs = Date.now()
          await sendWorkbenchMessage(page, PROMPT)
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)

          const filePath = path.join(rootPath, FILE_NAME)
          const fileExists = await fs
            .access(filePath)
            .then(() => true)
            .catch(() => false)
          const docxText = fileExists ? await readDocxPlainText(filePath) : ''

          const applyEntry = await waitForApplyEntryByFileName(page, FILE_NAME)
          await applyEntry.click()
          const viewer = getWorkbenchLocator(page, workbenchSelectors.docxViewer)
          await viewer.waitFor({ state: 'visible', timeout: 30_000 })
          const modeTag = getWorkbenchLocator(page, workbenchSelectors.documentModeTag)
          const modeText = ((await modeTag.textContent()) || '').trim()
          if (modeText.includes('审核')) {
            await getWorkbenchLocator(page, workbenchSelectors.documentModeToggle).click()
          }
          const scroller = viewer.locator('.docx-content')
          await scroller.locator('p, table, section').first().waitFor({
            state: 'visible',
            timeout: 30_000
          })
          await page.waitForTimeout(1200)

          await fs.rm(EXPORT_DIR, { recursive: true, force: true })
          await fs.mkdir(EXPORT_DIR, { recursive: true })
          const metrics = await scroller.evaluate((element) => ({
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight
          }))
          const screenshotNames: string[] = []
          const step = Math.max(160, metrics.clientHeight - 32)
          let offset = 0
          for (let index = 0; index < 4; index += 1) {
            await scroller.evaluate((element, top) => {
              element.scrollTop = top
            }, offset)
            await page.waitForTimeout(250)
            const fileName = `page-${index + 1}.png`
            await scroller.screenshot({
              path: path.join(EXPORT_DIR, fileName),
              type: 'png'
            })
            screenshotNames.push(fileName)
            if (offset + metrics.clientHeight >= metrics.scrollHeight - 8) break
            offset += step
          }

          const usage = collectUsage(evidence.events)
          const peak = isDeepseekPeak(new Date())
          const rates = priceUsdPerMillion(peak)
          const usd =
            (usage.cachedInputTokens / 1_000_000) * rates.hit +
            (usage.cacheMissInputTokens / 1_000_000) * rates.miss +
            (usage.outputTokens / 1_000_000) * rates.output
          const cny = roundCny(usd * USD_CNY)
          const cost = {
            modelName: env.modelName,
            modelLabel: 'DeepSeek V4.1 Flash',
            peak,
            usdCny: USD_CNY,
            prompt: PROMPT,
            fileName: FILE_NAME,
            pageCount: screenshotNames.length,
            usage,
            usd: roundCny(usd),
            cny,
            screenshotNames,
            durationMs: evidence.durationMs
          }
          await fs.writeFile(path.join(EXPORT_DIR, 'cost.json'), `${JSON.stringify(cost, null, 2)}\n`)
          runtime.signal({
            name: 'showcase-docx-cost',
            message: '官网 Word 样例实际消耗',
            data: cost
          })

          return {
            fileExists,
            docxText,
            screenshotCount: screenshotNames.length,
            usageCalls: usage.calls,
            cny,
            toolNames: evidence.events
              .filter((event) => event.type === 'tool_call_started')
              .map((event) => event.toolName)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.fileExists &&
              result.screenshotCount >= 1 &&
              result.usageCalls > 0 &&
              /周报|进展|风险|下周/u.test(result.docxText) &&
              result.toolNames.some((name) => name.startsWith('docx_')),
            {
              name: 'showcase-docx-weekly-report-ready',
              message: '应生成可预览的管理层周报 Word，并截到至少 1 页、记录到真实用量。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    1_800_000
  )
})
