import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'
import {
  videoClipEditSchema,
  videoVisualEditSchema,
  videoAudioEditSchema,
  videoExportSchema
} from './toolSchemas'
import type { ClipEditInput, VisualEditInput, AudioEditInput, ExportInput } from './toolSchemas'

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
    description: '组装、替换、选段、变速、定格或重复视频片段，生成新版本预览并保留可编辑配方。'
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
    description: '编辑字幕、文字或素材叠加、裁切布局与转场，生成新版本预览。'
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
    description: '新增、修改或删除视频音轨，支持同步、增益、淡入淡出与音量包络。'
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
    description: '从原素材与编辑配方导出预览或正式视频，支持指定尺寸和帧率。'
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
