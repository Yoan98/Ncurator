import { fileExtensionOf, isImageFileExtension } from './imageFiles'

/**
 * 文件类型分类：只决定用哪种图标，不含任何样式。
 * 放在 shared 以便按 unit 规则直接测试；具体图标与配色留在 renderer。
 */
export type FileIconKind =
  | 'directory'
  | 'web'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'ppt'
  | 'audio'
  | 'video'
  | 'image'
  | 'markdown'
  | 'html'
  | 'file'

const normalizeFileExtension = (value: string | undefined): string => {
  const trimmed = String(value || '')
    .trim()
    .toLowerCase()
  if (!trimmed) return ''
  return trimmed.startsWith('.') ? trimmed.slice(1) : trimmed
}

export const getFileIconKind = (name: string, extension?: string): FileIconKind => {
  const fileExt = normalizeFileExtension(extension) || fileExtensionOf(name)
  if (fileExt === 'md' || fileExt === 'markdown') return 'markdown'
  if (fileExt === 'html' || fileExt === 'htm') return 'html'
  if (isImageFileExtension(fileExt)) return 'image'
  if (fileExt === 'pdf') return 'pdf'
  if (fileExt === 'doc' || fileExt === 'docx') return 'docx'
  if (['xls', 'xlsx', 'xlsm', 'xltx', 'xltm', 'csv'].includes(fileExt)) return 'xlsx'
  if (fileExt === 'ppt' || fileExt === 'pptx') return 'ppt'
  if (['aac', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'weba'].includes(fileExt)) {
    return 'audio'
  }
  if (['avi', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'ogv', 'webm', 'wmv'].includes(fileExt)) {
    return 'video'
  }
  return 'file'
}
