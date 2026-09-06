import React from 'react'
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
}

const ShapeFill: React.FC<{ shape: PartnerAvatarShape; fill: string }> = ({ shape, fill }) => {
  switch (shape) {
    case 'circle':
      return <circle cx="32" cy="32" r="28" fill={fill} />
    case 'blob':
      return (
        <path
          fill={fill}
          d="M18.5 18.2c7.4-8.6 22.8-11.4 31.4-4.1 8.2 7 8.6 21.6 3.1 30.6-5.8 9.6-19.4 14.8-29.6 10.6C12.2 50.8 7.4 37.2 10 27.4c1.6-6 4.6-7.4 8.5-9.2Z"
        />
      )
    case 'rounded_square':
      return <rect x="6" y="6" width="52" height="52" rx="16" fill={fill} />
    case 'pill':
      return <rect x="10" y="8" width="44" height="48" rx="22" fill={fill} />
    case 'triangle':
      return <polygon points="32,6 58,54 6,54" fill={fill} />
    case 'hexagon':
      return <polygon points="32,4 56,18 56,46 32,60 8,46 8,18" fill={fill} />
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

const PartnerAvatar: React.FC<PartnerAvatarProps> = ({
  shape,
  color,
  size = 28,
  className,
  title
}) => {
  const fill = AVATAR_COLOR_HEX[color]
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <ShapeFill shape={shape} fill={fill} />
      <rect x="22" y="24" width="5" height="14" rx="2.5" fill="#FFFFFF" />
      <rect x="37" y="24" width="5" height="14" rx="2.5" fill="#FFFFFF" />
    </svg>
  )
}

export default PartnerAvatar
