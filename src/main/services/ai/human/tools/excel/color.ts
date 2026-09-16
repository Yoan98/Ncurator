/** ExcelJS `argb` is AARRGGBB. Authoring contract is 6-digit RGB, same as Word. */

const stripHash = (value: string): string => value.trim().replace(/^#/, '').toUpperCase()

/** Write path: 6-digit RGB becomes opaque `FF` + RGB; 8-digit ARGB is kept. */
export const toExcelArgb = (value: string): string => {
  const hex = stripHash(value)
  if (/^[0-9A-F]{6}$/.test(hex)) return `FF${hex}`
  return hex
}

/** Read path: opaque 8-digit ARGB becomes 6-digit RGB; other lengths stay as stored. */
export const toExcelRgb = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  const hex = stripHash(value)
  if (/^FF[0-9A-F]{6}$/.test(hex)) return hex.slice(2)
  return hex
}
