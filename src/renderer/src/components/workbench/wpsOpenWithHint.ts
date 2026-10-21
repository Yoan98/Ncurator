import { t, getProductName } from '../../i18n'

const WPS_REFRESHABLE_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx'])

const extensionOf = (filePath: string): string => {
  const normalized = String(filePath || '').replace(/\\/g, '/')
  const baseName = normalized.split('/').pop() || ''
  const dot = baseName.lastIndexOf('.')
  return dot >= 0 ? baseName.slice(dot).toLowerCase() : ''
}

export const WPS_OPEN_WITH_HINT = t(($) => $.workbench.wpsIntegrationEnableTheAddInToRefreshSaved, {
  value1: getProductName()
})

export const isWpsRefreshableFilePath = (filePath: string): boolean =>
  WPS_REFRESHABLE_EXTENSIONS.has(extensionOf(filePath))

export { isWpsApplication as isWpsOpenWithApplication } from '../../../../shared/fileReview'
import { isWpsApplication } from '../../../../shared/fileReview'

export const shouldShowWpsOpenWithHint = (
  filePath: string,
  applications: ReadonlyArray<{ id?: string; name?: string }>
): boolean =>
  isWpsRefreshableFilePath(filePath) && applications.some((item) => isWpsApplication(item))
