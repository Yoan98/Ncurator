import React, { useEffect, useId, useState } from 'react'
import type { PartnerAvatarColor, PartnerAvatarShape } from '../../../../shared/types'

const AVATAR_COLOR_HEX: Record<PartnerAvatarColor, string> = {
  black: '#1F1F1F',
  brown: '#8B5A2B',
  red: '#C44536',
  orange: '#E07A3D',
  yellow: '#E2B714',
  green: '#3D8B5A',
  teal: '#2A9D8F',
  blue: '#3B6FBA',
  purple: '#7B5EA7',
  pink: '#D46A92',
  light_grey: '#C8C6C2',
  dark_grey: '#5C5B58'
}

export const PARTNER_AVATAR_COLOR_HEX = AVATAR_COLOR_HEX

type PartnerAvatarProps = {
  shape: PartnerAvatarShape
  color: PartnerAvatarColor
  size?: number
  className?: string
  title?: string
  animationSeed?: string
  animated?: boolean
}

type EyeGlance = {
  x: number
  y: number
  rotate: number
}

const REST_GLANCE: EyeGlance = { x: 0, y: 0, rotate: 0 }

const EYE_GLANCES: EyeGlance[] = [
  REST_GLANCE,
  { x: 0, y: -5.4, rotate: 0 },
  { x: 0, y: 5, rotate: 0 },
  { x: -5.2, y: 0, rotate: 0 },
  { x: 5.2, y: 0, rotate: 0 },
  { x: -4, y: -4.2, rotate: -8 },
  { x: 4, y: -4.2, rotate: 8 },
  { x: -4, y: 3.8, rotate: -6 },
  { x: 4, y: 3.8, rotate: 6 },
  { x: 0, y: -3.2, rotate: 5 },
  { x: 0, y: 3.4, rotate: -5 }
]

const ShapeFill: React.FC<{
  shape: PartnerAvatarShape
  fill: string
  roundedStroke?: boolean
}> = ({ shape, fill, roundedStroke = false }) => {
  const paint = {
    fill,
    ...(roundedStroke
      ? { stroke: fill, strokeWidth: 8, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const }
      : {})
  }
  switch (shape) {
    case 'circle':
      return <circle cx="32" cy="32" r="20" {...paint} />
    case 'rounded_square':
      return <rect x="12" y="12" width="40" height="40" rx="18" {...paint} />
    case 'pill':
      return <rect x="7" y="21" width="50" height="22" rx="11" {...paint} />
    case 'hexagon':
      return <polygon points="32,10 50,19 50,45 32,54 14,45 14,19" {...paint} />
    case 'cloud':
      return (
        <path
          {...paint}
          d="M23 45h22c6.4 0 11.5-4.6 11.5-10.4 0-5.4-4.1-9.8-9.4-10.3C45.6 17.8 39.8 14 32.8 14 25.2 14 19 18.8 17.8 25.6 13.2 26.5 10 30.7 10 36 10 41 13.9 45 18.8 45H23Z"
        />
      )
    case 'teardrop':
      return (
        <path
          {...paint}
          d="M32 12c9.8 10.4 18 19.6 18 29.2C50 50.4 42.2 54 32 54S14 50.4 14 41.2C14 31.6 22.2 22.4 32 12Z"
        />
      )
  }
}

const hashSeed = (seed: string): number => {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const usePartnerEyeMotion = (
  seed: string,
  enabled: boolean
): { glance: EyeGlance; blinking: boolean } => {
  const [glance, setGlance] = useState<EyeGlance>(REST_GLANCE)
  const [blinking, setBlinking] = useState(false)

  useEffect(() => {
    if (!enabled || prefersReducedMotion()) {
      setGlance(REST_GLANCE)
      setBlinking(false)
      return undefined
    }

    let cancelled = false
    const timeoutIds = new Set<number>()
    const later = (fn: () => void, ms: number): void => {
      const id = window.setTimeout(() => {
        timeoutIds.delete(id)
        if (!cancelled) fn()
      }, ms)
      timeoutIds.add(id)
    }

    const glanceOnce = (): void => {
      setGlance(EYE_GLANCES[Math.floor(Math.random() * EYE_GLANCES.length)])
      later(glanceOnce, 700 + Math.random() * 2400)
    }

    const blinkOnce = (): void => {
      setBlinking(true)
      later(() => setBlinking(false), 80 + Math.random() * 70)
      if (Math.random() < 0.25) {
        later(() => {
          setBlinking(true)
          later(() => setBlinking(false), 70)
        }, 150)
      }
      later(blinkOnce, 1500 + Math.random() * 3600)
    }

    later(glanceOnce, 180 + Math.random() * 900)
    later(blinkOnce, 420 + Math.random() * 1400)

    return () => {
      cancelled = true
      timeoutIds.forEach((id) => window.clearTimeout(id))
    }
  }, [enabled, seed])

  return { glance, blinking }
}

const PartnerAvatar: React.FC<PartnerAvatarProps> = ({
  shape,
  color,
  size = 28,
  className,
  title,
  animationSeed,
  animated = false
}) => {
  const reactId = useId().replace(/:/g, '')
  const fill = AVATAR_COLOR_HEX[color]
  const seed = animationSeed || `${shape}-${color}`
  const hash = hashSeed(seed)
  const { glance, blinking } = usePartnerEyeMotion(seed, animated)
  const bodyClipId = `partner-body-${reactId}`

  return (
    <div
      className={`nc-partner-avatar-stage ${animated ? 'nc-partner-avatar-animated' : ''} ${className || ''}`.trim()}
      role="img"
      aria-hidden={title ? undefined : true}
      aria-label={title}
      style={
        {
          width: size,
          height: size,
          '--nc-avatar-delay': `${(hash % 2800) / 1000}s`,
          '--nc-avatar-turn-delay': `${((hash >>> 8) % 3400) / 1000}s`,
          '--nc-avatar-jump-duration': `${5.4 + ((hash >>> 16) % 1800) / 1000}s`,
          '--nc-avatar-turn-duration': `${8.4 + ((hash >>> 20) % 2200) / 1000}s`
        } as React.CSSProperties
      }
    >
      <div className="nc-partner-avatar-hop">
        <div className="nc-partner-avatar-tilt">
          <svg viewBox="0 0 64 64" className="nc-partner-avatar-face" aria-hidden="true">
            <defs>
              <clipPath id={bodyClipId}>
                <ShapeFill shape={shape} fill="#000" roundedStroke />
              </clipPath>
            </defs>
            <ShapeFill shape={shape} fill={fill} roundedStroke />
            <g clipPath={`url(#${bodyClipId})`}>
              <g className="nc-partner-avatar-orbit">
                <g
                  className="nc-partner-avatar-eyes"
                  style={{
                    transform: `translate(${glance.x}px, ${glance.y}px) rotate(${glance.rotate}deg) scaleY(${
                      blinking ? 0.12 : 1
                    })`,
                    transition: blinking ? 'transform 80ms ease' : 'transform 220ms ease'
                  }}
                >
                  <rect x="23" y="26" width="6" height="11" rx="3" fill="#FFFFFF" />
                  <rect x="36" y="26" width="6" height="11" rx="3" fill="#FFFFFF" />
                </g>
              </g>
            </g>
          </svg>
        </div>
      </div>
    </div>
  )
}

export default PartnerAvatar
