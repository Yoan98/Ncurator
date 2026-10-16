import { PRODUCT_NAME_ZH } from '../../../../shared/constants'

const WPS_REFRESHABLE_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx'])

const extensionOf = (filePath: string): string => {
  const normalized = String(filePath || '').replace(/\\/g, '/')
  const baseName = normalized.split('/').pop() || ''
  const dot = baseName.lastIndexOf('.')
  return dot >= 0 ? baseName.slice(dot).toLowerCase() : ''
}

export const WPS_OPEN_WITH_HINT = `首次用 WPS 打开时，如弹出加载项授权，允许后 WPS 将会自动刷新显示${PRODUCT_NAME_ZH}更改后的内容。`

export const isWpsRefreshableFilePath = (filePath: string): boolean =>
  WPS_REFRESHABLE_EXTENSIONS.has(extensionOf(filePath))

export { isWpsApplication as isWpsOpenWithApplication } from '../../../../shared/fileReview'
import { isWpsApplication } from '../../../../shared/fileReview'

export const shouldShowWpsOpenWithHint = (
  filePath: string,
  applications: ReadonlyArray<{ id?: string; name?: string }>
): boolean =>
  isWpsRefreshableFilePath(filePath) && applications.some((item) => isWpsApplication(item))
