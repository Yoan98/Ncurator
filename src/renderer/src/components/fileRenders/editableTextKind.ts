import {
  isKnownUnsupportedBinaryType,
  isUtf8Text,
  resolveRegisteredPreviewType
} from './capabilities'

export type EditableTextKind = 'markdown' | 'plain-text' | null

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

/**
 * 判断打开的文件是否可作为应用内文本编辑（与 fileRenders 的预览分类口径一致）：
 * - .md/.markdown → markdown
 * - .txt 或严格 UTF-8 可解码的未知扩展名 → plain-text
 * - 注册过的非文本类型（pdf/docx/pptx/xlsx/图片）与已知二进制 → null
 * 未知扩展名需要读取字节做 UTF-8 嗅探。
 */
export const classifyEditableTextKind = async (
  filePath: string,
  fileName: string
): Promise<EditableTextKind> => {
  const registered = resolveRegisteredPreviewType(fileName)
  if (registered === 'md') return 'markdown'
  if (registered === 'txt') return 'plain-text'
  if (registered) return null
  if (isKnownUnsupportedBinaryType(fileName)) return null

  const bytes = await window.api.readFile(filePath)
  return isUtf8Text(toArrayBuffer(bytes)) ? 'plain-text' : null
}
