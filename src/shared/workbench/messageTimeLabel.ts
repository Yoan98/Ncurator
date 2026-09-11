import { startOfLocalDay } from './messageTimeline'

export const USER_MESSAGE_TIME_GAP_MS = 30 * 60 * 1000

const WEEKDAY_LABELS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'] as const

const padTimePart = (value: number): string => String(value).padStart(2, '0')

export const formatUserMessageTimeLabel = (timestamp: number, now = Date.now()): string => {
  const date = new Date(timestamp)
  const time = `${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`
  const todayStart = startOfLocalDay(now)
  const messageDay = startOfLocalDay(timestamp)
  const dayGap = Math.round((todayStart - messageDay) / (24 * 60 * 60 * 1000))
  if (dayGap === 0) return time
  if (dayGap === 1) return `昨天 ${time}`
  if (dayGap > 1 && dayGap < 7) return `${WEEKDAY_LABELS[date.getDay()]} ${time}`
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${time}`
}

export const shouldShowUserMessageTime = (
  previousUserTimestamp: number | null,
  currentTimestamp: number
): boolean => {
  if (previousUserTimestamp == null) return true
  if (currentTimestamp - previousUserTimestamp >= USER_MESSAGE_TIME_GAP_MS) return true
  return startOfLocalDay(currentTimestamp) !== startOfLocalDay(previousUserTimestamp)
}

export const collectUserMessageTimeIds = (
  messages: readonly { id: string; role: string; timestamp: number }[]
): Set<string> => {
  const ids = new Set<string>()
  let previousUserTimestamp: number | null = null
  for (const message of messages) {
    if (message.role !== 'user') continue
    if (shouldShowUserMessageTime(previousUserTimestamp, message.timestamp)) {
      ids.add(message.id)
    }
    previousUserTimestamp = message.timestamp
  }
  return ids
}
