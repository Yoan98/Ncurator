import { t, getRendererRuntime } from './index'
import { zh } from './resources'
import { startOfLocalDay, type TimelineNode } from '../../../shared/workbench/messageTimeline'

type SystemKey = keyof typeof zh.system
const systemEntries = Object.entries(zh.system) as Array<[SystemKey, string]>
const exact = new Map(systemEntries.map(([key, value]) => [value, key]))
const escapePattern = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const patterns = systemEntries
  .filter(([, value]) => value.includes('{{'))
  .map(([key, value]) => ({
    key,
    pattern: new RegExp(
      `^${value
        .split(/\{\{value\d+\}\}/u)
        .map(escapePattern)
        .join('([\\s\\S]*?)')}$`,
      'u'
    )
  }))

/** Translate legacy system-generated projection copy at its UI boundary, never model/user text. */
export const localizeSystemText = (value: string): string => {
  if (getRendererRuntime().locale === 'zh-CN') return value
  const key = exact.get(value)
  if (key) return t(($) => $.system[key], { value1: '', value2: '', value3: '', value4: '' })
  for (const { key: templateKey, pattern } of patterns) {
    const match = pattern.exec(value)
    if (!match) continue
    const translateSkillList = (text: string): string =>
      text
        .split('、')
        .map((part) => {
          const skillKey = exact.get(part)
          return skillKey
            ? t(($) => $.system[skillKey], { value1: '', value2: '', value3: '', value4: '' })
            : part
        })
        .join(', ')
    const skillTemplate = [
      'learning',
      'learned',
      'partiallyFailedToLearn',
      'failedToLearn'
    ].includes(templateKey)
    const values = Object.fromEntries(
      match
        .slice(1)
        .map((capture, index) => [
          `value${index + 1}`,
          skillTemplate ? translateSkillList(capture) : capture
        ])
    )
    return t(($) => $.system[templateKey], {
      value1: '',
      value2: '',
      value3: '',
      value4: '',
      ...values
    })
  }
  return value
}

export const timelineLabel = (node: TimelineNode): string => {
  if (getRendererRuntime().locale === 'zh-CN') return node.label
  const date = new Date(node.rangeStart)
  if (node.level === 'year') return String(date.getFullYear())
  if (node.level === 'month')
    return new Intl.DateTimeFormat('en', {
      month: 'short',
      ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {})
    }).format(date)
  const gap = Math.round(
    (startOfLocalDay(Date.now()) - startOfLocalDay(node.rangeStart)) / 86_400_000
  )
  if (gap === 0) return t(($) => $.preferences.today)
  if (gap === 1) return t(($) => $.preferences.yesterday)
  if (gap === 2) return t(($) => $.preferences.dayBeforeYesterday)
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date)
}

export const messageTimeLabel = (timestamp: number): string => {
  const locale = getRendererRuntime().locale
  const gap = Math.round((startOfLocalDay(Date.now()) - startOfLocalDay(timestamp)) / 86_400_000)
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(timestamp)
  if (gap === 0) return time
  if (gap === 1) return `${t(($) => $.preferences.yesterday)} ${time}`
  if (gap > 1 && gap < 7)
    return `${new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(timestamp)} ${time}`
  return `${new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'numeric', day: 'numeric' }).format(timestamp)} ${time}`
}
