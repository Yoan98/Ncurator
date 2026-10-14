import type { DeliveryGuidanceItem } from '../types'

const normalizeDeliveryGuidanceText = (text: string | undefined): string | undefined => {
  const normalized = text?.trim()
  return normalized && normalized.length > 0 ? normalized : undefined
}

export const createDeliveryGuidanceItem = (
  source: DeliveryGuidanceItem['source'],
  text: string | undefined
): DeliveryGuidanceItem | undefined => {
  const normalizedText = normalizeDeliveryGuidanceText(text)
  return normalizedText ? { source, text: normalizedText } : undefined
}

export const mergeDeliveryGuidanceItems = (
  current: DeliveryGuidanceItem[] | undefined,
  incoming: DeliveryGuidanceItem | undefined
): DeliveryGuidanceItem[] | undefined => {
  if (!incoming) return current

  const existingItems = current || []
  const alreadyExists = existingItems.some(
    (item) => item.source === incoming.source && item.text === incoming.text
  )

  if (alreadyExists) return existingItems
  return [...existingItems, incoming]
}

export const renderDeliveryGuidanceItems = (items: DeliveryGuidanceItem[] | undefined): string =>
  items && items.length > 0
    ? items.map((item, index) => `${index + 1}. ${item.text}`).join('\n')
    : 'none'
