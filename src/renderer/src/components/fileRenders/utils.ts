import type { FileRenderDocument, LoadedFileRenderDocument } from './types'

const getMimeType = (filename: string): string => {
  const extension = filename.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'pdf':
      return 'application/pdf'
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'md':
    case 'markdown':
      return 'text/markdown'
    case 'txt':
      return 'text/plain'
    default:
      return 'application/octet-stream'
  }
}

const getFileType = (filename: string): string => {
  return filename.split('.').pop()?.toLowerCase() || ''
}

const resolveUtf8TextFileType = (bytes: ArrayBuffer, fileType: string): string => {
  if (fileType === 'pdf' || fileType === 'docx' || fileType === 'md' || fileType === 'markdown') {
    return fileType
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return 'txt'
  } catch {
    return fileType
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
): Promise<LoadedFileRenderDocument | null> => {
  const fileName = getFileName(document)
  const fileType = document.fileType || getFileType(fileName)
  const fileData = getSerializableFileData(document.fileData)
  const sourceBlob =
    document.file instanceof Blob
      ? document.file
      : document.fileData instanceof Blob
        ? document.fileData
        : null

  if (sourceBlob) {
    const file = createFileFromBlob(sourceBlob, fileName)
    const blobBytes = await sourceBlob.arrayBuffer()
    const resolvedFileType = resolveUtf8TextFileType(blobBytes, fileType)
    const previewFileData = resolvedFileType === 'pdf' ? blobBytes : fileData
    return {
      ...document,
      uri: document.uri || createObjectUrl(file, createdUrls),
      fileData: previewFileData,
      fileName,
      fileType: resolvedFileType,
      file,
      metadata: document.metadata
    }
  }

  if (document.filePath) {
    const buffer = await window.api.readFile(document.filePath)
    const bufferArray = copyBytesToArrayBuffer(buffer)
    const resolvedFileType = resolveUtf8TextFileType(bufferArray, fileType)
    const previewFileData = resolvedFileType === 'pdf' ? bufferArray : fileData
    const file = new File([previewFileData || bufferArray], fileName, {
      type: resolvedFileType === 'txt' ? 'text/plain' : getMimeType(fileName)
    })
    return {
      ...document,
      uri: createObjectUrl(file, createdUrls),
      fileData: previewFileData,
      fileName,
      fileType: resolvedFileType,
      file,
      metadata: document.metadata
    }
  }

  if (document.uri) {
    return {
      uri: document.uri,
      fileType,
      fileData,
      fileName,
      filePath: document.filePath,
      metadata: document.metadata
    }
  }

  return {
    uri: '',
    fileType,
    fileData,
    fileName,
    filePath: document.filePath,
    metadata: document.metadata
  }
}
