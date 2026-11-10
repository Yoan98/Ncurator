const unitsPerYuan = 100_000_000n
const unitsPerCent = 1_000_000n

export function exactWalletAmount(raw: string): string {
  const value = BigInt(raw)
  const magnitude = value < 0n ? -value : value
  const fraction = (magnitude % unitsPerYuan).toString().padStart(8, '0').replace(/0+$/, '')
  return (value < 0n ? '-' : '') + (magnitude / unitsPerYuan) + (fraction ? '.' + fraction : '')
}

export function walletAmount(raw: string): string {
  const value = BigInt(raw)
  const magnitude = value < 0n ? -value : value
  if (magnitude > 0n && magnitude < unitsPerCent) return (value < 0n ? '−' : '') + '＜¥0.01'
  const cents = (magnitude + unitsPerCent / 2n) / unitsPerCent
  return (value < 0n ? '−' : '') + '¥' + (cents / 100n) + '.' + (cents % 100n).toString().padStart(2, '0')
}
