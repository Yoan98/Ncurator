export const DAY_MS = 24 * 60 * 60 * 1000
export const TIMELINE_RECENT_DAY_COUNT = 7

export const startOfLocalDay = (timestamp: number): number => {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export const startOfLocalMonth = (timestamp: number): number => {
  const date = new Date(timestamp)
  date.setDate(1)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export const startOfLocalYear = (timestamp: number): number => {
  const date = new Date(timestamp)
  date.setMonth(0, 1)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export const endOfLocalMonth = (monthStart: number): number => {
  const date = new Date(monthStart)
  date.setMonth(date.getMonth() + 1)
  return date.getTime()
}

export const endOfLocalYear = (yearStart: number): number => {
  const date = new Date(yearStart)
  date.setFullYear(date.getFullYear() + 1)
  return date.getTime()
}

export type TimelineNodeLevel = 'day' | 'month' | 'year'

export type TimelineNode = {
  id: string
  level: TimelineNodeLevel
  label: string
  rangeStart: number
  rangeEnd: number
  /** Earliest local day with messages in this node range */
  jumpDayStart: number
}

export const collectMessageDayStarts = (timestamps: readonly number[]): number[] =>
  [...new Set(timestamps.map(startOfLocalDay))].sort((left, right) => left - right)

export const formatTimelineDayLabel = (dayStart: number, todayStart: number): string => {
  const offset = Math.round((todayStart - dayStart) / DAY_MS)
  if (offset === 0) return '今天'
  if (offset === 1) return '昨天'
  if (offset === 2) return '前天'
  return new Date(dayStart).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

export const formatTimelineMonthLabel = (monthStart: number, currentYear: number): string => {
  const date = new Date(monthStart)
  const month = date.getMonth() + 1
  if (date.getFullYear() === currentYear) return `${month}月`
  return `${String(date.getFullYear()).slice(2)}/${month}`
}

export const formatTimelineYearLabel = (yearStart: number): string =>
  String(new Date(yearStart).getFullYear())

const dayNode = (dayStart: number, todayStart: number): TimelineNode => ({
  id: `day-${dayStart}`,
  level: 'day',
  label: formatTimelineDayLabel(dayStart, todayStart),
  rangeStart: dayStart,
  rangeEnd: dayStart + DAY_MS,
  jumpDayStart: dayStart
})

const monthNode = (monthStart: number, days: readonly number[], currentYear: number): TimelineNode => {
  const sorted = [...days].sort((left, right) => left - right)
  return {
    id: `month-${monthStart}`,
    level: 'month',
    label: formatTimelineMonthLabel(monthStart, currentYear),
    rangeStart: monthStart,
    rangeEnd: endOfLocalMonth(monthStart),
    jumpDayStart: sorted[0] ?? monthStart
  }
}

const yearNode = (yearStart: number, days: readonly number[]): TimelineNode => {
  const sorted = [...days].sort((left, right) => left - right)
  return {
    id: `year-${yearStart}`,
    level: 'year',
    label: formatTimelineYearLabel(yearStart),
    rangeStart: yearStart,
    rangeEnd: endOfLocalYear(yearStart),
    jumpDayStart: sorted[0] ?? yearStart
  }
}

/** Days with messages that fall inside a month/year node (for DatePicker). */
export const collectSelectableDaysForNode = (
  node: Pick<TimelineNode, 'level' | 'rangeStart' | 'rangeEnd'>,
  messageDayStarts: readonly number[]
): number[] => {
  if (node.level === 'day') return [node.rangeStart]
  return messageDayStarts.filter(
    (dayStart) => dayStart >= node.rangeStart && dayStart < node.rangeEnd
  )
}

export const buildTimelineNodes = (input: {
  messageDayStarts: readonly number[]
  now?: number
}): TimelineNode[] => {
  const now = input.now ?? Date.now()
  const todayStart = startOfLocalDay(now)
  const currentYear = new Date(todayStart).getFullYear()
  const days = collectMessageDayStarts(input.messageDayStarts)
  if (days.length === 0) return []

  const recentStart = todayStart - (TIMELINE_RECENT_DAY_COUNT - 1) * DAY_MS
  const monthBuckets = new Map<number, number[]>()
  const yearBuckets = new Map<number, number[]>()
  const recentDays: number[] = []

  for (const dayStart of days) {
    if (dayStart >= recentStart) {
      recentDays.push(dayStart)
      continue
    }
    const year = new Date(dayStart).getFullYear()
    if (year === currentYear) {
      const monthStart = startOfLocalMonth(dayStart)
      const bucket = monthBuckets.get(monthStart) || []
      bucket.push(dayStart)
      monthBuckets.set(monthStart, bucket)
      continue
    }
    const yearStart = startOfLocalYear(dayStart)
    const bucket = yearBuckets.get(yearStart) || []
    bucket.push(dayStart)
    yearBuckets.set(yearStart, bucket)
  }

  const nodes: TimelineNode[] = [
    ...[...yearBuckets.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([yearStart, yearDays]) => yearNode(yearStart, yearDays)),
    ...[...monthBuckets.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([monthStart, monthDays]) => monthNode(monthStart, monthDays, currentYear)),
    ...recentDays.sort((left, right) => left - right).map((dayStart) => dayNode(dayStart, todayStart))
  ]
  return nodes.sort(
    (left, right) => left.rangeStart - right.rangeStart || left.jumpDayStart - right.jumpDayStart
  )
}

export const resolveActiveTimelineNodeId = (input: {
  nodes: readonly TimelineNode[]
  activeDayStart: number | null
}): string | null => {
  if (input.activeDayStart == null || input.nodes.length === 0) return null
  const dayHit = input.nodes.find(
    (node) => node.level === 'day' && node.rangeStart === input.activeDayStart
  )
  if (dayHit) return dayHit.id
  const containing = [...input.nodes]
    .reverse()
    .find(
      (node) =>
        input.activeDayStart != null &&
        input.activeDayStart >= node.rangeStart &&
        input.activeDayStart < node.rangeEnd
    )
  return containing?.id ?? null
}

export const TIMELINE_PIN_TOLERANCE_PX = 2

/** 完整态时间轴占位宽（圆点轨 + 文案列），与 `.nc-message-timeline` 非紧凑态 width 一致。 */
export const TIMELINE_FULL_WIDTH_PX = 56
/** 与 CSS `--nc-timeline-composer-max` / Composer `max-w-[760px]` 对齐。 */
export const TIMELINE_COMPOSER_MAX_PX = 760
/** 与 CSS `--nc-timeline-track` 对齐。 */
export const TIMELINE_TRACK_PX = 16

/**
 * 完整态时间轴 left，与 CSS
 * `max(4px, calc((100% - 760px) / 4 - track/2))` 一致。
 */
export const resolveTimelineLeftPx = (hostWidthPx: number): number => {
  const centered = (hostWidthPx - TIMELINE_COMPOSER_MAX_PX) / 4 - TIMELINE_TRACK_PX / 2
  return Math.max(4, Math.round(centered))
}

/**
 * 完整态轴文案会与 Composer/审批卡左缘碰撞时进入紧凑态。
 * 不能只用「host→composer 的 gutter < 72」：轴本身有左偏移，gutter 仍 ≥72 时文案已可能叠进卡片。
 */
export const shouldUseCompactTimeline = (input: {
  hostWidthPx: number
  leftGutterPx: number
}): boolean => {
  const timelineLeftPx = resolveTimelineLeftPx(input.hostWidthPx)
  return input.leftGutterPx < timelineLeftPx + TIMELINE_FULL_WIDTH_PX
}

export const measureTimelineJumpSpacerPx = (input: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  targetTop: number
  scrollerTop: number
  currentSpacerPx: number
}): number => {
  const desiredScrollTop = input.scrollTop + (input.targetTop - input.scrollerTop)
  const contentHeight = Math.max(0, input.scrollHeight - Math.max(0, input.currentSpacerPx))
  const maxWithoutSpacer = Math.max(0, contentHeight - input.clientHeight)
  return Math.max(0, Math.ceil(desiredScrollTop - maxWithoutSpacer))
}

export const measureTimelinePinScrollTop = (input: {
  scrollTop: number
  targetTop: number
  scrollerTop: number
}): number => Math.max(0, input.scrollTop + (input.targetTop - input.scrollerTop))
