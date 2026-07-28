export const SUPPORTED_ATTACHMENT_IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'tif',
  'tiff'
] as const

export const SUPPORTED_ATTACHMENT_FILE_EXTENSIONS = [
  'doc',
  'docx',
  'pptx',
  'pdf',
  'md',
  'json',
  'xlsx',
  'xlsm',
  'xltx',
  'xltm'
] as const

export const SUPPORTED_ATTACHMENT_EXTENSIONS = [
  ...SUPPORTED_ATTACHMENT_IMAGE_EXTENSIONS,
  ...SUPPORTED_ATTACHMENT_FILE_EXTENSIONS
] as const
