export type WpsHost = 'wps' | 'et' | 'wpp'
export type WpsAddonAvailability = 'enabled' | 'disabled' | 'unconfirmed'
export type WpsIntegrationIssue = {
  host: WpsHost
  state: 'not-enabled' | 'not-connected' | 'unconfirmed'
}
export type WpsIntegrationNotice =
  | { kind: 'integration'; issue: WpsIntegrationIssue }
  | { kind: 'refresh'; reason: string }

export const WPS_HOST_LABELS: Record<WpsHost, string> = {
  wps: 'Word 文档',
  et: 'Excel 表格',
  wpp: 'PPT 演示文稿'
}
