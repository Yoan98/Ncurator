import { z } from 'zod/v4'
import { PPT_CANVAS_HEIGHT, PPT_CANVAS_WIDTH } from './color'

const sourcePathSchema = z.string().trim().min(1).describe('PPTX 文件本机绝对路径')
const slideIdSchema = z.string().trim().min(1).describe('页面 slideId')
const slideIndexSchema = z.number().int().min(1).describe('1-based 页码')
const elementIdSchema = z.string().min(1).describe('元素 elementId')
/** Opaque hex; `#` optional at runtime as兜底. Contract documents `#RRGGBB` only. */
const pptHexColorSchema = z
  .string()
  .regex(
    /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
    '颜色必须是 #RRGGBB（不透明）'
  )
  .describe('不透明颜色；#RRGGBB')

export const pptBoundsSchema = z
  .object({
    x: z.number().min(0).describe('左上角 X，单位 pt，须落在 960×540 画布内'),
    y: z.number().min(0).describe('左上角 Y，单位 pt，须落在 960×540 画布内'),
    width: z.number().positive().describe('宽度，单位 pt'),
    height: z
      .number()
      .positive()
      .describe('高度，单位 pt；含文字时须 ≥ fontSize（与字号同单位）')
  })
  .strict()
  .meta({ id: 'PptBounds' })

const pptPointSchema = z
  .object({
    x: z.number().min(0).describe('X，单位 pt，须落在 960×540 画布内'),
    y: z.number().min(0).describe('Y，单位 pt，须落在 960×540 画布内')
  })
  .strict()
  .meta({ id: 'PptPoint' })

export const pptElementStyleSchema = z
  .object({
    fill: pptHexColorSchema.optional(),
    stroke: pptHexColorSchema.optional(),
    strokeWidth: z.number().min(0).optional().describe('描边宽度，单位 pt'),
    color: pptHexColorSchema.optional(),
    fontFamily: z.string().optional().describe('字体'),
    fontSize: z
      .number()
      .positive()
      .optional()
      .describe(
        '字号，单位 pt，与 bounds 同单位；须 ≤ bounds.height；保持标题>正文>标注的层级，勿在矮框塞超大字'
      ),
    bold: z.boolean().optional().describe('是否加粗'),
    italic: z.boolean().optional().describe('是否斜体'),
    underline: z.boolean().optional().describe('是否下划线'),
    textAlign: z.enum(['left', 'center', 'right']).optional().describe('水平对齐'),
    verticalAlign: z.enum(['top', 'middle', 'bottom']).optional().describe('垂直对齐'),
    rotation: z.number().optional().describe('旋转角度，单位度'),
    shadow: z.boolean().optional().describe('是否投影')
  })
  .strict()
  .meta({ id: 'PptElementStyle' })

export const pptSlideRangeSchema = z
  .discriminatedUnion('type', [
    z
      .object({
        type: z.literal('slide_index').describe('按页码区间'),
        fromSlideIndex: slideIndexSchema,
        toSlideIndex: slideIndexSchema
      })
      .strict(),
    z
      .object({
        type: z.literal('slide_ids').describe('按 slideId 集合'),
        slideIds: z.array(slideIdSchema).min(1)
      })
      .strict()
  ])
  .meta({ id: 'PptSlideRange' })

const pptOutlineRangeSchema = z
  .discriminatedUnion('type', [
    z
      .object({
        type: z.literal('percent').describe('按百分比区间'),
        fromPercent: z.number().min(0).max(100).describe('起始比例，0–100'),
        toPercent: z.number().min(0).max(100).describe('结束比例，0–100')
      })
      .strict(),
    z
      .object({
        type: z.literal('slide_index').describe('按页码区间'),
        fromSlideIndex: slideIndexSchema,
        toSlideIndex: slideIndexSchema
      })
      .strict()
  ])
  .meta({ id: 'PptOutlineRange' })

export const pptOutlineSchema = z
  .object({
    sourcePath: sourcePathSchema,
    ranges: z.array(pptOutlineRangeSchema).min(1).describe('提纲读取区间')
  })
  .strict()

export const pptReadSlidesSchema = z
  .object({
    sourcePath: sourcePathSchema,
    ranges: z.array(pptSlideRangeSchema).min(1).describe('精读区间'),
    detail: z
      .enum(['full', 'images'])
      .optional()
      .describe('full=返回页面元素与 slideImagePath；images=仅返回 slideId、页码与 slideImagePath')
  })
  .strict()

export const pptSearchSchema = z
  .object({
    sourcePath: sourcePathSchema,
    query: z.string().min(1).describe('搜索文字'),
    scope: z
      .object({
        slideIds: z.array(slideIdSchema).min(1).describe('限定页面')
      })
      .strict()
      .optional()
      .describe('可选搜索范围')
  })
  .strict()

const chartTypeSchema = z.enum(['bar', 'column', 'line', 'pie', 'doughnut', 'area'])
const chartSeriesSchema = z
  .object({
    name: z.string().describe('系列名'),
    values: z.array(z.number()).min(1).describe('系列值')
  })
  .strict()
  .meta({ id: 'PptChartSeries' })
const imageFitSchema = z.enum(['contain', 'cover', 'stretch'])

export const pptElementSchema = z
  .discriminatedUnion('type', [
    z
      .object({
        type: z.literal('text').describe('文本框'),
        text: z.string().describe('文本内容'),
        bounds: pptBoundsSchema,
        style: pptElementStyleSchema.optional()
      })
      .strict(),
    z
      .object({
        type: z.literal('shape').describe('形状'),
        shape: z
          .enum(['rect', 'roundRect', 'ellipse', 'triangle', 'chevron', 'arrow'])
          .describe('形状预设'),
        bounds: pptBoundsSchema,
        text: z.string().optional().describe('形状内文字'),
        style: pptElementStyleSchema.optional()
      })
      .strict(),
    z
      .object({
        type: z.literal('line').describe('直线'),
        from: pptPointSchema.describe('起点'),
        to: pptPointSchema.describe('终点'),
        color: pptHexColorSchema.optional().describe('线条颜色；#RRGGBB'),
        width: z.number().positive().optional().describe('线条宽度，单位 pt'),
        arrowEnd: z.boolean().optional().describe('终点是否带箭头')
      })
      .strict(),
    z
      .object({
        type: z.literal('image').describe('图片'),
        assetPath: z.string().min(1).describe('本机或远程图片路径'),
        bounds: pptBoundsSchema,
        fit: imageFitSchema.optional().describe('缩放方式')
      })
      .strict(),
    z
      .object({
        type: z.literal('table').describe('表格'),
        bounds: pptBoundsSchema,
        rows: z.array(z.array(z.string()).min(1)).min(1).describe('单元格文字，从左到右、从上到下')
      })
      .strict(),
    z
      .object({
        type: z.literal('chart').describe('图表'),
        bounds: pptBoundsSchema,
        chartType: chartTypeSchema.describe('图表类型'),
        categories: z.array(z.string()).min(1).describe('类目'),
        series: z.array(chartSeriesSchema).min(1).describe('数据系列'),
        title: z.string().optional().describe('图表标题')
      })
      .strict(),
    z
      .object({
        type: z.literal('formula').describe('公式'),
        latex: z.string().min(1).describe('LaTeX'),
        bounds: pptBoundsSchema
      })
      .strict()
  ])
  .meta({ id: 'PptElement' })

const pptElementOperationSchema = z
  .discriminatedUnion('type', [
    z
      .object({
        type: z.literal('set_text').describe('改文字'),
        elementId: elementIdSchema,
        text: z.string().describe('新文字')
      })
      .strict(),
    z
      .object({
        type: z.literal('set_bounds').describe('改位置或大小'),
        elementId: elementIdSchema,
        bounds: pptBoundsSchema
      })
      .strict(),
    z
      .object({
        type: z.literal('set_style').describe('改样式'),
        elementId: elementIdSchema,
        style: pptElementStyleSchema
      })
      .strict(),
    z
      .object({
        type: z.literal('set_z_order').describe('改图层'),
        elementId: elementIdSchema,
        placement: z.enum(['front', 'back', 'forward', 'backward']).describe('图层方向')
      })
      .strict(),
    z
      .object({
        type: z.literal('delete_element').describe('删除元素'),
        elementId: elementIdSchema
      })
      .strict(),
    z
      .object({
        type: z.literal('duplicate_element').describe('复制元素'),
        elementId: elementIdSchema
      })
      .strict(),
    z
      .object({
        type: z.literal('add_element').describe('新增元素'),
        element: pptElementSchema
      })
      .strict(),
    z
      .object({
        type: z.literal('replace_image').describe('替换图片'),
        elementId: elementIdSchema,
        assetPath: z.string().min(1).describe('本机或远程图片路径'),
        fit: imageFitSchema.optional().describe('缩放方式')
      })
      .strict(),
    z
      .object({
        type: z.literal('update_table').describe('改表格单元格'),
        elementId: elementIdSchema,
        cells: z
          .array(
            z
              .object({
                rowIndex: z.number().int().min(1).describe('行号，从 1 开始'),
                columnIndex: z.number().int().min(1).describe('列号，从 1 开始'),
                text: z.string().describe('单元格文字')
              })
              .strict()
          )
          .min(1)
      })
      .strict(),
    z
      .object({
        type: z.literal('update_chart').describe('改图表数据'),
        elementId: elementIdSchema,
        chartType: chartTypeSchema.describe('图表类型'),
        categories: z.array(z.string()).min(1).describe('类目'),
        series: z.array(chartSeriesSchema).min(1).describe('数据系列'),
        title: z.string().optional().describe('图表标题')
      })
      .strict(),
    z
      .object({
        type: z.literal('update_formula').describe('改公式'),
        elementId: elementIdSchema,
        latex: z.string().min(1).describe('LaTeX')
      })
      .strict()
  ])
  .meta({ id: 'PptElementOperation' })

const pptSlideLocationSchema = z
  .object({
    slideId: slideIdSchema.describe('锚点页面'),
    position: z.enum(['before', 'after']).describe('相对锚点的位置')
  })
  .strict()
  .meta({ id: 'PptSlideLocation' })

const pptSlideDefaultsSchema = z
  .object({
    color: pptHexColorSchema.optional().describe('默认文字颜色；#RRGGBB'),
    fontFamily: z.string().optional().describe('默认字体'),
    fontSize: z
      .number()
      .positive()
      .optional()
      .describe('默认字号，单位 pt，与 bounds 同单位；须 ≤ 对应文字框 height')
  })
  .strict()
  .meta({ id: 'PptSlideDefaults' })

const pptSlideSpecFields = {
  background: pptHexColorSchema
    .optional()
    .describe('页面背景色；#RRGGBB；insert_slide 省略为白色，replace_slide 省略则保留原值'),
  notes: z.string().optional().describe('讲者备注；replace_slide 省略则保留原值'),
  defaults: pptSlideDefaultsSchema.optional().describe('本页未设样式的文字默认值'),
  elements: z
    .array(pptElementSchema)
    .describe(
      '页面元素规格，按叠放顺序；画布 960×540（单位 pt，与字号同单位）；元素须完整落在画布内；保持字号层级与对齐，避免重叠抢位与对比不足；按内容自拟版式，不套固定留白模板；可为空页'
    )
}

const editBase = { sourcePath: sourcePathSchema }

export const pptEditSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...editBase,
      type: z.literal('insert_slide').describe('插入新页面'),
      location: pptSlideLocationSchema.optional().describe('插入位置；省略则追加到末尾'),
      ...pptSlideSpecFields
    })
    .strict(),
  z
    .object({
      ...editBase,
      type: z.literal('replace_slide').describe('按规格重写已有页面，保留 slideId'),
      slideId: slideIdSchema,
      ...pptSlideSpecFields
    })
    .strict(),
  z
    .object({
      ...editBase,
      type: z.literal('delete_slides').describe('删除页面；最终至少保留一页'),
      slideIds: z.array(slideIdSchema).min(1).describe('要删除的 slideId')
    })
    .strict(),
  z
    .object({
      ...editBase,
      type: z.literal('move_slide').describe('移动页面；location 不能锚定自身'),
      slideId: slideIdSchema,
      location: pptSlideLocationSchema
    })
    .strict(),
  z
    .object({
      ...editBase,
      type: z.literal('duplicate_slide').describe('复制页面'),
      slideId: slideIdSchema,
      location: pptSlideLocationSchema.optional().describe('复制后的位置；省略则追加到末尾')
    })
    .strict(),
  z
    .object({
      ...editBase,
      type: z.literal('replace_text').describe('替换页面文字'),
      query: z.string().min(1).describe('原文'),
      replace: z.string().describe('替换后的文字'),
      slideIds: z.array(slideIdSchema).min(1).optional().describe('限定页面；省略则全文替换')
    })
    .strict(),
  z
    .object({
      ...editBase,
      type: z.literal('edit_elements').describe('按 elementId 修改当前页元素'),
      slideId: slideIdSchema,
      operations: z.array(pptElementOperationSchema).min(1).describe('同一页上的元素操作，可批量')
    })
    .strict(),
  z
    .object({
      ...editBase,
      type: z.literal('set_notes').describe('设置讲者备注'),
      slideId: slideIdSchema,
      text: z.string().describe('备注全文')
    })
    .strict()
])

export type {
  PptEditOutput,
  PptReadOutlineOutput,
  PptReadSlidesOutput,
  PptSearchOutput
} from './outputTypes'

export type PptOutlineInput = z.infer<typeof pptOutlineSchema>
export type PptReadSlidesInput = z.infer<typeof pptReadSlidesSchema>
export type PptSearchInput = z.infer<typeof pptSearchSchema>
export type PptEditInput = z.infer<typeof pptEditSchema>
export type PptSlideRange = z.infer<typeof pptSlideRangeSchema>
export type PptElement = z.infer<typeof pptElementSchema>
export type PptElementOperation = z.infer<typeof pptElementOperationSchema>
export type PptSlideDefaults = z.infer<typeof pptSlideDefaultsSchema>

/** Default text fontSize when omitted (matches runtime applyShapeStyle). */
export const PPT_DEFAULT_TEXT_FONT_SIZE_PT = 18

export const assertPptTextFitsBounds = (input: {
  fontSize: number
  boundsHeight: number
}): void => {
  if (input.fontSize > input.boundsHeight) {
    throw new Error(
      `字号 ${input.fontSize}pt 超过框高 ${input.boundsHeight}pt：请增大 height 或减小 fontSize`
    )
  }
}

export const assertPptElementTextFitsBounds = (element: PptElement): void => {
  if (element.type === 'text') {
    assertPptTextFitsBounds({
      fontSize: element.style?.fontSize ?? PPT_DEFAULT_TEXT_FONT_SIZE_PT,
      boundsHeight: element.bounds.height
    })
    return
  }
  if (element.type === 'shape' && String(element.text || '').length > 0) {
    assertPptTextFitsBounds({
      fontSize: element.style?.fontSize ?? PPT_DEFAULT_TEXT_FONT_SIZE_PT,
      boundsHeight: element.bounds.height
    })
  }
}

export const assertPptElementInCanvas = (element: PptElement): void => {
  const fail = (detail: string): never => {
    throw new Error(`元素超出 ${PPT_CANVAS_WIDTH}×${PPT_CANVAS_HEIGHT} 画布：${detail}`)
  }
  const pointInCanvas = (x: number, y: number, label: string): void => {
    if (x < 0 || y < 0 || x > PPT_CANVAS_WIDTH || y > PPT_CANVAS_HEIGHT) {
      fail(`${label} (${x}, ${y})`)
    }
  }
  if (element.type === 'line') {
    pointInCanvas(element.from.x, element.from.y, 'from')
    pointInCanvas(element.to.x, element.to.y, 'to')
    return
  }
  const { x, y, width, height } = element.bounds
  pointInCanvas(x, y, 'origin')
  if (x + width > PPT_CANVAS_WIDTH + 1 || y + height > PPT_CANVAS_HEIGHT + 1) {
    fail(`right=${x + width}, bottom=${y + height}`)
  }
}

export const assertPptElementSpec = (element: PptElement): void => {
  assertPptElementInCanvas(element)
  assertPptElementTextFitsBounds(element)
}

export const applyPptSlideDefaults = (
  element: PptElement,
  defaults: PptSlideDefaults | undefined
): PptElement => {
  if (!defaults || (element.type !== 'text' && element.type !== 'shape')) return element
  return {
    ...element,
    style: {
      color: defaults.color,
      fontFamily: defaults.fontFamily,
      fontSize: defaults.fontSize,
      ...element.style
    }
  }
}
