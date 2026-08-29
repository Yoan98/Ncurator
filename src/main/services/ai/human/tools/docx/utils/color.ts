/** Strip optional `#` and uppercase for Word `w:color` / `w:shd` / border color values. */
export const normalizeDocxHexColor = (value: string): string =>
  value.trim().replace(/^#/, '').toUpperCase()
