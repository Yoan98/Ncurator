import path from 'node:path'
import type { JsonObject } from '../../../../../../shared/types'

export const LEGACY_DOC_EDIT_ERROR =
  'docx_edit 不支持写入旧版 .doc 文件。请提示用户先将文件转换为 .docx，然后再进行编辑。'

export const LEGACY_DOC_EDIT_DECISION_HINT: JsonObject = {
  code: 'legacy_doc_edit_unsupported',
  instruction: '不要继续尝试编辑 .doc 文件，跳过它继续推进。'
}

export const isLegacyDocPath = (filePath: string): boolean =>
  path.extname(String(filePath || '').trim()).toLowerCase() === '.doc'

export const isReadableWordPath = (filePath: string): boolean => {
  const extension = path.extname(String(filePath || '').trim()).toLowerCase()
  return extension === '.doc' || extension === '.docx'
}
