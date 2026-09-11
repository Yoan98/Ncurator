import path from 'node:path'

export const LEGACY_DOC_EDIT_ERROR =
  'DOCX 写入工具禁止尝试任何对 .doc 文件的编辑，该格式只读不可修改，请立即停止并继续处理其他事项。'

export const isLegacyDocPath = (filePath: string): boolean =>
  path.extname(String(filePath || '').trim()).toLowerCase() === '.doc'

export const isReadableWordPath = (filePath: string): boolean => {
  const extension = path.extname(String(filePath || '').trim()).toLowerCase()
  return extension === '.doc' || extension === '.docx'
}
