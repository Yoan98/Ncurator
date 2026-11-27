import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'
import {
  videoClipEditSchema,
  videoVisualEditSchema,
  videoAudioEditSchema,
  videoExportSchema
} from './toolSchemas'
import type { ClipEditInput, VisualEditInput, AudioEditInput, ExportInput } from './toolSchemas'

const sourceRules =
  '后续操作优先使用返回的 editPath；成品保持配方关联。目标已存在时使用新路径，不通过终端复制、删除或覆盖来绕过版本保护。'
const meta = createStaticExecutionMetaResolver({
  mutability: 'mutating',
  getResourceKey: (args) => readStringArg(args, 'outputPath'),
  defaultResourceKey: 'video'
})
const modelResult: HumanToolSpec['modelResult'] = {
  renderSuccess: ({ args, data }) => {
    const result = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
    return `已生成：${args.outputPath}\n编辑配方：${result.editPath}${Array.isArray(result.createdIds) ? `\n新对象：${result.createdIds.join('、')}` : ''}`
  }
}
export const VIDEO_CLIP_TOOL_SPEC: HumanToolSpec<
  ClipEditInput,
  'video_clip_edit',
  'video-editing'
> = {
  name: 'video_clip_edit',
  familyId: 'video-editing',
  toolsetIds: ['video-editing'],
  inputSchema: videoClipEditSchema,
  promptSpec: {
    name: 'video_clip_edit',
    description:
      '组装、选段、变速、定格或重复视频片段，保留原素材和可编辑配方，生成新版本预览。时间单位秒，区间左闭右开。' +
      sourceRules
  },
  resolveExecutionMeta: meta,
  modelResult
}
export const VIDEO_VISUAL_TOOL_SPEC: HumanToolSpec<
  VisualEditInput,
  'video_visual_edit',
  'video-editing'
> = {
  name: 'video_visual_edit',
  familyId: 'video-editing',
  toolsetIds: ['video-editing'],
  inputSchema: videoVisualEditSchema,
  promptSpec: {
    name: 'video_visual_edit',
    description:
      '修改视频字幕、文字或素材叠加、裁切布局及转场；生成可继续编辑的新版本预览。布局坐标为 0 到 1；字幕 style 更新只改变传入属性。' +
      sourceRules
  },
  resolveExecutionMeta: meta,
  modelResult
}
export const VIDEO_AUDIO_TOOL_SPEC: HumanToolSpec<
  AudioEditInput,
  'video_audio_edit',
  'video-editing'
> = {
  name: 'video_audio_edit',
  familyId: 'video-editing',
  toolsetIds: ['video-editing'],
  inputSchema: videoAudioEditSchema,
  promptSpec: {
    name: 'video_audio_edit',
    description:
      '新增、修改或删除视频音轨，支持同步锚点、增益、淡入淡出和音量包络；不生成语音。' + sourceRules
  },
  resolveExecutionMeta: meta,
  modelResult
}
export const VIDEO_EXPORT_TOOL_SPEC: HumanToolSpec<ExportInput, 'video_export', 'video-editing'> = {
  name: 'video_export',
  familyId: 'video-editing',
  toolsetIds: ['video-editing'],
  inputSchema: videoExportSchema,
  promptSpec: {
    name: 'video_export',
    description:
      '按当前原素材及编辑配方导出预览或正式视频，可指定尺寸和帧率。此工具不修改画面内容；重画动画或图片素材使用 drawing。' +
      sourceRules
  },
  resolveExecutionMeta: meta,
  modelResult
}
export const VIDEO_EDITING_TOOL_SPECS = [
  VIDEO_CLIP_TOOL_SPEC,
  VIDEO_VISUAL_TOOL_SPEC,
  VIDEO_AUDIO_TOOL_SPEC,
  VIDEO_EXPORT_TOOL_SPEC
] as const
