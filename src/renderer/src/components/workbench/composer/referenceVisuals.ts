import type { DocumentSelectionNode, SelectedReference } from '../../../../../shared/types'

export const INLINE_TOKEN_CLASS_NAME =
  'mr-1.5 inline-flex max-w-full items-baseline gap-1 rounded-md px-1.5 py-0.5 align-baseline text-[0.9em] font-medium leading-[1.4]'
export const REFERENCE_TOKEN_CLASS_NAME = INLINE_TOKEN_CLASS_NAME + ' bg-[#F4F4F2]'
export const INLINE_TOKEN_LABEL_CLASS_NAME = 'min-w-0 max-w-[180px] truncate'
export const SELECTION_TOKEN_CLASS_NAME =
  INLINE_TOKEN_CLASS_NAME +
  ' cursor-pointer bg-[#F3EDF9] text-[#6F4F91] outline-none transition-colors hover:bg-[#E9DDFB] focus-visible:ring-2 focus-visible:ring-[#0B6BCB]'
export const SELECTION_NUMBER_CLASS_NAME =
  'inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[5px] bg-[#E3D5F2] px-[3px] text-[10px] font-semibold leading-none text-[#6F4F91]'
export const SELECTION_DOCUMENT_ICON_PATH =
  'M10.5 2.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 15.5h8a1.5 1.5 0 0 0 1.5-1.5V6.5m-4-4 4 4h-4v-4ZM6.5 9h5m-5 3h5'
export const selectionFileName = (node: DocumentSelectionNode): string =>
  node.filePath.split(/[/\\]/).pop() || node.filePath

export type ReferenceVisualKind =
  | 'directory'
  | 'web'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'ppt'
  | 'audio'
  | 'video'
  | 'file'

export type ReferenceVisualSpec = {
  kind: ReferenceVisualKind
  iconClassName: string
  labelClassName: string
  documentFillClassName: string
  documentAccentClassName: string
  documentLabel?: string
}

const REFERENCE_VISUAL_SPECS: Record<ReferenceVisualKind, ReferenceVisualSpec> = {
  directory: {
    kind: 'directory',
    iconClassName: 'text-[#787774]',
    labelClassName: 'text-[#787774]',
    documentFillClassName: 'fill-none',
    documentAccentClassName: 'fill-[#787774]'
  },
  web: {
    kind: 'web',
    iconClassName: 'text-[#2F6F4E]',
    labelClassName: 'text-[#2F6F4E]',
    documentFillClassName: 'fill-none',
    documentAccentClassName: 'fill-[#2F6F4E]'
  },
  pdf: {
    kind: 'pdf',
    iconClassName: 'text-[#C92A2A]',
    labelClassName: 'text-[#B42318]',
    documentFillClassName: 'fill-[#E5484D]',
    documentAccentClassName: 'fill-[#F9B4B4]',
    documentLabel: 'PDF'
  },
  docx: {
    kind: 'docx',
    iconClassName: 'text-[#2563EB]',
    labelClassName: 'text-[#1D4ED8]',
    documentFillClassName: 'fill-[#3B82F6]',
    documentAccentClassName: 'fill-[#BFDBFE]',
    documentLabel: 'DOC'
  },
  xlsx: {
    kind: 'xlsx',
    iconClassName: 'text-[#16803C]',
    labelClassName: 'text-[#166534]',
    documentFillClassName: 'fill-[#22A06B]',
    documentAccentClassName: 'fill-[#BBF7D0]',
    documentLabel: 'XLS'
  },
  ppt: {
    kind: 'ppt',
    iconClassName: 'text-[#D97706]',
    labelClassName: 'text-[#B45309]',
    documentFillClassName: 'fill-[#F59E0B]',
    documentAccentClassName: 'fill-[#FDE68A]',
    documentLabel: 'PPT'
  },
  audio: {
    kind: 'audio',
    iconClassName: 'text-[#8B5CF6]',
    labelClassName: 'text-[#7C3AED]',
    documentFillClassName: 'fill-none',
    documentAccentClassName: 'fill-none'
  },
  video: {
    kind: 'video',
    iconClassName: 'text-[#0F766E]',
    labelClassName: 'text-[#0F766E]',
    documentFillClassName: 'fill-none',
    documentAccentClassName: 'fill-none'
  },
  file: {
    kind: 'file',
    iconClassName: 'text-[#787774]',
    labelClassName: 'text-[#787774]',
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

const getReferenceFileExtension = (reference: SelectedReference): string => {
  if (reference.kind !== 'file') return ''
  const explicitExt = normalizeFileExtension(reference.fileExt)
  if (explicitExt) return explicitExt

  const filename = reference.relativePath || reference.name
  const lastSegment = filename.split(/[\\/]/u).pop() || filename
  const dotIndex = lastSegment.lastIndexOf('.')
  return dotIndex > -1 ? normalizeFileExtension(lastSegment.slice(dotIndex + 1)) : ''
}

export const getReferenceVisualKind = (reference: SelectedReference): ReferenceVisualKind => {
  if (reference.kind === 'directory') return 'directory'
  if (reference.kind === 'web') return 'web'

  const fileExt = getReferenceFileExtension(reference)
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

export const getReferenceVisualSpec = (reference: SelectedReference): ReferenceVisualSpec =>
  REFERENCE_VISUAL_SPECS[getReferenceVisualKind(reference)]

/** Keep the same purple selection token while distinguishing the selected file format. */
export const selectionIconPath = (node: DocumentSelectionNode): string => {
  if (node.anchor?.kind === 'excel') return 'M3 3h12v12H3zM3 7h12M3 11h12M7 3v12'
  if (node.anchor?.kind === 'ppt') return 'M2.5 3h13v9h-13zM9 12v4M6 16h6M6 6h6M6 9h4'
  if (node.anchor?.kind === 'pdf')
    return 'M10.5 2.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 15.5h8a1.5 1.5 0 0 0 1.5-1.5V6.5m-4-4 4 4h-4v-4ZM6 12l3-5 3 5M7 10h4'
  return SELECTION_DOCUMENT_ICON_PATH
}
