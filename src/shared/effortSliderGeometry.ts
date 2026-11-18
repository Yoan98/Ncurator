/**
 * 思考强度滑块的几何计算。
 *
 * 抽成纯函数是为了让组件和测试共用同一份实现：点位、填充、拖拽换算必须完全一致，
 * 否则会出现「圆点压在小点旁边」这种错位。
 *
 * 坐标约定：以下所有横坐标都是「相对轨道容器左端」的容器坐标。
 * 轨道条本身两端各内缩 EFFORT_TRACK_RADIUS，于是：
 * - 首末档的形象中心正对轨道圆头的圆心（左右两端都是），形象站在轨道边缘；
 * - 填充从轨道条左端画起，末档铺到轨道条右端，右侧不留浅色尾巴；
 * - 拖动时严格跟手，松手才按最近档位吸附。
 */

/**
 * 滑块尺寸。
 *
 * 滑块里直接就是伙伴形象本身，不再垫白色圆底，所以这个值就是形象的直径。
 * 48px 是轨道（24px）的 2 倍高，形象明确是一个「站在滑块上的角色」；
 * 同时足够大，能盖住填充末端的圆头，避免右侧露出灰轨道。
 */
export const EFFORT_THUMB_SIZE = 48
/** 滑块圆点半径，同时是点位的内缩量。 */
export const EFFORT_THUMB_RADIUS = EFFORT_THUMB_SIZE / 2
/**
 * 轨道高度。必须写像素：本项目根字号是 14px，Tailwind 的 h-6 = 1.5rem = 21px，
 * 会让轨道明显细于滑块，比例失衡。
 */
export const EFFORT_TRACK_HEIGHT = 24

/**
 * 轨道条两端相对容器内缩的距离，等于轨道端头半径。
 *
 * 轨道条缩进后，它的圆头圆心才落在「容器内缩一个轨道半径」处；
 * 形象中心对齐这个圆心，就成了「小人站在轨道端头的中间」。
 * 用形象半径做内缩会让中心偏右一个差值，形象会探出轨道右端。
 */
export const EFFORT_TRACK_RADIUS = EFFORT_TRACK_HEIGHT / 2

/**
 * 每个档位中心点的横坐标（容器坐标）。
 *
 * 首档 = 轨道条左端 + 轨道端头半径，末档对称。
 * 也就是形象中心正好压在轨道两个圆头的圆心上。
 */
export function effortStopPositions(width: number, count: number): number[] {
  if (count <= 0) return []
  const trackStart = EFFORT_TRACK_RADIUS
  const trackWidth = Math.max(0, width - EFFORT_TRACK_RADIUS * 2)
  const first = trackStart + EFFORT_TRACK_RADIUS
  const last = trackStart + trackWidth - EFFORT_TRACK_RADIUS
  if (count === 1) return [(first + last) / 2]
  return Array.from({ length: count }, (_, index) =>
    first + ((last - first) * index) / (count - 1)
  )
}

/**
 * 填充宽度（从轨道条左端起算）。
 *
 * 中间档画到形象中心：形象盖住末端圆头，不会在它旁边露出凸起。
 * 末档必须铺满整条轨道条：只画到形象中心的话，右侧会剩下半圆形的一截
 * 浅色轨道，看上去就是「右边还有一条缝」。
 */
export function effortFillWidth(
  activeX: number,
  containerWidth?: number,
  isLastStop?: boolean
): number {
  const trackStart = EFFORT_TRACK_RADIUS
  if (isLastStop && containerWidth !== undefined) {
    return Math.max(0, containerWidth - EFFORT_TRACK_RADIUS * 2)
  }
  return Math.max(0, activeX - trackStart)
}

/**
 * 把指针横坐标换算成最近的档位下标。
 * `clientX` 是视口坐标，`left` 是轨道左端的视口坐标。
 */
export function effortIndexFromOffset(offsetX: number, width: number, count: number): number {
  if (count <= 1) return 0
  const positions = effortStopPositions(width, count)
  const first = positions[0]
  const last = positions[positions.length - 1]
  const span = Math.max(1, last - first)
  const ratio = (offsetX - first) / span
  return Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))))
}

/**
 * 把拖拽中的横坐标夹到首末档之间。
 *
 * 区间直接由点位决定，因此拖拽与吸附用的是同一套边界，不会差半个像素。
 */
export function effortClampToTrack(x: number, width: number, count = 2): number {
  const positions = effortStopPositions(width, Math.max(2, count))
  if (positions.length === 0) return 0
  return Math.min(positions[positions.length - 1], Math.max(positions[0], x))
}

/**
 * 把 #RRGGBB 解析成 HSL。
 *
 * 只需要支持十六进制：伙伴色板本身就是十六进制常量，
 * 不做 rgb()/颜色名兼容，避免解析分支掩盖真正的输入错误。
 */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return { h: h * 360, s, l }
}

const hsl = (h: number, s: number, l: number): string =>
  `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`

/**
 * 由伙伴主色派生滑块的填充色与轨道色。
 *
 * 直接让填充用主色不行：主色是给色块用的，铺成 24px 长条后饱和度偏高、
 * 深浅不一，不同伙伴看起来像不同产品。这里统一收窄饱和度与明度，
 * 只保留色相，于是「每个伙伴有自己的颜色」又「整体是同一套 UI」。
 *
 * 主色过浅（浅灰、黄）时降低明度以保证与白底有足够对比；
 * 过深（黑、深灰）时提亮，避免看成一条黑带。
 */
export function effortPaletteFromAvatarColor(hex: string): {
  fill: string
  track: string
} {
  const { h, s, l } = hexToHsl(hex)
  // 色相明确就把饱和度抬一点，近乎无彩的灰保持低饱和（否则会变成怪异的彩色）。
  const chromatic = s >= 0.15
  const fillS = chromatic ? Math.min(0.72, Math.max(0.42, s)) : 0.06
  // 目标明度落在 0.46~0.58：够深以压住白底，又不会黑成一条。
  const fillL = Math.min(0.58, Math.max(0.46, l))
  // 轨道是同色相的极浅版本，保证填充与轨道有明确层次。
  return {
    fill: hsl(h, fillS, fillL),
    track: hsl(h, chromatic ? Math.min(0.24, fillS * 0.4) : 0.05, 0.92)
  }
}
