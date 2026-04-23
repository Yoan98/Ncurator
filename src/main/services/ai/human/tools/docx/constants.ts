export const DOCX_POSITIONED_LAYOUT_PROTECTION_MESSAGE =
  '当前命中复杂定位排版区域，暂不支持自动编辑，以避免预览修订和版式叠加导致错位；你可以手动按建议内容调整该处。'

export const isDocxPositionedLayoutProtectionMessage = (message: string | undefined): boolean =>
  typeof message === 'string' && message.includes('当前命中复杂定位排版区域')
