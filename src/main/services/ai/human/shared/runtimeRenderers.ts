import type { HumanState } from '../types'
import { renderLineList } from '../../utils/render'

export type HumanRuntimeRenderMode = 'prompt' | 'fallback_markdown'

const getRenderFallback = (mode: HumanRuntimeRenderMode): string =>
  mode === 'fallback_markdown' ? '无' : '本次运行未形成新的文件改动结果。'

const getRenderStyle = (mode: HumanRuntimeRenderMode): 'plain' | 'bullet' =>
  mode === 'fallback_markdown' ? 'bullet' : 'plain'

const renderChangedFile = (
  file: NonNullable<HumanState['execution']['fileChanges']>['changed_files'][number],
  mode: HumanRuntimeRenderMode
): string => {
  if (mode === 'fallback_markdown') {
    return `${file.fileName} (${file.path}) - ${file.capability}, +${String(file.insertCount)} -${String(file.deleteCount)}; changeId=${file.id}`
  }

  return [
    `- 文件：${file.fileName}`,
    `  - 文件路径：${file.path}`,
    `  - 来源能力：${file.capability}`,
    `  - 操作：${file.operation}`,
    `  - 改动数：${file.changeCount}`,
    `  - 新增：${file.insertCount}`,
    `  - 删除：${file.deleteCount}`,
    `  - 修改记录：${file.id}`
  ]
    .join('\n')
}

export const renderHumanFileChangeLines = (
  state: HumanState,
  mode: HumanRuntimeRenderMode
): string =>
  renderLineList(
    (state.execution.fileChanges?.changed_files || []).map((file) =>
      renderChangedFile(file, mode)
    ),
    {
      fallback: getRenderFallback(mode),
      style: getRenderStyle(mode)
    }
  )

export const renderHumanArtifactLines = renderHumanFileChangeLines
