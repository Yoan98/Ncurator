import type { HumanState } from '../types'
import { renderLineList } from '../../utils/render'

export type HumanRuntimeRenderMode = 'prompt' | 'fallback_markdown'

const getRenderFallback = (mode: HumanRuntimeRenderMode): string =>
  mode === 'fallback_markdown' ? '无' : 'none'

const getRenderStyle = (mode: HumanRuntimeRenderMode): 'plain' | 'bullet' =>
  mode === 'fallback_markdown' ? 'bullet' : 'plain'

const renderArtifactLine = (
  artifact: HumanState['runtimeArtifacts'][number],
  mode: HumanRuntimeRenderMode
): string => {
  if (artifact.kind === 'file') {
    const roleText = artifact.artifactRole ? `；role=${artifact.artifactRole}` : ''
    if (mode === 'prompt') {
      return `- 文件 ${artifact.fileName}：path=${artifact.path}；capability=${artifact.capability}；operation=${artifact.operation}${roleText}；summary=${artifact.summary}`
    }

    const roleLabel = artifact.artifactRole ? `/${artifact.artifactRole}` : ''
    return `${artifact.fileName} (${artifact.path}) [${artifact.capability}/${artifact.operation}${roleLabel}] - ${artifact.summary}`
  }

  if (mode === 'prompt') {
    return `- draft review ${artifact.review.reviewId}：documents=${artifact.review.documentCount}；changes=${artifact.review.changeCount}；summary=${artifact.summary}`
  }

  return `draft review ${artifact.review.reviewId} (${artifact.review.documentCount} docs, ${artifact.review.changeCount} changes) - ${artifact.summary}`
}

const renderToolResultLine = (
  result: NonNullable<HumanState['lastParallelCallToolResults']>[number],
  mode: HumanRuntimeRenderMode
): string =>
  mode === 'prompt'
    ? `- 工具 ${result.toolName} ${result.ok ? '执行成功' : '执行失败'}（code=${result.code}）；摘要：${result.summary}`
    : `${result.toolName} (${result.code}) - ${result.summary}`

export const renderHumanArtifactLines = (
  state: HumanState,
  mode: HumanRuntimeRenderMode
): string =>
  renderLineList(state.runtimeArtifacts.map((artifact) => renderArtifactLine(artifact, mode)), {
    fallback: getRenderFallback(mode),
    style: getRenderStyle(mode)
  })

export const renderHumanRecentToolResultLines = (
  state: HumanState,
  mode: HumanRuntimeRenderMode
): string =>
  renderLineList(
    (state.lastParallelCallToolResults || []).map((result) => renderToolResultLine(result, mode)),
    {
      fallback: getRenderFallback(mode),
      style: getRenderStyle(mode)
    }
  )
