import { createContext } from 'react'
import type { VideoFeedbackNode } from '../../../../../shared/types'

export type VideoFeedbackState = {
  partnerId: string
  locked: boolean
  nodes: VideoFeedbackNode[]
  navigation: { node: VideoFeedbackNode; requestId: number } | null
  save: (node: VideoFeedbackNode) => void
  remove: (id: string) => void
  navigate: (node: VideoFeedbackNode) => void
}
export const VideoFeedbackContext = createContext<VideoFeedbackState | null>(null)
