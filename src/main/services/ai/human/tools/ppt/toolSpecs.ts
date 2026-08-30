import type { z } from 'zod/v4'
import type { JsonObject } from '../../../../../../shared/types'
import type { RuntimeSkillId } from '../../types'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'
import {
  renderPptOutlineModelResult,
  renderPptReadSlidesModelResult,
  renderPptSearchModelResult
} from '../../shared/modelToolResultRenderers'
import {
  pptEditSchema,
  pptEditOutputSchema,
  pptOutlineSchema,
  pptReadOutlineOutputSchema,
  pptReadSlidesSchema,
  pptReadSlidesOutputSchema,
  pptSearchOutputSchema,
  pptSearchSchema
} from './toolSchemas'

type PptToolName = 'ppt_read_outline' | 'ppt_read_slides' | 'ppt_search' | 'ppt_edit'

type PptToolSpec<
  TArgs extends JsonObject,
  TOutput extends JsonObject,
  TName extends PptToolName,
  TSkillId extends RuntimeSkillId
> = HumanToolSpec<TArgs, TOutput, TName, TSkillId>

const readExecutionMeta = createStaticExecutionMetaResolver({
  mutability: 'read_only',
  getResourceKey: (args) => readStringArg(args, 'sourcePath'),
  defaultResourceKey: 'ppt'
})

export const PPT_READ_OUTLINE_TOOL_SPEC = {
  name: 'ppt_read_outline',
  familyId: 'ppt',
  skillIds: ['ppt-read'],
  inputSchema: pptOutlineSchema,
  outputSchema: pptReadOutlineOutputSchema,
  promptSpec: {
    name: 'ppt_read_outline',
    description: '返回 PPTX 页面提纲。'
  },
  resolveExecutionMeta: readExecutionMeta,
  modelResult: { renderSuccess: renderPptOutlineModelResult }
} satisfies PptToolSpec<
  z.infer<typeof pptOutlineSchema>,
  z.infer<typeof pptReadOutlineOutputSchema>,
  'ppt_read_outline',
  'ppt-read'
>

export const PPT_READ_SLIDES_TOOL_SPEC = {
  name: 'ppt_read_slides',
  familyId: 'ppt',
  skillIds: ['ppt-read'],
  inputSchema: pptReadSlidesSchema,
  outputSchema: pptReadSlidesOutputSchema,
  promptSpec: {
    name: 'ppt_read_slides',
    description: '按页码或 slideId 读取 PPTX 页面内容。'
  },
  resolveExecutionMeta: readExecutionMeta,
  modelResult: { renderSuccess: renderPptReadSlidesModelResult }
} satisfies PptToolSpec<
  z.infer<typeof pptReadSlidesSchema>,
  z.infer<typeof pptReadSlidesOutputSchema>,
  'ppt_read_slides',
  'ppt-read'
>

export const PPT_SEARCH_TOOL_SPEC = {
  name: 'ppt_search',
  familyId: 'ppt',
  skillIds: ['ppt-read'],
  inputSchema: pptSearchSchema,
  outputSchema: pptSearchOutputSchema,
  promptSpec: {
    name: 'ppt_search',
    description: '在 PPTX 页面文字和讲者备注中搜索文本。'
  },
  resolveExecutionMeta: readExecutionMeta,
  modelResult: { renderSuccess: renderPptSearchModelResult }
} satisfies PptToolSpec<
  z.infer<typeof pptSearchSchema>,
  z.infer<typeof pptSearchOutputSchema>,
  'ppt_search',
  'ppt-read'
>

export const PPT_EDIT_TOOL_SPEC = {
  name: 'ppt_edit',
  familyId: 'ppt',
  skillIds: ['ppt-write'],
  inputSchema: pptEditSchema,
  outputSchema: pptEditOutputSchema,
  promptSpec: {
    name: 'ppt_edit',
    description: '创建或编辑 PPTX 的页面、元素、文字和备注。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'mutating',
    getResourceKey: (args) => readStringArg(args, 'sourcePath'),
    defaultResourceKey: 'ppt'
  })
} satisfies PptToolSpec<
  z.infer<typeof pptEditSchema>,
  z.infer<typeof pptEditOutputSchema>,
  'ppt_edit',
  'ppt-write'
>

export const PPT_READ_TOOL_SPECS = [
  PPT_READ_OUTLINE_TOOL_SPEC,
  PPT_READ_SLIDES_TOOL_SPEC,
  PPT_SEARCH_TOOL_SPEC
] as const

export const PPT_WRITE_TOOL_SPECS = [PPT_EDIT_TOOL_SPEC] as const
export const PPT_TOOL_SPECS = [...PPT_READ_TOOL_SPECS, ...PPT_WRITE_TOOL_SPECS] as const
