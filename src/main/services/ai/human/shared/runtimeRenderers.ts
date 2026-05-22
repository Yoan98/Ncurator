import type { HumanState } from '../types'
import { renderLineList } from '../../utils/render'

export type HumanRuntimeRenderMode = 'prompt' | 'fallback_markdown'

const getRenderFallback = (mode: HumanRuntimeRenderMode): string =>
  mode === 'fallback_markdown' ? '无' : '本次运行未形成新的文件改动结果。'

const getRenderStyle = (mode: HumanRuntimeRenderMode): 'plain' | 'bullet' =>
  mode === 'fallback_markdown' ? 'bullet' : 'plain'

const renderChangedFile = (
  file: NonNullable<HumanState['execution']['runtimeArtifacts']>['changed_files'][number],
  mode: HumanRuntimeRenderMode
): string => {
  if (mode === 'fallback_markdown') {
    const draftText = file.draft_artifact_path ? `; 待确认稿=${file.draft_artifact_path}` : ''
    return `${file.file_name} (${file.source_path}) - ${file.format}, 改动数=${String(file.change_count)}${draftText}`
  }

  const draftLine = file.draft_artifact_path
    ? `  - 待确认稿路径（新草稿文件）：${file.draft_artifact_path}`
    : undefined
  return [
    `- 文件：${file.file_name}`,
    `  - 原文件路径：${file.source_path}`,
    `  - 格式：${file.format}`,
    `  - 改动数：${file.change_count}`,
    draftLine
  ]
    .filter(Boolean)
    .join('\n')
}

export const renderHumanArtifactLines = (
  state: HumanState,
  mode: HumanRuntimeRenderMode
): string =>
  renderLineList(
    (state.execution.runtimeArtifacts?.changed_files || []).map((file) =>
      renderChangedFile(file, mode)
    ),
    {
      fallback: getRenderFallback(mode),
      style: getRenderStyle(mode)
    }
  )
