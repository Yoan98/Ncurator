export type FileIconKind =
  | 'directory'
  | 'web'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'ppt'
  | 'audio'
  | 'video'
  | 'markdown'
  | 'file'

export const FILE_ICON_SIZE_CLASSES = {
  sm: 'h-[18px] w-[18px]',
  md: 'h-[21px] w-[21px]',
  inline: 'h-[18px] w-[18px]'
} as const

export const DIRECTORY_ICON_SIZE_CLASSES = {
  sm: 'h-[16px] w-[16px]',
  md: FILE_ICON_SIZE_CLASSES.md,
  inline: 'h-[16px] w-[16px]'
} as const

export type FileVisualSpec = {
  kind: FileIconKind
  iconClassName: string
  documentFillClassName: string
  documentAccentClassName: string
  documentLabel?: string
}

const FILE_VISUAL_SPECS: Record<FileIconKind, FileVisualSpec> = {
  directory: {
    kind: 'directory',
    iconClassName: 'text-[#787774]',
    documentFillClassName: 'fill-none',
    documentAccentClassName: 'fill-[#787774]'
  },
  web: {
    kind: 'web',
    iconClassName: 'text-[#2F6F4E]',
    documentFillClassName: 'fill-none',
    documentAccentClassName: 'fill-[#2F6F4E]'
  },
  pdf: {
    kind: 'pdf',
    iconClassName: 'text-[#C92A2A]',
    documentFillClassName: 'fill-[#E5484D]',
    documentAccentClassName: 'fill-[#F9B4B4]',
    documentLabel: 'PDF'
  },
  docx: {
    kind: 'docx',
    iconClassName: 'text-[#2563EB]',
    documentFillClassName: 'fill-[#3B82F6]',
    documentAccentClassName: 'fill-[#BFDBFE]',
    documentLabel: 'DOC'
  },
  xlsx: {
    kind: 'xlsx',
    iconClassName: 'text-[#16803C]',
    documentFillClassName: 'fill-[#22A06B]',
    documentAccentClassName: 'fill-[#BBF7D0]',
    documentLabel: 'XLS'
  },
  ppt: {
    kind: 'ppt',
    iconClassName: 'text-[#D97706]',
    documentFillClassName: 'fill-[#F59E0B]',
    documentAccentClassName: 'fill-[#FDE68A]',
    documentLabel: 'PPT'
  },
  audio: {
    kind: 'audio',
    iconClassName: 'text-[#8B5CF6]',
    documentFillClassName: 'fill-none',
    documentAccentClassName: 'fill-none'
  },
  video: {
    kind: 'video',
    iconClassName: 'text-[#0F766E]',
    documentFillClassName: 'fill-none',
    documentAccentClassName: 'fill-none'
  },
  markdown: {
    kind: 'markdown',
    iconClassName: 'text-[#787774]',
    documentFillClassName: 'fill-[#787774]',
    documentAccentClassName: 'fill-[#787774]'
  },
  file: {
    kind: 'file',
    iconClassName: 'text-[#787774]',
    documentFillClassName: 'fill-[#787774]',
    documentAccentClassName: 'fill-[#787774]'
  }
}

const normalizeFileExtension = (value: string | undefined): string => {
  const trimmed = String(value || '')
    .trim()
    .toLowerCase()
  if (!trimmed) return ''
  return trimmed.startsWith('.') ? trimmed.slice(1) : trimmed
}

export const getFileIconKind = (name: string, extension?: string): FileIconKind => {
  const filename = name.split(/[\\/]/u).pop() || name
  const dotIndex = filename.lastIndexOf('.')
  const fileExt =
    normalizeFileExtension(extension) ||
    (dotIndex > -1 ? normalizeFileExtension(filename.slice(dotIndex + 1)) : '')
  if (fileExt === 'md' || fileExt === 'markdown') return 'markdown'
  if (fileExt === 'pdf') return 'pdf'
  if (fileExt === 'docx') return 'docx'
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

export const getFileVisualSpec = (kind: FileIconKind): FileVisualSpec => FILE_VISUAL_SPECS[kind]
