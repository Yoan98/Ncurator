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
    description:
      '创建或编辑 PPTX 文件，可在一次调用中连续完成页面新增、复制、移动、删除以及文字、元素和备注调整，成功后直接保存并返回修改后的相关页面。'
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
