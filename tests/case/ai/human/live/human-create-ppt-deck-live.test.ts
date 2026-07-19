import fs from 'node:fs/promises'
import path from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import {
  findShapesOutsideCanvas,
  getShapeFillColor,
  getShapeRunFormat,
  getShapeStrokeColor,
  getShapeStrokeWidth,
  getShapeText,
  getSlideShapes,
  getSlides,
  getSlideText,
  hasShapeImage,
  loadPresentation,
  validatePresentation
} from 'pptx-kit'
import { describe, it } from 'vitest'
import { createPptToolRuntime } from '../../../../../src/main/services/ai/human/tools/ppt/runtime'
import {
  hasLiveLlmConfigInEnv,
  loadLiveLlmConfigFromEnv,
  loadLiveVisionLlmConfigFromEnv
} from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const FILE_NAME = 'AI产品季度复盘.pptx'
const MARKERS = ['增长引擎', '交付质量保持稳定', '下一步行动']
const REQUIRED_CONTENT = [
  ...MARKERS,
  '产品负责人',
  '推进核心体验',
  '交付负责人',
  '完善质量门禁',
  'PMO',
  '缩短决策链路',
  'Q3'
]
const ALLOWED_NUMERIC_TOKENS = new Set([
  '38%',
  '12',
  '78%',
  '98.7%',
  '92.4%',
  '0.3%',
  'Q3',
  '01',
  '02',
  '03'
])

const hasOnlySourceNumericTokens = (text: string): boolean =>
  (text.match(/\bQ\d+\b|\d+(?:\.\d+)?%?/gi) || []).every((token) =>
    ALLOWED_NUMERIC_TOKENS.has(token.toUpperCase())
  )

const buildLivePptRequest = (logoName: string): string =>
  [
    `请直接在工作区创建“${FILE_NAME}”，面向产品与交付管理团队制作三页 16:9 季度复盘。`,
    '',
    '内容白名单：',
    `- 第 1 页标题原样包含“${MARKERS[0]}”。只展示 ARR 同比增长 38%、新增企业客户 12 家、活跃使用率 78%，并使用本地图片“${logoName}”。`,
    `- 第 2 页标题原样包含“${MARKERS[1]}”。只展示需求准时交付率 98.7%、验收一次通过率 92.4%、严重缺陷率 0.3%。`,
    `- 第 3 页标题原样包含“${MARKERS[2]}”。只展示产品负责人推进核心体验、交付负责人完善质量门禁、PMO 缩短决策链路，以及 Q3 责任方向。`,
    '- 业务数字或季度只允许 38%、12、78%、98.7%、92.4%、0.3%、Q3；第 3 页视觉排序可用 01、02、03。',
    '- 禁止 2026、Q1、Q2、Q4、页码、其他指标数字，以及任何没有依据的做法、年份、季度或事实。',
    '',
    '设计约束：',
    '- 浅色或中性背景，至少两种强调色，并使用细边框或分隔线；禁止单一深蓝满版。',
    '- 三页使用不同布局；每页标题保持单行。',
    '- 主内容横向覆盖画布，左、中、右区域都有有效内容或视觉元素，禁止右半屏或一半以上画布留空。',
    '- 中文清晰可读，可直接用于正式汇报。',
    '',
    '执行与验收：',
    '- 只使用 PPT 和图像识别工具，不要使用 terminal。',
    '- 使用 PPT 工具逐页创建；每次提交一张内容完整的页面 HTML，禁止先建占位页再逐元素拼装。',
    '- 三页完成后一次性渲染全部页面，并使用图像识别逐页检查一次。',
    '- 图像检查必须确认标题没有换行，左右没有大面积无意义空白，也没有缺字、溢出、重叠或异常样式。',
    '- 如需修复，只复检修改页一次，并使用最近一次 ppt_render_slides 返回的新路径；最后确认文件已写回。'
  ].join('\n')

const imageContentMetrics = async (
  imagePath: string
): Promise<{ visiblePixelRatio: number; contentPixelRatiosByThird: number[] }> => {
  const image = await loadImage(imagePath)
  const canvas = createCanvas(image.width, image.height)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, image.width, image.height).data
  let sampled = 0
  let visible = 0
  const sampledByThird = [0, 0, 0]
  const contentByThird = [0, 0, 0]
  for (let index = 0; index < pixels.length; index += 64) {
    sampled += 1
    const pixelIndex = index / 4
    const x = pixelIndex % image.width
    const third = Math.min(2, Math.floor((x / image.width) * 3))
    sampledByThird[third]! += 1
    const red = pixels[index] || 0
    const green = pixels[index + 1] || 0
    const blue = pixels[index + 2] || 0
    const alpha = pixels[index + 3] || 0
    if (alpha > 16 && (red < 245 || green < 245 || blue < 245)) visible += 1
    if (alpha > 16 && red + green + blue < 650) contentByThird[third]! += 1
  }
  return {
    visiblePixelRatio: sampled > 0 ? visible / sampled : 0,
    contentPixelRatiosByThird: sampledByThird.map((count, index) =>
      count > 0 ? contentByThird[index]! / count : 0
    )
  }
}

const getShapeTextColor = (
  shape: ReturnType<typeof getSlideShapes>[number]
): string | undefined => {
  try {
    return getShapeText(shape) ? getShapeRunFormat(shape, 0, 0)?.color : undefined
  } catch {
    return undefined
  }
}

describe('ai human live backend', () => {
  it('human-create-ppt-deck-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-create-ppt-deck-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '验证真实 AI 使用 PPT 读写技能逐页创建可打开的两页 PPT，并在 run 结束后交付文件。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null,
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv())
            return { skipped: true, output: null, events: [], file: null }
          const primaryConfig = loadLiveLlmConfigFromEnv()
          const visionConfig = loadLiveVisionLlmConfigFromEnv()
          await runtime.seedLlmConfig(primaryConfig)
          await runtime.seedLlmConfig(visionConfig)
          const runner = createHumanTestRunner(runtime, {
            allowedToolNames: [
              'image_analyze',
              'ppt_read_outline',
              'ppt_read_slides',
              'ppt_render_slides',
              'ppt_edit'
            ],
            visionModel: {
              configId: visionConfig.id,
              modelName: visionConfig.model_name
            },
            runtimeSettingsOverride: { llmStreamingMode: 'force_non_stream' }
          })
          const selectedVisionConfig = await runner.ctx.getVisionLlmConfig()
          const logoName = 'ncurator-logo.png'
          await fs.copyFile(
            path.join(process.cwd(), 'src/renderer/src/assets/icon.png'),
            path.join(runtime.workspaceRoot, logoName)
          )
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput: buildLivePptRequest(logoName)
          })
          const filePath = path.join(runtime.workspaceRoot, FILE_NAME)
          const bytes = new Uint8Array(await fs.readFile(filePath))
          const presentation = await loadPresentation(bytes)
          const slides = getSlides(presentation)
          const shapes = slides.flatMap((slide) => getSlideShapes(slide))
          const visualRuntime = createPptToolRuntime({
            ctx: { saveFileChangeRecord: async () => undefined } as never,
            cache: {} as never,
            runId: `${runtime.runId}-visual-review`,
            sessionId: 'ppt-live-visual-review',
            taskId: runtime.taskId,
            workspaceRootPath: runtime.workspaceRoot,
            emitActivity: () => undefined
          })
          const renderedImages =
            slides.length > 0
              ? (((
                  await visualRuntime.render({
                    sourcePath: FILE_NAME,
                    ranges: [
                      { type: 'slide_index', fromSlideIndex: 1, toSlideIndex: slides.length }
                    ]
                  })
                ).images as Array<{ path: string }>) ?? [])
              : []
          const renderedImageMetrics = await Promise.all(
            renderedImages.map((image) => imageContentMetrics(image.path))
          )
          return {
            skipped: false,
            output,
            events: runtime.eventCollector.snapshot(),
            visionModelName: selectedVisionConfig.model_name,
            file: {
              path: filePath,
              slideCount: slides.length,
              text: slides.map((slide) => getSlideText(slide)).join('\n'),
              shapeCount: shapes.length,
              distinctVisualColors: [
                ...new Set(
                  shapes
                    .flatMap((shape) => [
                      getShapeFillColor(shape),
                      getShapeStrokeColor(shape),
                      getShapeTextColor(shape)
                    ])
                    .filter(Boolean)
                )
              ].length,
              strokedShapeCount: shapes.filter((shape) => Number(getShapeStrokeWidth(shape)) > 0)
                .length,
              imageShapeCount: shapes.filter(hasShapeImage).length,
              outsideShapeCount: slides.reduce(
                (count, slide) => count + findShapesOutsideCanvas(slide, presentation).length,
                0
              ),
              validationErrors: validatePresentation(presentation).filter(
                (issue) => issue.severity === 'error'
              ).length,
              renderedImageCount: renderedImages.length,
              visiblePixelRatios: renderedImageMetrics.map((metric) => metric.visiblePixelRatio),
              contentPixelRatiosByThird: renderedImageMetrics.map(
                (metric) => metric.contentPixelRatiosByThird
              )
            }
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped || !result.file) {
            runtime.assertThat(true, {
              name: 'live-config-not-provided',
              message: '未提供 live 模型配置，已跳过真实 AI 创建 PPT case。'
            })
            return
          }
          const startedTools = filterAiRunEventsByType(result.events, 'tool_call_started').map(
            (event) => event.toolName
          )
          const pptArtifacts = filterAiRunEventsByType(result.events, 'file_artifact').filter(
            (event) => event.capability === 'ppt' && Boolean(event.applyId)
          )
          runtime.assertThat(
            result.output?.status === 'completed' &&
              startedTools.filter((name) => name === 'ppt_edit').length >= 3 &&
              startedTools.includes('ppt_render_slides') &&
              startedTools.filter((name) => name === 'image_analyze').length >= 3 &&
              result.visionModelName === loadLiveVisionLlmConfigFromEnv().model_name &&
              result.file.slideCount === 3 &&
              REQUIRED_CONTENT.every((marker) => result.file!.text.includes(marker)) &&
              hasOnlySourceNumericTokens(result.file.text) &&
              result.file.shapeCount >= 9 &&
              result.file.distinctVisualColors >= 4 &&
              result.file.strokedShapeCount >= 1 &&
              result.file.imageShapeCount >= 1 &&
              result.file.outsideShapeCount === 0 &&
              result.file.validationErrors === 0 &&
              result.file.renderedImageCount === 3 &&
              result.file.visiblePixelRatios.every((ratio) => ratio > 0.015) &&
              result.file.contentPixelRatiosByThird.every((thirds) =>
                thirds.every((ratio) => ratio > 0.005)
              ) &&
              pptArtifacts.length === 1 &&
              result.output.artifacts.some(
                (artifact) => artifact.kind === 'file' && artifact.capability === 'ppt'
              ),
            {
              name: 'human-live-creates-three-page-ppt-through-ppt-skill',
              message:
                '真实 AI 应通过 ppt_edit 逐页创建三页 PPT，最终写回一个可打开文件并产生 PPT 修改记录。',
              data: {
                output: result.output,
                file: result.file,
                startedTools,
                pptArtifacts
              }
            }
          )
        }
      })
    })
  })
})
