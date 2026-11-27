import type { ChatMessageContentNode, VideoFeedbackNode } from './types'

export const videoFeedback = (nodes: readonly ChatMessageContentNode[]): VideoFeedbackNode[] =>
  nodes.filter((node): node is VideoFeedbackNode => node.kind === 'video_feedback')
export const videoFeedbackText = (node: VideoFeedbackNode): string =>
  [
    node.frameText,
    ...node.annotations
      .filter((item) => item.text.trim())
      .map((item) => `${item.number}. ${item.text}`)
  ]
    .filter(Boolean)
    .join('\n')
export const videoFeedbackLabel = (node: VideoFeedbackNode): string =>
  `${node.filePath.split(/[/\\]/u).pop()} · ${node.range ? `${node.range.startSeconds.toFixed(2)}–${node.range.endSeconds.toFixed(2)}s（画面 ${node.timeSeconds.toFixed(2)}s）` : `${node.timeSeconds.toFixed(2)}s`}`

/** Snap only when both temporal and physical distance are small; no sticky release zone. */
export const snapVideoTime = (
  time: number,
  marks: number[],
  duration: number,
  width: number,
  bypass = false
): number => {
  if (bypass || !duration || !width) return time
  let closest = time
  let distance = Infinity
  for (const mark of marks) {
    const delta = Math.abs(mark - time)
    if (delta <= 2 && (delta / duration) * width <= 8 && delta < distance) {
      closest = mark
      distance = delta
    }
  }
  return closest
}
