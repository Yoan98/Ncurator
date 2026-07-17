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

type PptToolName = 'ppt_outline' | 'ppt_read_slides' | 'ppt_search' | 'ppt_render' | 'ppt_edit'

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

export const PPT_OUTLINE_TOOL_SPEC = {
  name: 'ppt_outline',
  familyId: 'ppt',
  requiresWorkspace: true,
  skillIds: ['ppt-read'],
  inputSchema: pptOutlineSchema,
  outputSchema: pptToolOutputSchema,
  promptSpec: {
    name: 'ppt_outline',
    description:
      '按百分比或页码区间读取 PPTX 页面提纲，返回页面总数、slideIndex、稳定 slideId、标题和文本摘要。slideIndex 从 1 开始。',
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
} satisfies PptToolSpec<z.infer<typeof pptOutlineSchema>, 'ppt_outline', 'ppt-read'>

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
      '按页码区间或 slideId 集合读取 PPTX 页面及其元素，返回可继续编辑的 elementId、位置、类型、文字和样式。',
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
      '搜索 PPTX 页面文字和讲者备注；scope.slideIds 存在时只搜索指定页面，返回命中页面、来源和上下文。',
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

export const PPT_RENDER_TOOL_SPEC = {
  name: 'ppt_render',
  familyId: 'ppt',
  requiresWorkspace: true,
  skillIds: ['ppt-read'],
  inputSchema: pptRenderSchema,
  outputSchema: pptToolOutputSchema,
  promptSpec: {
    name: 'ppt_render',
    description:
      '将指定 PPTX 页面渲染为 PNG，返回图片绝对路径、slideId、slideIndex 和尺寸。图片位于 <工作区>/.ncurator/runtime/assets/<assetBucketId>/ppt-render/。',
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
} satisfies PptToolSpec<z.infer<typeof pptRenderSchema>, 'ppt_render', 'ppt-read'>

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
      '创建或编辑 PPTX，每次调用执行一个 action。',
      'create_presentation 和 insert_slide 的 html 只包含一张 1920x1080 页面，唯一根节点为 data-ppt-slide；支持内联 CSS、文本、形状、工作区本地图片、SVG、表格、图表和 data-pptx-latex 公式。',
      '操作已有页面或元素时，slideId 和 elementId 必须来自 PPT 读取工具的真实返回。',
      '返回变化页面的 postWriteReadback 和布局警告；任一 action 失败时不保留本次调用的部分修改。'
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
  PPT_OUTLINE_TOOL_SPEC,
  PPT_READ_SLIDES_TOOL_SPEC,
  PPT_SEARCH_TOOL_SPEC,
  PPT_RENDER_TOOL_SPEC
] as const

export const PPT_WRITE_TOOL_SPECS = [PPT_EDIT_TOOL_SPEC] as const
export const PPT_TOOL_SPECS = [...PPT_READ_TOOL_SPECS, ...PPT_WRITE_TOOL_SPECS] as const
