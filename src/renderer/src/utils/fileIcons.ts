import { getFileIconKind, type FileIconKind } from '../../../shared/fileIconKind'

/**
 * 分类规则在 `src/shared/fileIconKind.ts`；这里保留原导出路径，
 * 继续承担图标与配色这类 renderer 专有的展示定义。
 */
export type { FileIconKind }
export { getFileIconKind }

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
  image: {
    kind: 'image',
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

export const getFileVisualSpec = (kind: FileIconKind): FileVisualSpec => FILE_VISUAL_SPECS[kind]
