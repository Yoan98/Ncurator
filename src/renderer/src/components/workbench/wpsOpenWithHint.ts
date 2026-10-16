import { PRODUCT_NAME_ZH } from '../../../../shared/constants'

const WPS_REFRESHABLE_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx'])

const extensionOf = (filePath: string): string => {
  const normalized = String(filePath || '').replace(/\\/g, '/')
  const baseName = normalized.split('/').pop() || ''
  const dot = baseName.lastIndexOf('.')
  return dot >= 0 ? baseName.slice(dot).toLowerCase() : ''
}

export const WPS_OPEN_WITH_HINT = `WPS 联动使用说明：启用${PRODUCT_NAME_ZH}加载项后，可刷新写回内容并从审核定位。`

export const isWpsRefreshableFilePath = (filePath: string): boolean =>
  WPS_REFRESHABLE_EXTENSIONS.has(extensionOf(filePath))

export { isWpsApplication as isWpsOpenWithApplication } from '../../../../shared/fileReview'
import { isWpsApplication } from '../../../../shared/fileReview'

export const shouldShowWpsOpenWithHint = (
  filePath: string,
  applications: ReadonlyArray<{ id?: string; name?: string }>
): boolean =>
  isWpsRefreshableFilePath(filePath) && applications.some((item) => isWpsApplication(item))
