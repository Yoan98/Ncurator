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
    iconClassName: 'text-[var(--notion-text-soft)]',
    documentFillClassName: 'fill-none',
    documentAccentClassName: 'fill-[var(--file-icon-neutral)]'
  },
  web: {
    kind: 'web',
    iconClassName: 'text-[var(--notion-green)]',
    documentFillClassName: 'fill-none',
    documentAccentClassName: 'fill-[var(--file-icon-web)]'
  },
  pdf: {
    kind: 'pdf',
    iconClassName: 'text-[var(--file-icon-pdf)]',
    documentFillClassName: 'fill-[var(--file-icon-pdf)]',
    documentAccentClassName: 'fill-[var(--file-icon-pdf-accent)]',
    documentLabel: 'PDF'
  },
  docx: {
    kind: 'docx',
    iconClassName: 'text-[var(--file-icon-doc)]',
    documentFillClassName: 'fill-[var(--file-icon-doc)]',
    documentAccentClassName: 'fill-[var(--file-icon-doc-accent)]',
    documentLabel: 'DOC'
  },
  xlsx: {
    kind: 'xlsx',
    iconClassName: 'text-[var(--file-icon-xls)]',
    documentFillClassName: 'fill-[var(--file-icon-xls)]',
    documentAccentClassName: 'fill-[var(--file-icon-xls-accent)]',
    documentLabel: 'XLS'
  },
  ppt: {
    kind: 'ppt',
    iconClassName: 'text-[var(--file-icon-ppt)]',
    documentFillClassName: 'fill-[var(--file-icon-ppt)]',
    documentAccentClassName: 'fill-[var(--file-icon-ppt-accent)]',
    documentLabel: 'PPT'
  },
  audio: {
    kind: 'audio',
    iconClassName: 'text-[var(--file-icon-media)]',
    documentFillClassName: 'fill-none',
    documentAccentClassName: 'fill-none'
  },
  video: {
    kind: 'video',
    iconClassName: 'text-[var(--file-icon-media)]',
    documentFillClassName: 'fill-none',
    documentAccentClassName: 'fill-none'
  },
  image: {
    kind: 'image',
    iconClassName: 'text-[var(--file-icon-media)]',
    documentFillClassName: 'fill-none',
    documentAccentClassName: 'fill-none'
  },
  markdown: {
    kind: 'markdown',
    iconClassName: 'text-[var(--notion-text-soft)]',
    documentFillClassName: 'fill-[var(--file-icon-neutral)]',
    documentAccentClassName: 'fill-[var(--file-icon-neutral)]'
  },
  file: {
    kind: 'file',
    iconClassName: 'text-[var(--notion-text-soft)]',
    documentFillClassName: 'fill-[var(--file-icon-neutral)]',
    documentAccentClassName: 'fill-[var(--file-icon-neutral)]'
  }
}

export const getFileVisualSpec = (kind: FileIconKind): FileVisualSpec => FILE_VISUAL_SPECS[kind]
