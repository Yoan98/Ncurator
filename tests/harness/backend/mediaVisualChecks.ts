export type MotionFrame = { x: number; count: number; top: Uint8ClampedArray }

/** The task places a dark title in the upper third; LCD text fringes are not the moving object. */
export const measureMotionFrame = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  color: 'blue' | 'orange'
): MotionFrame => {
  const titleEnd = width * Math.floor(height / 3) * 4
  let sum = 0,
    count = 0
  for (let i = titleEnd; i < pixels.length; i += 4) {
    const [r, g, b] = pixels.subarray(i, i + 3)
    if (color === 'blue' ? b > r + 30 && b > g + 10 : r > g + 30 && g > b + 30) {
      sum += (i / 4) % width
      count++
    }
  }
  return { x: sum / Math.max(1, count), count, top: pixels.slice(0, titleEnd) }
}
export const checkMotionVersions = (
  before: MotionFrame[],
  after: MotionFrame[]
): { actualMotion: boolean; colorOnly: boolean } => ({
  actualMotion: [before, after].every((frames) => {
    const visible = frames.filter((frame) => frame.count > 100)
    return (
      visible.length >= 3 &&
      visible.every((frame, i) => !i || frame.x >= visible[i - 1].x - 2) &&
      visible.at(-1)!.x - visible[0].x > 100
    )
  }),
  colorOnly:
    before.length === after.length &&
    before.every((frame, i) => {
      const other = after[i],
        stable = frame.count > 100 && other.count > 100
      return (
        (!stable ||
          (Math.abs(frame.x - other.x) < 2 &&
            Math.abs(frame.count - other.count) / Math.max(frame.count, other.count) < 0.2)) &&
        frame.top.reduce((sum, value, j) => sum + Math.abs(value - other.top[j]), 0) /
          frame.top.length <
          3
      )
    })
})
