import type { z } from 'zod/v4'
import type { JsonObject } from '../../../../../../shared/types'
import type { RuntimeSkillId } from '../../types'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'
import {
  pptEditSchema,
  pptEditOutputSchema,
  pptOutlineSchema,
  pptReadOutlineOutputSchema,
  pptReadVisualsSchema,
  pptReadSlidesSchema,
  pptReadSlidesOutputSchema,
  pptSearchOutputSchema,
  pptSearchSchema
} from './schemas'
import { visualRecognitionOutputSchema } from '../../../../visualRecognition/schemas'

type PptToolName =
  | 'ppt_read_outline'
  | 'ppt_read_slides'
  | 'ppt_search'
  | 'ppt_read_visuals'
  | 'ppt_edit'

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
    description:
      '按百分比或页码区间读取 PPTX 页面提纲，并返回页面总数以及每页的 slideIndex、slideId、标题、文本摘要和元素数量。'
  },
  resolveExecutionMeta: readExecutionMeta
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
    description:
      '按页码区间或 slideId 集合读取 PPTX 页面及元素，并返回页面文字、讲者备注以及元素的位置、类型和样式。'
  },
  resolveExecutionMeta: readExecutionMeta
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
    description:
      '在 PPTX 页面文字和讲者备注中搜索文本并支持限制 slideId 范围，并返回命中页面、匹配来源、上下文和数量。'
  },
  resolveExecutionMeta: readExecutionMeta
} satisfies PptToolSpec<
  z.infer<typeof pptSearchSchema>,
  z.infer<typeof pptSearchOutputSchema>,
  'ppt_search',
  'ppt-read'
>

export const PPT_READ_VISUALS_TOOL_SPEC = {
  name: 'ppt_read_visuals',
  familyId: 'ppt',
  skillIds: ['ppt-read'],
  inputSchema: pptReadVisualsSchema,
  outputSchema: visualRecognitionOutputSchema,
  promptSpec: {
    name: 'ppt_read_visuals',
    description:
      '读取 PPT 指定页的视觉内容，按 requests 一次性返回每个页面的识别结果；每条 request 包含 index 和 instruction，最多 10 条。'
  },
  resolveExecutionMeta: readExecutionMeta
} satisfies PptToolSpec<
  z.infer<typeof pptReadVisualsSchema>,
  z.infer<typeof visualRecognitionOutputSchema>,
  'ppt_read_visuals',
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
    description: `创建或编辑 PPTX 文件，可在一次调用中完成页面创建、新增、复制、移动、删除以及文字、元素和备注调整，成功后直接保存并返回修改后的相关页面。
调用约束：
- 禁止先创建空白页或占位页，再使用 edit_elements 逐项拼装页面。
PPT 建立新页面时 HTML 的设计规则：
页面与画布：
- insert_slide 的 html 对应一张完整页面。
- 每个页面 HTML 必须且只能包含一个 data-ppt-slide 根节点。
- 根节点必须使用 position:relative、width:1920px、height:1080px、overflow:hidden。
- 所有元素必须完整位于 1920×1080 画布内，right 不得超过 1920，bottom 不得超过 1080。
- 页面四周必须保留至少 60px 安全边距。
元素结构：
- 所有真实 PPT 元素必须使用 data-ppt-element 标注。
- data-ppt-element 只能使用 text、shape、image、svg、table、chart、formula 或 line。
- 仅用于布局的容器禁止标注 data-ppt-element。
CSS 使用：
- 必须仅使用内联 CSS；所有带样式的元素必须按 box-sizing:border-box 布局。
- 页面布局允许使用 absolute、flex 或 grid。
- 背景必须使用纯色 background 或 background-color。
- 禁止使用 CSS 渐变、background-image、伪元素、动画、filter、mask、mix-blend-mode 和滚动容器。
排版规范：
- 页面标题必须保持单行，字号不得低于 70px。
- 正文不得低于 32px，任何可见文字不得低于 24px。
- 单行标题必须预留足够宽度，避免换行或裁切。
版式规范：
- 主内容必须横向充分利用画布，左、中、右区域均应包含有效信息或视觉元素。
- 必须避免大片无意义留白、文字过密、图片过小、单一深色满版和重复卡片堆叠。
图片规范：
- 图片必须使用 img 元素。
- 允许使用用户工作区域本地图片和远程图片地址。
- 远程图片会在处理时尝试下载并打包；下载失败时必须保留原图片的位置、大小和可转换样式，并使用相同尺寸的占位图替代，不得因此使整个 PPT 操作失败。`
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
  PPT_SEARCH_TOOL_SPEC,
  PPT_READ_VISUALS_TOOL_SPEC
] as const

export const PPT_WRITE_TOOL_SPECS = [PPT_EDIT_TOOL_SPEC] as const
export const PPT_TOOL_SPECS = [...PPT_READ_TOOL_SPECS, ...PPT_WRITE_TOOL_SPECS] as const
