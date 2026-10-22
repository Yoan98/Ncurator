import type { z } from 'zod/v4'
import type { JsonObject } from '../../../../../../shared/types'
import type { RuntimeToolsetId } from '../../types'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'
import {
  renderPptEditModelResult,
  renderPptOutlineModelResult,
  renderPptReadSlidesModelResult,
  renderPptSearchModelResult
} from '../../shared/modelToolResultRenderers'
import {
  pptEditSchema,
  pptOutlineSchema,
  pptReadSlidesSchema,
  pptSearchSchema
} from './toolSchemas'

type PptToolName = 'ppt_read_outline' | 'ppt_read_slides' | 'ppt_search' | 'ppt_edit'

type PptToolSpec<
  TArgs extends JsonObject,
  TName extends PptToolName,
  TToolsetId extends RuntimeToolsetId
> = HumanToolSpec<TArgs, TName, TToolsetId>

const readExecutionMeta = createStaticExecutionMetaResolver({
  mutability: 'read_only',
  getResourceKey: (args) => readStringArg(args, 'sourcePath'),
  defaultResourceKey: 'ppt'
})

export const PPT_READ_OUTLINE_TOOL_SPEC = {
  name: 'ppt_read_outline',
  familyId: 'ppt',
  toolsetIds: ['ppt-read'],
  inputSchema: pptOutlineSchema,
  promptSpec: {
    name: 'ppt_read_outline',
    description: '返回 PPTX 页面提纲。'
  },
  resolveExecutionMeta: readExecutionMeta,
  modelResult: { renderSuccess: renderPptOutlineModelResult }
} satisfies PptToolSpec<z.infer<typeof pptOutlineSchema>, 'ppt_read_outline', 'ppt-read'>

export const PPT_READ_SLIDES_TOOL_SPEC = {
  name: 'ppt_read_slides',
  familyId: 'ppt',
  toolsetIds: ['ppt-read'],
  inputSchema: pptReadSlidesSchema,
  promptSpec: {
    name: 'ppt_read_slides',
    description: '按页码或 slideId 读取 PPTX 页面内容。'
  },
  resolveExecutionMeta: readExecutionMeta,
  modelResult: { renderSuccess: renderPptReadSlidesModelResult }
} satisfies PptToolSpec<z.infer<typeof pptReadSlidesSchema>, 'ppt_read_slides', 'ppt-read'>

export const PPT_SEARCH_TOOL_SPEC = {
  name: 'ppt_search',
  familyId: 'ppt',
  toolsetIds: ['ppt-read'],
  inputSchema: pptSearchSchema,
  promptSpec: {
    name: 'ppt_search',
    description: '在 PPTX 页面文字和讲者备注中搜索文本。'
  },
  resolveExecutionMeta: readExecutionMeta,
  modelResult: { renderSuccess: renderPptSearchModelResult }
} satisfies PptToolSpec<z.infer<typeof pptSearchSchema>, 'ppt_search', 'ppt-read'>

export const PPT_EDIT_TOOL_SPEC = {
  name: 'ppt_edit',
  familyId: 'ppt',
  toolsetIds: ['ppt-write'],
  inputSchema: pptEditSchema,
  promptSpec: {
    name: 'ppt_edit',
    description: '创建或编辑 PPTX 的页面、元素、文字和备注。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'mutating',
    getResourceKey: (args) => readStringArg(args, 'sourcePath'),
    defaultResourceKey: 'ppt'
  }),
  modelResult: { renderSuccess: renderPptEditModelResult }
} satisfies PptToolSpec<z.infer<typeof pptEditSchema>, 'ppt_edit', 'ppt-write'>

export const PPT_READ_TOOL_SPECS = [
  PPT_READ_OUTLINE_TOOL_SPEC,
  PPT_READ_SLIDES_TOOL_SPEC,
  PPT_SEARCH_TOOL_SPEC
] as const

export const PPT_WRITE_TOOL_SPECS = [PPT_EDIT_TOOL_SPEC] as const
export const PPT_TOOL_SPECS = [...PPT_READ_TOOL_SPECS, ...PPT_WRITE_TOOL_SPECS] as const
