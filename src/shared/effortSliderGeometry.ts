/**
 * 思考强度滑块的几何计算。
 *
 * 抽成纯函数是为了让组件和测试共用同一份实现：点位、填充、拖拽换算必须完全一致，
 * 否则会出现「圆点压在小点旁边」这种错位。
 *
 * 规则来自设计稿实测（参考图为 2× 截图，数值已折半）：
 * - 点位左右内缩量 = 滑块半径，末档圆点正好与轨道右端相切；
 * - 填充从轨道左端画到滑块左缘，因此首档时填充长度为 0；
 * - 拖动时按最近档位吸附。
 */

/** 滑块圆点直径。 */
export const EFFORT_THUMB_SIZE = 27
/** 滑块圆点半径，同时是点位的内缩量。 */
export const EFFORT_THUMB_RADIUS = EFFORT_THUMB_SIZE / 2
/**
 * 轨道高度。必须写像素：本项目根字号是 14px，Tailwind 的 h-6 = 1.5rem = 21px，
 * 会让轨道明显细于 27px 的滑块，比例失衡。
 */
export const EFFORT_TRACK_HEIGHT = 24

/** 每个档位中心点的横坐标（相对轨道左端）。 */
export function effortStopPositions(width: number, count: number): number[] {
  if (count <= 0) return []
  const inset = EFFORT_THUMB_RADIUS
  const inner = Math.max(0, width - inset * 2)
  if (count === 1) return [inset + inner / 2]
  return Array.from({ length: count }, (_, index) => inset + (inner * index) / (count - 1))
}

/**
 * 填充宽度：从轨道左端画到滑块左缘，首档时为 0。
 *
 * 与参考图一致：填充末端与滑块之间的 1px 缝就是滑块的 border，
 * 所以不能把它当成间距去掉。
 */
export function effortFillWidth(activeX: number): number {
  return Math.max(0, activeX - EFFORT_THUMB_RADIUS)
}

/**
 * 把指针横坐标换算成最近的档位下标。
 * `clientX` 是视口坐标，`left` 是轨道左端的视口坐标。
 */
export function effortIndexFromOffset(offsetX: number, width: number, count: number): number {
  if (count <= 1) return 0
  const inset = EFFORT_THUMB_RADIUS
  const inner = Math.max(1, width - inset * 2)
  const ratio = (offsetX - inset) / inner
  return Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))))
}
