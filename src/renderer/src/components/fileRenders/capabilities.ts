import { t } from '../../i18n'
import {
  IMAGE_FILE_EXTENSIONS,
  imageMimeFromExtension,
  fileExtensionOf
} from '../../../../shared/imageFiles'
const IMAGE_TYPE_ALIASES: Record<string, string> = Object.fromEntries([
  ...IMAGE_FILE_EXTENSIONS.flatMap((extension) => {
    const canonical = extension === 'jpeg' ? 'jpg' : extension
    return [
      [extension, canonical] as const,
      [imageMimeFromExtension(extension), canonical] as const
    ]
  }),
  // Non-standard but still emitted by some sources.
  ['image/jpg', 'jpg'] as const
])

const TYPE_ALIASES: Record<string, string> = {
  html: 'html',
  htm: 'html',
  'text/html': 'html',
  mp4: 'video',
  m4v: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'video/webm': 'video',
  'video/x-matroska': 'video',
  ...IMAGE_TYPE_ALIASES,
  pdf: 'pdf',
  'application/pdf': 'pdf',
  docx: 'docx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  pptx: 'pptx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  xlsx: 'xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  xlsm: 'xlsm',
  'application/vnd.ms-excel.sheet.macroenabled.12': 'xlsm',
  xltx: 'xltx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template': 'xltx',
  xltm: 'xltm',
  'application/vnd.ms-excel.template.macroenabled.12': 'xltm',
  md: 'md',
  markdown: 'md',
  'text/markdown': 'md',
  txt: 'txt',
  'text/plain': 'txt'
}

const KNOWN_UNSUPPORTED_BINARY_TYPES = new Set([
  'doc',
  'application/msword',
  'ppt',
  'application/vnd.ms-powerpoint',
  'xls',
  'xlsb',
  'application/vnd.ms-excel',
  'rtf',
  'application/rtf',
  'pages',
  'numbers',
  'key',
  'zip',
  'rar',
  '7z',
  'tar',
  'gz'
])

export const IMAGE_PREVIEW_FILE_TYPES = Array.from(
  new Set(
    IMAGE_FILE_EXTENSIONS.flatMap((extension) => [
      extension,
      imageMimeFromExtension(extension)
    ]).concat('image/jpg')
  )
)

export const getFileExtension = fileExtensionOf

export const resolveRegisteredPreviewType = (
  fileName: string,
  declaredType?: string,
  mimeType?: string,
  filePath?: string
): string | null => {
  const candidates = [
    declaredType,
    mimeType,
    getFileExtension(fileName),
    getFileExtension(filePath || '')
  ]
  for (const candidate of candidates) {
    const normalized = candidate?.trim().toLowerCase()
    if (normalized && TYPE_ALIASES[normalized]) return TYPE_ALIASES[normalized]
  }
  return null
}

export const isKnownUnsupportedBinaryType = (
  fileName: string,
  declaredType?: string,
  mimeType?: string,
  filePath?: string
): boolean =>
  [declaredType, mimeType, getFileExtension(fileName), getFileExtension(filePath || '')].some(
    (candidate) => KNOWN_UNSUPPORTED_BINARY_TYPES.has(candidate?.trim().toLowerCase() || '')
  )

export const isUtf8Text = (bytes: ArrayBuffer): boolean => {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

export const getPreviewTypeLabel = (fileName: string, fileType?: string): string => {
  const type =
    getFileExtension(fileName) ||
    fileType?.trim().toLowerCase() ||
    t(($) => $.editors.unknownFormat)
  return type === t(($) => $.editors.unknownFormat) ? type : `.${type}`
}
