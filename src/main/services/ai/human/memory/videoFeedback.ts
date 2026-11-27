import { HumanMessage } from '@langchain/core/messages'
import type { ChatMessageContentNode } from '../../../../../shared/types'
import { videoFeedback } from '../../../../../shared/videoFeedback'
import { createImageReferenceMessage } from './multimodal'

export const videoFeedbackUserMessage = (
  content: string,
  nodes: ChatMessageContentNode[] = []
): HumanMessage => {
  const frames = [
    ...new Map(videoFeedback(nodes).map((node) => [node.screenshotPath, node])).values()
  ]
  if (!frames.length) return new HumanMessage(content)
  const imageContent = createImageReferenceMessage(
    frames.map((frame) => ({
      path: frame.screenshotPath,
      mimeType: 'image/png',
      ...frame.screenshotSize
    }))
  ).content
  if (typeof imageContent === 'string') throw new Error('Image projection must be multimodal')
  return new HumanMessage({
    content: [{ type: 'text', text: content }, ...imageContent.slice(1)],
    additional_kwargs: { ncurator_user_message: true }
  })
}
