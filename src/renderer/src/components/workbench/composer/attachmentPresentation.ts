import type { ChatAttachment } from '../../../../../shared/types'
import { getFileExtension, resolveRegisteredPreviewType } from '../../fileRenders/capabilities'

// These extensions are handled by the existing UTF-8 text renderer even though
// they do not have a dedicated file renderer registration.
const TEXT_PREVIEW_EXTENSIONS = new Set([
  'c',
  'cc',
  'cpp',
  'css',
  'csv',
  'env',
  'go',
  'h',
  'hpp',
  'htm',
  'html',
  'ini',
  'java',
  'js',
  'json',
  'jsx',
  'kt',
  'log',
  'ndjson',
  'php',
  'py',
  'rb',
  'rs',
  'sh',
  'sql',
  'toml',
  'ts',
  'tsx',
  'vue',
  'xml',
  'yaml',
  'yml'
])

export const isAttachmentDocumentPreviewable = (attachment: ChatAttachment): boolean => {
  if (attachment.kind !== 'file') return false

  if (
    resolveRegisteredPreviewType(attachment.name, undefined, attachment.mimeType, attachment.path)
  ) {
    return true
  }

  return TEXT_PREVIEW_EXTENSIONS.has(getFileExtension(attachment.name))
}
