import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { clipText } from '../../../../utils/text'
import { sanitizeFileNameForPath } from '../../../../utils/fileNamePolicy'
import type { DocxChangedNode, DocxOperation } from '../types'

export const sanitizeFileName = (value: string): string => {
  return sanitizeFileNameForPath({
    value,
    fallback: 'document.docx'
  })
}

export const describeDocxOperation = (op: DocxOperation): string => {
  switch (op.type) {
    case 'create_document':
      return '创建文档'
    case 'replace_node':
      return '替换节点'
    case 'insert_nodes':
      return '插入节点'
    case 'delete_node':
      return '删除节点'
    case 'replace_text':
      return '替换文本'
    case 'format_text':
    case 'format_paragraph':
    case 'format_table':
    case 'format_row':
    case 'format_cell':
      return '更新格式'
  }
  return op.type.replaceAll('_', ' ')
}

export const buildDocxChangeTitle = (op: DocxOperation, change: DocxChangedNode): string => {
  if (op.type === 'format_text') {
    const query = op.text?.trim() || ''
    return query ? `更新文本样式: ${query}` : '更新文本样式'
  }
  const baseText = String(change.afterText || change.beforeText).trim()
  const previewRaw = clipText(baseText, 28).trim()
  const preview = previewRaw.length < baseText.length ? `${previewRaw}...` : previewRaw
  return preview ? `${describeDocxOperation(op)}: ${preview}` : describeDocxOperation(op)
}

export const buildDocxChangeSummary = (op: DocxOperation, change: DocxChangedNode): string =>
  op.type === 'format_text'
    ? `${describeDocxOperation(op)} ${change.nodeId}${op.text?.trim() ? `: ${op.text.trim()}` : ''}`
    : `${describeDocxOperation(op)} ${change.nodeId}`

export const calculateFileStats = async (
  filePath: string
): Promise<{ checksum: string; byteSize: number; modifiedAt: number }> => {
  const [stat, buffer] = await Promise.all([fs.stat(filePath), fs.readFile(filePath)])
  return {
    checksum: createHash('sha256').update(buffer).digest('hex'),
    byteSize: buffer.byteLength,
    modifiedAt: Math.trunc(stat.mtimeMs)
  }
}

export const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
