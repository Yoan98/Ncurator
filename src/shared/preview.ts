import { fileExtensionOf } from './imageFiles'

export const PREVIEW_SCHEME = 'ncurator-preview'

export const VIDEO_PREVIEW_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv'] as const

export const isVideoPreviewSource = (source: string): boolean => {
  const extension = fileExtensionOf(source)
  return VIDEO_PREVIEW_EXTENSIONS.some((item) => item === extension)
}

export type PreviewResource = { id: string; url: string }

export type VideoPreviewSnapshot = PreviewResource & {
  status: 'ready' | 'converting' | 'failed'
  mimeType: string
  codecs?: string
  width?: number
  height?: number
  duration?: number
  progress?: number
  converted: boolean
  version?: string
  originalPath?: string
  fps?: number
  error?: 'source_unavailable' | 'conversion_failed' | 'unsupported'
}

export type VideoPreviewOpenRequest = { source: string }
export type VideoPreviewConvertRequest = { id: string; forceTranscode?: boolean }
export type VideoPreviewFrame = { timeSeconds: number; url: string }
export type VideoPreviewVersion = { version: string; versionPath: string }
