import { describe, it, expect } from 'vitest'
import { measureMotionFrame, checkMotionVersions } from '../../../harness/backend/mediaVisualChecks'
const frame = (x: number | undefined, color: 'blue' | 'orange') => {
  const pixels = new Uint8ClampedArray(320 * 180 * 4).fill(255)
  for (let yy = 5; yy < 15; yy++)
    for (let xx = 145; xx < 175; xx++) {
      const i = (yy * 320 + xx) * 4
      pixels.set([85, 110, 150, 255], i)
    }
  if (x !== undefined)
    for (let yy = 90; yy < 105; yy++)
      for (let xx = x; xx < x + 15; xx++)
        pixels.set(color === 'blue' ? [10, 40, 160, 255] : [240, 120, 20, 255], (yy * 320 + xx) * 4)
  return measureMotionFrame(pixels, 320, 180, color)
}
describe('animation visual oracle', () => {
  it('ignores title subpixel fringes and allows the moving subject to enter from outside the frame', () => {
    const before = [undefined, 10, 80, 160, 240].map((x) => frame(x, 'blue')),
      after = [undefined, 10, 80, 160, 240].map((x) => frame(x, 'orange'))
    expect(checkMotionVersions(before, after)).toEqual({ actualMotion: true, colorOnly: true })
  })
  it('rejects static animation or changed trajectories', () => {
    const moving = [10, 80, 160, 240].map((x) => frame(x, 'blue')),
      still = [10, 10, 10, 10].map((x) => frame(x, 'orange'))
    expect(checkMotionVersions(moving, still)).toEqual({ actualMotion: false, colorOnly: false })
  })
})
