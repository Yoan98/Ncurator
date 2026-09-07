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

export type TimelineExpansion =
  | { kind: 'none' }
  | { kind: 'month'; monthStart: number }
  | { kind: 'year'; yearStart: number }

export type TimelineNodeLevel = 'day' | 'month' | 'year'

export type TimelineNode = {
  id: string
  level: TimelineNodeLevel
  /** Expanded parent rendered as a faint segment marker */
  role: 'node' | 'segment'
  label: string
  rangeStart: number
  rangeEnd: number
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

export const formatTimelineSegmentLabel = (node: Pick<TimelineNode, 'level' | 'rangeStart'>): string => {
  if (node.level === 'year') return formatTimelineYearLabel(node.rangeStart)
  if (node.level === 'month') return String(new Date(node.rangeStart).getMonth() + 1)
  return formatTimelineDayLabel(node.rangeStart, startOfLocalDay(Date.now()))
}

const dayNode = (dayStart: number, todayStart: number): TimelineNode => ({
  id: `day-${dayStart}`,
  level: 'day',
  role: 'node',
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
    role: 'node',
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
    role: 'node',
    label: formatTimelineYearLabel(yearStart),
    rangeStart: yearStart,
    rangeEnd: endOfLocalYear(yearStart),
    jumpDayStart: sorted[0] ?? yearStart
  }
}

const monthSegment = (monthStart: number, days: readonly number[]): TimelineNode => {
  const sorted = [...days].sort((left, right) => left - right)
  return {
    id: `segment-month-${monthStart}`,
    level: 'month',
    role: 'segment',
    label: String(new Date(monthStart).getMonth() + 1),
    rangeStart: monthStart,
    rangeEnd: endOfLocalMonth(monthStart),
    jumpDayStart: sorted[0] ?? monthStart
  }
}

const yearSegment = (yearStart: number, days: readonly number[]): TimelineNode => {
  const sorted = [...days].sort((left, right) => left - right)
  return {
    id: `segment-year-${yearStart}`,
    level: 'year',
    role: 'segment',
    label: formatTimelineYearLabel(yearStart),
    rangeStart: yearStart,
    rangeEnd: endOfLocalYear(yearStart),
    jumpDayStart: sorted[0] ?? yearStart
  }
}

const foldDays = (input: {
  days: readonly number[]
  todayStart: number
  currentYear: number
  allowRecentDays: boolean
}): TimelineNode[] => {
  const recentStart = input.todayStart - (TIMELINE_RECENT_DAY_COUNT - 1) * DAY_MS
  const monthBuckets = new Map<number, number[]>()
  const yearBuckets = new Map<number, number[]>()
  const recentDays: number[] = []

  for (const dayStart of input.days) {
    if (input.allowRecentDays && dayStart >= recentStart) {
      recentDays.push(dayStart)
      continue
    }
    const year = new Date(dayStart).getFullYear()
    if (year === input.currentYear) {
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
      .map(([yearStart, days]) => yearNode(yearStart, days)),
    ...[...monthBuckets.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([monthStart, days]) => monthNode(monthStart, days, input.currentYear)),
    ...recentDays.sort((left, right) => left - right).map((dayStart) => dayNode(dayStart, input.todayStart))
  ]
  return nodes.sort((left, right) => left.rangeStart - right.rangeStart || left.jumpDayStart - right.jumpDayStart)
}

const monthsFromDays = (
  days: readonly number[],
  currentYear: number
): TimelineNode[] => {
  const monthBuckets = new Map<number, number[]>()
  for (const dayStart of days) {
    const monthStart = startOfLocalMonth(dayStart)
    const bucket = monthBuckets.get(monthStart) || []
    bucket.push(dayStart)
    monthBuckets.set(monthStart, bucket)
  }
  return [...monthBuckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([monthStart, monthDays]) => monthNode(monthStart, monthDays, currentYear))
}

export const buildTimelineNodes = (input: {
  messageDayStarts: readonly number[]
  now?: number
  expansion?: TimelineExpansion
}): TimelineNode[] => {
  const now = input.now ?? Date.now()
  const todayStart = startOfLocalDay(now)
  const currentYear = new Date(todayStart).getFullYear()
  const days = collectMessageDayStarts(input.messageDayStarts)
  if (days.length === 0) return []

  const expansion = input.expansion ?? { kind: 'none' }

  if (expansion.kind === 'month') {
    const inMonth = days.filter((dayStart) => startOfLocalMonth(dayStart) === expansion.monthStart)
    const outMonth = days.filter((dayStart) => startOfLocalMonth(dayStart) !== expansion.monthStart)
    const before = outMonth.filter((dayStart) => dayStart < expansion.monthStart)
    const after = outMonth.filter((dayStart) => dayStart >= endOfLocalMonth(expansion.monthStart))
    return [
      ...foldDays({
        days: before,
        todayStart,
        currentYear,
        allowRecentDays: false
      }),
      monthSegment(expansion.monthStart, inMonth),
      ...inMonth.map((dayStart) => dayNode(dayStart, todayStart)),
      ...foldDays({
        days: after,
        todayStart,
        currentYear,
        allowRecentDays: false
      })
    ]
  }

  if (expansion.kind === 'year') {
    const inYear = days.filter((dayStart) => startOfLocalYear(dayStart) === expansion.yearStart)
    const outYear = days.filter((dayStart) => startOfLocalYear(dayStart) !== expansion.yearStart)
    const before = outYear.filter((dayStart) => dayStart < expansion.yearStart)
    const after = outYear.filter((dayStart) => dayStart >= endOfLocalYear(expansion.yearStart))
    return [
      ...foldDays({
        days: before,
        todayStart,
        currentYear,
        allowRecentDays: false
      }),
      yearSegment(expansion.yearStart, inYear),
      ...monthsFromDays(inYear, currentYear),
      ...foldDays({
        days: after,
        todayStart,
        currentYear,
        allowRecentDays: false
      })
    ]
  }

  return foldDays({
    days,
    todayStart,
    currentYear,
    allowRecentDays: true
  })
}

export const resolveActiveTimelineNodeId = (input: {
  nodes: readonly TimelineNode[]
  activeDayStart: number | null
}): string | null => {
  if (input.activeDayStart == null || input.nodes.length === 0) return null
  const dayHit = input.nodes.find(
    (node) => node.level === 'day' && node.role === 'node' && node.rangeStart === input.activeDayStart
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
