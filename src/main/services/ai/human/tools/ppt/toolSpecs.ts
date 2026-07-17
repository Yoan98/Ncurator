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

type PptToolName =
  | 'ppt_read_outline'
  | 'ppt_read_slides'
  | 'ppt_search'
  | 'ppt_render_slides'
  | 'ppt_edit'

type PptToolSpec<
  TArgs extends JsonObject,
  TName extends PptToolName,
  TSkillId extends RuntimeSkillId
> = HumanToolSpec<TArgs, z.infer<typeof pptToolOutputSchema>, TName, TSkillId>

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
      '按百分比或页码区间读取 PPTX 页面提纲，并返回页面总数以及每页的 slideIndex、slideId、标题、文本摘要和元素数量。'
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
      '按页码区间或 slideId 集合读取 PPTX 页面及元素，并返回页面文字、讲者备注以及元素的位置、类型和样式。'
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
      '在 PPTX 页面文字和讲者备注中搜索文本并支持限制 slideId 范围，并返回命中页面、匹配来源、上下文和数量。'
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
    description: '将 PPTX 页面渲染为 PNG 图片，并返回每页的图片路径、slideId、slideIndex 和尺寸。'
  },
  resolveExecutionMeta: readExecutionMeta
} satisfies PptToolSpec<z.infer<typeof pptRenderSchema>, 'ppt_render_slides', 'ppt-read'>

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
    ].join('\n')
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
