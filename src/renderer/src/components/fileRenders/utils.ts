import {
  getFileExtension,
  isKnownUnsupportedBinaryType,
  isUtf8Text,
  resolveRegisteredPreviewType
} from './capabilities'
import type { FileRenderDocument, PreparedFileRenderDocument } from './types'

const getMimeType = (filename: string): string => {
  const extension = filename.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'pdf':
      return 'application/pdf'
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'xlsm':
      return 'application/vnd.ms-excel.sheet.macroEnabled.12'
    case 'xltx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.template'
    case 'xltm':
      return 'application/vnd.ms-excel.template.macroEnabled.12'
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    case 'svg':
      return 'image/svg+xml'
    case 'md':
    case 'markdown':
      return 'text/markdown'
    case 'txt':
      return 'text/plain'
    default:
      return 'application/octet-stream'
  }
}

const getFileName = (document: FileRenderDocument): string => {
  if (document.fileName) return document.fileName
  if (document.file instanceof File && document.file.name) return document.file.name
  if (document.fileData instanceof File && document.fileData.name) return document.fileData.name
  if (document.filePath) {
    const parts = document.filePath.split(/[\\/]/)
    return parts[parts.length - 1] || 'document'
  }
  return 'document'
}

const createFileFromBlob = (blob: Blob, fileName: string): File => {
  return blob instanceof File
    ? blob
    : new File([blob], fileName, {
        type: blob.type || getMimeType(fileName)
      })
}

const createObjectUrl = (file: File, createdUrls: string[]): string => {
  const objectUrl = URL.createObjectURL(file)
  createdUrls.push(objectUrl)
  return objectUrl
}

const copyBytesToArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

const getSerializableFileData = (
  fileData: FileRenderDocument['fileData']
): string | ArrayBuffer | undefined => {
  if (typeof fileData === 'string' || fileData instanceof ArrayBuffer) {
    return fileData
  }
  if (fileData instanceof Uint8Array) {
    return copyBytesToArrayBuffer(fileData)
  }
  return undefined
}

export const prepareFileRenderDocument = async (
  document: FileRenderDocument,
  createdUrls: string[]
): Promise<PreparedFileRenderDocument> => {
  const fileName = getFileName(document)
  const sourceMimeType =
    document.file instanceof Blob
      ? document.file.type
      : document.fileData instanceof Blob
        ? document.fileData.type
        : undefined
  const registeredType = resolveRegisteredPreviewType(fileName, document.fileType, sourceMimeType)
  const originalFileType = document.fileType || getFileExtension(fileName)
  const fileData = getSerializableFileData(document.fileData)
  const sourceBlob =
    document.file instanceof Blob
      ? document.file
      : document.fileData instanceof Blob
        ? document.fileData
        : null

  if (
    !registeredType &&
    isKnownUnsupportedBinaryType(fileName, document.fileType, sourceMimeType)
  ) {
    return { status: 'unsupported', fileName, fileType: originalFileType }
  }

  const resolveFileType = (bytes: ArrayBuffer): string | null =>
    registeredType || (isUtf8Text(bytes) ? 'txt' : null)

  const unsupported = (): PreparedFileRenderDocument => ({
    status: 'unsupported',
    fileName,
    fileType: originalFileType
  })

  if (sourceBlob) {
    const file = createFileFromBlob(sourceBlob, fileName)
    const blobBytes = await sourceBlob.arrayBuffer()
    const resolvedFileType = resolveFileType(blobBytes)
    if (!resolvedFileType) return unsupported()
    const previewFileData = resolvedFileType === 'pdf' ? blobBytes : fileData
    return {
      status: 'ready',
      document: {
        ...document,
        uri: document.uri || createObjectUrl(file, createdUrls),
        fileData: previewFileData,
        fileName,
        fileType: resolvedFileType,
        file,
        metadata: document.metadata
      }
    }
  }

  if (document.filePath) {
    const buffer = await window.api.readFile(document.filePath)
    const bufferArray = copyBytesToArrayBuffer(buffer)
    const resolvedFileType = resolveFileType(bufferArray)
    if (!resolvedFileType) return unsupported()
    const previewFileData = resolvedFileType === 'pdf' ? bufferArray : fileData
    const file = new File([previewFileData || bufferArray], fileName, {
      type: resolvedFileType === 'txt' ? 'text/plain' : getMimeType(fileName)
    })
    return {
      status: 'ready',
      document: {
        ...document,
        uri: createObjectUrl(file, createdUrls),
        fileData: previewFileData,
        fileName,
        fileType: resolvedFileType,
        file,
        metadata: document.metadata
      }
    }
  }

  if (document.uri) {
    if (!registeredType) return unsupported()
    return {
      status: 'ready',
      document: {
        uri: document.uri,
        fileType: registeredType,
        fileData,
        fileName,
        filePath: document.filePath,
        metadata: document.metadata
      }
    }
  }

  return unsupported()
}
