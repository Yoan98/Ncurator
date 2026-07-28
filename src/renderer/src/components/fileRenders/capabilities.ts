export const FILE_PREVIEW_SUPPORT_SUMMARY =
  '当前支持 PDF、DOCX、PPTX、Excel、Markdown、UTF-8 文本，以及 PNG、JPG、GIF、WebP、BMP、SVG 图片。'

const TYPE_ALIASES: Record<string, string> = {
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
  'text/plain': 'txt',
  png: 'png',
  'image/png': 'png',
  jpg: 'jpg',
  jpeg: 'jpg',
  'image/jpg': 'jpg',
  'image/jpeg': 'jpg',
  gif: 'gif',
  'image/gif': 'gif',
  webp: 'webp',
  'image/webp': 'webp',
  bmp: 'bmp',
  'image/bmp': 'bmp',
  svg: 'svg',
  'image/svg+xml': 'svg'
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

export const IMAGE_PREVIEW_FILE_TYPES = [
  'png',
  'image/png',
  'jpg',
  'jpeg',
  'image/jpg',
  'image/jpeg',
  'gif',
  'image/gif',
  'webp',
  'image/webp',
  'bmp',
  'image/bmp',
  'svg',
  'image/svg+xml'
]

export const getFileExtension = (fileName: string): string => {
  const name = fileName.split(/[\\/]/).pop() || ''
  const dotIndex = name.lastIndexOf('.')
  return dotIndex >= 0 ? name.slice(dotIndex + 1).toLowerCase() : ''
}

export const resolveRegisteredPreviewType = (
  fileName: string,
  declaredType?: string,
  mimeType?: string
): string | null => {
  const candidates = [declaredType, mimeType, getFileExtension(fileName)]
  for (const candidate of candidates) {
    const normalized = candidate?.trim().toLowerCase()
    if (normalized && TYPE_ALIASES[normalized]) return TYPE_ALIASES[normalized]
  }
  return null
}

export const isKnownUnsupportedBinaryType = (
  fileName: string,
  declaredType?: string,
  mimeType?: string
): boolean =>
  [declaredType, mimeType, getFileExtension(fileName)].some((candidate) =>
    KNOWN_UNSUPPORTED_BINARY_TYPES.has(candidate?.trim().toLowerCase() || '')
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
  const type = getFileExtension(fileName) || fileType?.trim().toLowerCase() || '未知格式'
  return type === '未知格式' ? type : `.${type}`
}
