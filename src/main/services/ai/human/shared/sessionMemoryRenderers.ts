import type { ChatSessionMemory } from '../../../../../shared/types'

export const renderSessionMemoryForBrain = (memory: ChatSessionMemory | null): string => {
  if (!memory) return 'none'
  const summary = String(memory.rollingSummary || '').trim()
  const recent = memory.recentTaskSummaries || []
  const recentLines = recent.map((item, index) => {
    const artifactLines = item.artifacts.length
      ? item.artifacts
          .map((artifact) =>
            [
              artifact.kind,
              artifact.fileName ? `fileName=${artifact.fileName}` : '',
              artifact.path ? `path=${artifact.path}` : '',
              artifact.reviewId ? `reviewId=${artifact.reviewId}` : '',
              artifact.summary ? `summary=${artifact.summary}` : ''
            ]
              .filter(Boolean)
              .join('；')
          )
          .join('\n    ')
      : 'none'
    return `
${index + 1}. user：${item.userInput}
   assistant：${item.assistantOutput}
   artifacts：
    ${artifactLines}
`.trim()
  })

  return `
rollingSummary：
${summary || 'none'}

recentTaskSummaries：
${recentLines.join('\n\n') || 'none'}
`.trim()
}
