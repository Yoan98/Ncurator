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
  const highlights =
    file.change_highlights.length > 0
      ? file.change_highlights.map((item) => `    - ${item}`).join('\n')
      : '    - 未提供更细的改动标题'

  if (mode === 'fallback_markdown') {
    return `${file.file_name} (${file.source_path}) - ${file.summary}`
  }

  const draftLine = file.draft_artifact_path
    ? `  - 待确认稿：${file.draft_artifact_path}`
    : undefined
  return [
    `- 文件：${file.file_name}`,
    `  - 路径：${file.source_path}`,
    `  - 格式：${file.format}`,
    `  - 改动数：${file.change_count}`,
    `  - 摘要：${file.summary}`,
    '  - 大致改动：',
    highlights,
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
