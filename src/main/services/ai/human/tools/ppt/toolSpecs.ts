import type { z } from 'zod/v4'
import type { JsonObject } from '../../../../../../shared/types'
import type { RuntimeSkillId } from '../../types'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'
import {
  pptEditSchema,
  pptOutlineSchema,
  pptReadSlidesSchema,
  pptRenderSchema,
  pptSearchSchema,
  pptToolOutputSchema
} from './schemas'

type PptToolName = 'ppt_read_outline' | 'ppt_read_slides' | 'ppt_search' | 'ppt_render_slides' | 'ppt_edit'

type PptToolSpec<
  TArgs extends JsonObject,
  TName extends PptToolName,
  TSkillId extends RuntimeSkillId
> = HumanToolSpec<TArgs, z.infer<typeof pptToolOutputSchema>, TName, TSkillId>

const sourcePathExample = '季度复盘.pptx'
const readExecutionMeta = createStaticExecutionMetaResolver({
  mutability: 'read_only',
  getResourceKey: (args) => readStringArg(args, 'sourcePath'),
  defaultResourceKey: 'ppt'
})

export const PPT_READ_OUTLINE_TOOL_SPEC = {
  name: 'ppt_read_outline',
  familyId: 'ppt',
  requiresWorkspace: true,
  skillIds: ['ppt-read'],
  inputSchema: pptOutlineSchema,
  outputSchema: pptToolOutputSchema,
  promptSpec: {
    name: 'ppt_read_outline',
    description:
      '能力：按百分比或页码区间读取指定 PPTX 的页面提纲。\n结果：返回页面总数，以及每页的 slideIndex、slideId、标题、文本摘要和元素数量。\n边界：只返回页面级概览，不返回元素详情；slideIndex 从 1 开始，不修改文件。',
    whenToUse: '适用于了解 PPTX 整体结构或定位后续需要精读的页面。',
    examples: [
      {
        goal: '读取整份演示文稿的页面提纲',
        args: {
          sourcePath: sourcePathExample,
          ranges: [{ type: 'percent', fromPercent: 0, toPercent: 100 }]
        }
      }
    ]
  },
  resolveExecutionMeta: readExecutionMeta
} satisfies PptToolSpec<z.infer<typeof pptOutlineSchema>, 'ppt_read_outline', 'ppt-read'>

export const PPT_READ_SLIDES_TOOL_SPEC = {
  name: 'ppt_read_slides',
  familyId: 'ppt',
  requiresWorkspace: true,
  skillIds: ['ppt-read'],
  inputSchema: pptReadSlidesSchema,
  outputSchema: pptToolOutputSchema,
  promptSpec: {
    name: 'ppt_read_slides',
    description:
      '能力：按页码区间或 slideId 集合读取指定 PPTX 的页面及其元素。\n结果：返回页面文字、讲者备注，以及可继续编辑的 slideId、elementId、位置、类型和样式。\n边界：只读取指定页面，不修改文件；slideIndex 从 1 开始。',
    whenToUse: '适用于精读页面或在编辑前取得真实 slideId、elementId 和元素属性。',
    examples: [
      {
        goal: '精读第一页',
        args: {
          sourcePath: sourcePathExample,
          ranges: [{ type: 'slide_index', fromSlideIndex: 1, toSlideIndex: 1 }]
        }
      }
    ]
  },
  resolveExecutionMeta: readExecutionMeta
} satisfies PptToolSpec<z.infer<typeof pptReadSlidesSchema>, 'ppt_read_slides', 'ppt-read'>

export const PPT_SEARCH_TOOL_SPEC = {
  name: 'ppt_search',
  familyId: 'ppt',
  requiresWorkspace: true,
  skillIds: ['ppt-read'],
  inputSchema: pptSearchSchema,
  outputSchema: pptToolOutputSchema,
  promptSpec: {
    name: 'ppt_search',
    description:
      '能力：在指定 PPTX 的页面文字和讲者备注中搜索文本，可限制搜索的 slideId 范围。\n结果：返回命中页面、匹配来源、上下文和匹配数量。\n边界：只支持普通文本包含匹配，最多返回前 100 条，不修改文件。',
    whenToUse: '适用于按文字定位 PPTX 页面或备注。',
    examples: [
      {
        goal: '定位包含“增长引擎”的页面',
        args: { sourcePath: sourcePathExample, query: '增长引擎' }
      }
    ]
  },
  resolveExecutionMeta: readExecutionMeta
} satisfies PptToolSpec<z.infer<typeof pptSearchSchema>, 'ppt_search', 'ppt-read'>

export const PPT_RENDER_SLIDES_TOOL_SPEC = {
  name: 'ppt_render_slides',
  familyId: 'ppt',
  requiresWorkspace: true,
  skillIds: ['ppt-read'],
  inputSchema: pptRenderSchema,
  outputSchema: pptToolOutputSchema,
  promptSpec: {
    name: 'ppt_render_slides',
    description:
      '能力：将指定 PPTX 页面渲染为 PNG 图片。\n结果：返回每页的图片路径、slideId、slideIndex 和尺寸。\n边界：只生成页面预览，不修改演示文稿，不识别或解释图片内容。',
    whenToUse: '适用于需要检查页面实际视觉效果的任务。',
    examples: [
      {
        goal: '渲染第一页检查排版',
        args: {
          sourcePath: sourcePathExample,
          ranges: [{ type: 'slide_index', fromSlideIndex: 1, toSlideIndex: 1 }]
        }
      }
    ]
  },
  resolveExecutionMeta: readExecutionMeta
} satisfies PptToolSpec<z.infer<typeof pptRenderSchema>, 'ppt_render_slides', 'ppt-read'>

const createHtml =
  '<section data-ppt-slide style="position:relative;width:1920px;height:1080px"><h1 style="position:absolute;left:120px;top:120px;width:1680px;height:120px;font-size:64px">季度复盘</h1></section>'

export const PPT_EDIT_TOOL_SPEC = {
  name: 'ppt_edit',
  familyId: 'ppt',
  requiresWorkspace: true,
  skillIds: ['ppt-write'],
  inputSchema: pptEditSchema,
  outputSchema: pptToolOutputSchema,
  promptSpec: {
    name: 'ppt_edit',
    description: [
      '能力：创建或修改 PPTX。每次调用执行一个 action。',
      'action type=create_presentation：新建 PPTX，并使用 HTML 创建第一页；目标文件不能已存在。',
      'action type=insert_slide：使用 HTML 在指定页面前插入一页；不指定 beforeSlideId 时追加到末尾。',
      'action type=delete_slides：删除一个或多个指定页面。',
      'action type=move_slide：把指定页面移动到另一页面之前；不指定 beforeSlideId 时移动到末尾。',
      'action type=duplicate_slide：复制指定页面，并插入到指定位置或末尾。',
      'action type=replace_text：在整份演示文稿或指定页面中替换文字。',
      'action type=edit_elements：修改指定页面内的元素。',
      'action type=set_notes：设置指定页面的讲者备注。',
      '页面 HTML 支持内联 CSS、文本、形状、工作区本地图片、SVG、表格、图表和 data-pptx-latex 公式。',
      '结果：返回变化页面的 changedSlideIds、postWriteReadback 和布局警告。',
      '边界：每次只能执行一个 action；操作已有页面或元素时，slideId 和 elementId 必须来自 PPT 读取工具或 postWriteReadback 的真实结果；创建或插入页面时，HTML 只能包含一张 1920x1080 页面，并以 data-ppt-slide 为唯一根节点；action 失败时回滚本次修改。'
    ].join('\n'),
    whenToUse: '适用于创建 PPTX，或修改、插入、复制、移动、删除页面及页面元素。',
    examples: [
      {
        goal: '创建演示文稿第一页',
        args: {
          sourcePath: sourcePathExample,
          action: { type: 'create_presentation', html: createHtml }
        }
      }
    ]
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'mutating',
    getResourceKey: (args) => readStringArg(args, 'sourcePath'),
    defaultResourceKey: 'ppt'
  })
} satisfies PptToolSpec<z.infer<typeof pptEditSchema>, 'ppt_edit', 'ppt-write'>

export const PPT_READ_TOOL_SPECS = [
  PPT_READ_OUTLINE_TOOL_SPEC,
  PPT_READ_SLIDES_TOOL_SPEC,
  PPT_SEARCH_TOOL_SPEC,
  PPT_RENDER_SLIDES_TOOL_SPEC
] as const

export const PPT_WRITE_TOOL_SPECS = [PPT_EDIT_TOOL_SPEC] as const
export const PPT_TOOL_SPECS = [...PPT_READ_TOOL_SPECS, ...PPT_WRITE_TOOL_SPECS] as const
