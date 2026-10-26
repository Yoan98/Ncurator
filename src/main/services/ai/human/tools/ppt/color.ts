/** Authoring canvas in pt (1 unit = 1pt), matching standard 16:9 slide size. */
export const PPT_CANVAS_WIDTH = 960
export const PPT_CANVAS_HEIGHT = 540

/** Opaque `#RGB` / `#RRGGBB`; bare hex accepted as兜底. No rgb()/names/alpha. */
export const normalizePptColor = (
  value: string | undefined,
  fallback?: string
): string | undefined => {
  const raw = String(value || '').trim()
  if (!raw) return fallback
  const short = /^#?([0-9a-f]{3})$/i.exec(raw)
  if (short)
    return `#${short[1]!
      .split('')
      .map((part) => `${part}${part}`)
      .join('')}`.toUpperCase()
  const hex = /^#?([0-9a-f]{6})$/i.exec(raw)
  if (hex) return `#${hex[1]!.toUpperCase()}`
  throw new Error(`Color must be opaque #RRGGBB; received: ${raw}`)
}
