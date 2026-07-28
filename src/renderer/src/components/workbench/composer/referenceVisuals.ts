import type { SelectedReference } from '../../../../../shared/types'

export type ReferenceVisualKind = 'directory' | 'web' | 'pdf' | 'docx' | 'xlsx' | 'ppt' | 'file'

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
  return 'file'
}

export const getReferenceVisualSpec = (reference: SelectedReference): ReferenceVisualSpec =>
  REFERENCE_VISUAL_SPECS[getReferenceVisualKind(reference)]
