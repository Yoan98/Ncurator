import React from 'react'
import { RiCoinLine } from 'react-icons/ri'
import type { LlmPriceTier } from '../../../shared/llmPresets'

const TIER_COLORS: Record<LlmPriceTier, string> = {
  low: '#2F6F4E',
  mid: '#B45309',
  high: '#B3261E'
}

const TIER_COUNT: Record<LlmPriceTier, number> = {
  low: 1,
  mid: 2,
  high: 3
}

const COIN_SIZE = 12
const COIN_STEP = 6

export const PriceTierBadge: React.FC<{ tier: LlmPriceTier }> = ({ tier }) => {
  const count = TIER_COUNT[tier]
  const color = TIER_COLORS[tier]
  return (
    <span
      className="relative inline-block shrink-0"
      style={{
        width: COIN_SIZE,
        height: COIN_SIZE + (count - 1) * COIN_STEP
      }}
    >
      {Array.from({ length: count }, (_, index) => (
        <RiCoinLine
          key={index}
          className="absolute left-0 h-3 w-3"
          style={{
            color,
            bottom: index * COIN_STEP
          }}
        />
      ))}
    </span>
  )
}
