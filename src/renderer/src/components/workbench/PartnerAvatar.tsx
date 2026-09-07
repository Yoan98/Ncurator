import React, { useEffect, useState } from 'react'
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
}

type EyeGlance = {
  x: number
  y: number
}

const EYE_GLANCES: EyeGlance[] = [
  { x: 0, y: 0 },
  { x: -4.2, y: 0 },
  { x: 4.2, y: 0 },
  { x: 0, y: -3.4 },
  { x: 0, y: 3.2 },
  { x: -3.4, y: -2.6 },
  { x: 3.4, y: -2.6 },
  { x: -3.2, y: 2.4 },
  { x: 3.2, y: 2.4 }
]

const ShapeFill: React.FC<{ shape: PartnerAvatarShape; fill: string }> = ({ shape, fill }) => {
  switch (shape) {
    case 'circle':
      return <circle cx="32" cy="32" r="26" fill={fill} />
    case 'rounded_square':
      return <rect x="8" y="8" width="48" height="48" rx="14" fill={fill} />
    case 'hexagon':
      return <polygon points="32,6 54,18 54,46 32,58 10,46 10,18" fill={fill} />
    case 'cloud':
      return (
        <path
          fill={fill}
          d="M22 46h24.5c7.2 0 13-5.2 13-11.6 0-6-4.6-11-10.6-11.5C47.2 15.6 40.6 11 32.8 11 24.4 11 17.4 16.6 16 24.4 10.8 25.4 7 30.2 7 36.2 7 41.8 11.6 46 17.2 46H22Z"
        />
      )
    case 'teardrop':
      return (
        <path
          fill={fill}
          d="M32 6c11.6 12.8 22 23.4 22 34.2C54 51.6 44.2 58 32 58S10 51.6 10 40.2C10 29.4 20.4 18.8 32 6Z"
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

const usePartnerEyeMotion = (seed: string): { glance: EyeGlance; blinking: boolean } => {
  const [glance, setGlance] = useState<EyeGlance>(EYE_GLANCES[0])
  const [blinking, setBlinking] = useState(false)

  useEffect(() => {
    if (prefersReducedMotion()) return undefined

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
  }, [seed])

  return { glance, blinking }
}

const PartnerAvatar: React.FC<PartnerAvatarProps> = ({
  shape,
  color,
  size = 28,
  className,
  title,
  animationSeed
}) => {
  const fill = AVATAR_COLOR_HEX[color]
  const seed = animationSeed || `${shape}-${color}`
  const hash = hashSeed(seed)
  const { glance, blinking } = usePartnerEyeMotion(seed)
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`nc-partner-avatar ${className || ''}`.trim()}
      role="img"
      aria-hidden={title ? undefined : true}
      aria-label={title}
      style={
        {
          '--nc-avatar-delay': `${(hash % 2800) / 1000}s`,
          '--nc-avatar-turn-delay': `${((hash >>> 8) % 3400) / 1000}s`,
          '--nc-avatar-jump-duration': `${5.4 + ((hash >>> 16) % 1800) / 1000}s`,
          '--nc-avatar-turn-duration': `${8.1 + ((hash >>> 20) % 2200) / 1000}s`
        } as React.CSSProperties
      }
    >
      {title ? <title>{title}</title> : null}
      <g className="nc-partner-avatar-turn">
        <g className="nc-partner-avatar-body">
          <ShapeFill shape={shape} fill={fill} />
        </g>
        <g
          className="nc-partner-avatar-eyes"
          style={{
            transform: `translate(${glance.x}px, ${glance.y}px) scaleY(${blinking ? 0.12 : 1})`,
            transition: blinking ? 'transform 80ms ease' : 'transform 220ms ease'
          }}
        >
          <rect x="22" y="24" width="5" height="14" rx="2.5" fill="#FFFFFF" />
          <rect x="37" y="24" width="5" height="14" rx="2.5" fill="#FFFFFF" />
        </g>
      </g>
    </svg>
  )
}

export default PartnerAvatar
