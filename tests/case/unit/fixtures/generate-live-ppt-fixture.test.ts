import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createPptToolHarness } from '../../../harness/backend/aiToolHarness'
import { createRealAiHarness } from '../../../harness/backend/realAiHarness'
import { createIsolatedWorkspace } from '../../../harness/backend/workspaceManager'
import { createRunId } from '../../../harness/backend/write-run-log'
import { EventCollector } from '../../../harness/core/eventCollector'

const FIXTURE_PATH = path.resolve('tests/fixtures/workspace/品牌策略提案.pptx')

const textBox = (text: string, bounds: { x: number; y: number; width: number; height: number }, style?: Record<string, unknown>) => ({
  type: 'text' as const,
  text,
  bounds,
  style
})

describe('fixture generator', () => {
  it('generate-live-ppt-fixture', async () => {
    const workspaceRoot = await createIsolatedWorkspace('fixture-gen-ppt')
    const eventCollector = new EventCollector()
    const { runtime, dispose } = await createRealAiHarness({
      definition: { harnessMode: 'tool-real' },
      runId: createRunId(),
      taskId: 'generate-live-ppt-fixture',
      workspaceRoot,
      fixtureBindings: [],
      eventCollector,
      recordEvent: () => {}
    })
    const ppt = createPptToolHarness(runtime)
    const sourcePath = path.join(runtime.workspaceRoot, '品牌策略提案.pptx')

    const slides = [
      {
        background: '#F5F0E8',
        elements: [
          textBox('品牌策略提案', { x: 70, y: 60, width: 820, height: 70 }, { color: '#17324D', fontSize: 40, bold: true }),
          textBox('2026 秋季品牌升级方案', { x: 70, y: 150, width: 820, height: 50 }, { color: '#333333', fontSize: 22 }),
          textBox('汇报人：王晨', { x: 70, y: 420, width: 420, height: 40 }, { color: '#555555', fontSize: 18 })
        ]
      },
      {
        background: '#FFFFFF',
        elements: [
          textBox('议程', { x: 70, y: 50, width: 820, height: 55 }, { color: '#17324D', fontSize: 34, bold: true }),
          textBox('议程 关于品牌 市场分析 目标受众 营销策略 KPI 总结', { x: 90, y: 140, width: 780, height: 220 }, { color: '#333333', fontSize: 20 })
        ]
      },
      {
        background: '#FFFFFF',
        elements: [
          textBox('关于品牌', { x: 70, y: 50, width: 820, height: 55 }, { color: '#17324D', fontSize: 34, bold: true }),
          textBox('成立于 2002 年，专注生活方式品牌的长期价值建设。', { x: 90, y: 150, width: 780, height: 80 }, { color: '#333333', fontSize: 20 })
        ]
      },
      {
        background: '#FFFFFF',
        elements: [
          textBox('品牌定位', { x: 70, y: 50, width: 820, height: 55 }, { color: '#17324D', fontSize: 34, bold: true }),
          textBox('为都市年轻家庭提供高品质、可持续的出行与生活方式体验。', { x: 90, y: 150, width: 780, height: 100 }, { color: '#333333', fontSize: 20 })
        ]
      },
      {
        background: '#FFFFFF',
        elements: [
          textBox('核心价值', { x: 70, y: 50, width: 820, height: 55 }, { color: '#17324D', fontSize: 34, bold: true }),
          textBox('信任、品质、体验、可持续', { x: 90, y: 150, width: 780, height: 60 }, { color: '#333333', fontSize: 22, bold: true })
        ]
      },
      {
        background: '#FFFFFF',
        elements: [
          textBox('营销策略', { x: 70, y: 50, width: 820, height: 55 }, { color: '#17324D', fontSize: 34, bold: true }),
          textBox('内容种草 + 会员复购 + 区域联名活动，重点提升品牌心智份额。', { x: 90, y: 150, width: 780, height: 100 }, { color: '#333333', fontSize: 20 })
        ]
      },
      {
        background: '#FFFFFF',
        elements: [
          textBox('目标受众', { x: 70, y: 50, width: 820, height: 55 }, { color: '#17324D', fontSize: 34, bold: true }),
          textBox('25-40 岁一二线城市家庭用户，重视品质与效率。', { x: 90, y: 150, width: 780, height: 80 }, { color: '#333333', fontSize: 20 })
        ]
      },
      {
        background: '#FFFFFF',
        elements: [
          textBox('KPI 与关键指标', { x: 70, y: 50, width: 820, height: 55 }, { color: '#17324D', fontSize: 34, bold: true }),
          textBox('客户满意度 85% | 会员复购率 42% | 品牌搜索指数 +18%', { x: 90, y: 160, width: 780, height: 80 }, { color: '#C00000', fontSize: 24, bold: true }),
          {
            type: 'chart' as const,
            bounds: { x: 120, y: 260, width: 720, height: 220 },
            chartType: 'column' as const,
            categories: ['Q1', 'Q2', 'Q3'],
            series: [{ name: '品牌指数', values: [62, 71, 85] }],
            title: '品牌指数趋势'
          }
        ]
      },
      {
        background: '#17324D',
        elements: [
          textBox('品牌愿景', { x: 70, y: 50, width: 820, height: 55 }, { color: '#FFFFFF', fontSize: 34, bold: true }),
          textBox('成为现代、有意义出行的首选目的地', { x: 90, y: 200, width: 780, height: 100 }, { color: '#FFFFFF', fontSize: 28, bold: true })
        ]
      }
    ]

    for (const slide of slides) {
      await ppt.invoke('ppt_edit', { sourcePath, type: 'insert_slide', ...slide })
    }

    await fs.mkdir(path.dirname(FIXTURE_PATH), { recursive: true })
    await fs.copyFile(sourcePath, FIXTURE_PATH)
    await dispose()
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  })
})
