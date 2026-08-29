export const PPT_CANVAS_WIDTH = 1920
export const PPT_CANVAS_HEIGHT = 1080

/** Converts CSS or hex colors to the six-digit format accepted by pptx-kit. */
export const normalizePptColor = (
  value: string | undefined,
  fallback?: string
): string | undefined => {
  const raw = String(value || '').trim()
  if (!raw || raw === 'transparent' || /^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/i.test(raw)) {
    return fallback
  }
  const short = /^#([0-9a-f]{3})$/i.exec(raw)
  if (short)
    return `#${short[1]!
      .split('')
      .map((part) => `${part}${part}`)
      .join('')}`.toUpperCase()
  const hex = /^#([0-9a-f]{6})$/i.exec(raw)
  if (hex) return `#${hex[1]!.toUpperCase()}`
  const rgb =
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(
      raw
    )
  if (rgb) {
    const alpha = rgb[4]
      ? rgb[4].endsWith('%')
        ? Number(rgb[4].slice(0, -1)) / 100
        : Number(rgb[4])
      : 1
    if (alpha <= 0) return fallback
    return `#${[rgb[1], rgb[2], rgb[3]]
      .map((part) =>
        Math.max(0, Math.min(255, Number(part)))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')}`.toUpperCase()
  }
  const names: Record<string, string> = {
    white: '#FFFFFF',
    black: '#000000',
    red: '#FF0000',
    blue: '#0000FF',
    green: '#008000',
    gray: '#808080',
    grey: '#808080',
    transparent: '#FFFFFF'
  }
  return names[raw.toLowerCase()] || fallback
}
