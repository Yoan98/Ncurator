import path from 'node:path'
import type { JsonObject } from '../../../../../../shared/types'

export const LEGACY_DOC_EDIT_ERROR =
  'docx_edit 不支持写入旧版 .doc 文件，禁止继续编辑 .doc 文件，继续其他事项。'

export const LEGACY_DOC_EDIT_DECISION_HINT: JsonObject = {
  code: 'legacy_doc_edit_unsupported',
  instruction: 'docx_edit 不支持写入旧版 .doc 文件，禁止继续编辑 .doc 文件，继续其他事项。'
}

export const isLegacyDocPath = (filePath: string): boolean =>
  path.extname(String(filePath || '').trim()).toLowerCase() === '.doc'

export const isReadableWordPath = (filePath: string): boolean => {
  const extension = path.extname(String(filePath || '').trim()).toLowerCase()
  return extension === '.doc' || extension === '.docx'
}
