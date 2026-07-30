import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { clipText } from '../../../../utils/text'
import { sanitizeFileNameForPath } from '../../../../utils/fileNamePolicy'
import type { DocxChangedBlock, DocxOp } from '../types'

export const sanitizeFileName = (value: string): string => {
  return sanitizeFileNameForPath({
    value,
    fallback: 'document.docx'
  })
}

export const describeDocxOp = (op: DocxOp): string => {
  switch (op.type) {
    case 'create_document':
      return '创建文档'
    case 'replace_block':
      return '替换块'
    case 'insert_after':
      return '后插入块'
    case 'insert_before':
      return '前插入块'
    case 'delete_block':
      return '删除块'
    case 'update_table_cell':
      return '更新表格单元格'
    case 'replace_text':
      return '替换文本'
    case 'style':
      return '更新文本样式'
  }
}

export const buildDocxChangeTitle = (op: DocxOp, change: DocxChangedBlock): string => {
  if (op.type === 'style') {
    const query = op.target.type === 'text_match' ? op.target.query.trim() : ''
    return query ? `更新文本样式: ${query}` : '更新文本样式'
  }
  const baseText = String(change.afterText || change.beforeText).trim()
  const previewRaw = clipText(baseText, 28).trim()
  const preview = previewRaw.length < baseText.length ? `${previewRaw}...` : previewRaw
  return preview ? `${describeDocxOp(op)}: ${preview}` : describeDocxOp(op)
}

export const buildDocxChangeSummary = (op: DocxOp, change: DocxChangedBlock): string =>
  op.type === 'style'
    ? `${describeDocxOp(op)} ${change.blockId}${op.target.type === 'text_match' ? `: ${op.target.query.trim()}` : ''}`
    : `${describeDocxOp(op)} ${change.blockId}`

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
