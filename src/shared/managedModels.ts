import { officialUrl } from './appPreferences'
import type { LlmPriceTier } from './llmPresets'

export const MANAGED_MODELS_GET = 'desktop-account:managed-models'
export const MANAGED_MODELS_PATH = '/api/v1/managed-models'
const prefix = 'managed:'
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) &&
  (value.length < 19 || value <= '9223372036854775807')

export const managedModelConfigId = (id: string): string => prefix + id
export function managedModelEntryId(configId: string): string | undefined {
  const id = configId.slice(prefix.length)
  return configId.startsWith(prefix) && validId(id) ? id : undefined
}
export const isManagedModelConfigId = (id: string): boolean => managedModelEntryId(id) !== undefined

type Prices = { input: string; cachedInput: string | null; output: string }
type PricePeriod = { reference: Prices; sale: Prices }
type TimeRule = {
  timeZone: string
  peakWeekdays: number[]
  peakWindows: { start: string; end: string }[]
  excludedDates: string[]
  validFrom: string
  validThrough: string
}
type Pricing = { discountRate: string } & (
  { allDay: PricePeriod } | { offPeak: PricePeriod; peak: PricePeriod; timeRule: TimeRule }
)
export type ManagedModel = {
  id: string
  label: string
  description: string | null
  capabilities: ('text' | 'vision')[]
  iconUrl: string
  priceTier?: LlmPriceTier
  pricing: Pricing
}
export type ManagedModelsResult =
  | { status: 'ready'; models: ManagedModel[] }
  | { status: 'signed_out' | 'unavailable' }

const record = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  throw new Error('Invalid managed model catalog')
}
const decimal = (value: unknown): string => {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,18})?$/.test(value)) {
    throw new Error('Invalid managed model price')
  }
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value
}
const prices = (value: unknown): Prices => {
  const { input, cachedInput, output } = record(value)
  return { input: decimal(input), cachedInput: cachedInput === null ? null : decimal(cachedInput), output: decimal(output) }
}
const period = (value: unknown): PricePeriod => {
  const { reference, sale } = record(value)
  return { reference: prices(reference), sale: prices(sale) }
}
const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const iconPrefix = officialUrl('domestic', '/llm/')

function schedule(value: unknown): TimeRule {
  const { timeZone, peakWeekdays, peakWindows, excludedDates, validFrom, validThrough } = record(value)
  if (typeof timeZone !== 'string' || !/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+.-]+)*$/.test(timeZone) ||
    !date(validFrom) || !date(validThrough) || !Array.isArray(excludedDates) || !excludedDates.every(date) ||
    !Array.isArray(peakWeekdays) || !peakWeekdays.length ||
    !peakWeekdays.every(day => Number.isInteger(day) && day >= 1 && day <= 7) ||
    !Array.isArray(peakWindows) || !peakWindows.length) throw new Error('Invalid managed model schedule')
  const windows = peakWindows.map(window => {
    const { start, end } = record(window)
    if (typeof start !== 'string' || !time.test(start) || typeof end !== 'string' ||
      (!time.test(end) && end !== '24:00') || start >= end) throw new Error('Invalid managed model schedule')
    return { start, end }
  })
  return { timeZone, peakWeekdays, peakWindows: windows, excludedDates, validFrom, validThrough }
}

export function parseManagedModels(value: unknown): ManagedModel[] {
  const { protocolVersion, models } = record(value)
  if (protocolVersion !== 1 || !Array.isArray(models)) throw new Error('Invalid managed model catalog')
  const ids = new Set<string>()
  return models.map(value => {
    const { id, kind, label, description, capabilities, iconUrl, priceTier, pricing } = record(value)
    if (!validId(id) || ids.has(id) || kind !== 'managed' || typeof label !== 'string' || !label.trim() ||
      (description !== null && typeof description !== 'string') || !Array.isArray(capabilities) ||
      !capabilities.every(item => item === 'text' || item === 'vision') || typeof iconUrl !== 'string' ||
      !iconUrl.startsWith(iconPrefix) || !/^[A-Za-z0-9_-]+\.(?:png|svg)$/i.test(iconUrl.slice(iconPrefix.length))) {
      throw new Error('Invalid managed model')
    }
    ids.add(id)
    const price = record(pricing)
    const discountRate = decimal(price.discountRate)
    if (!/^(?:1|0\.\d{1,6})$/.test(discountRate)) throw new Error('Invalid managed model discount')
    const publicPrice = price.allDay
      ? { discountRate, allDay: period(price.allDay) }
      : { discountRate, offPeak: period(price.offPeak), peak: period(price.peak), timeRule: schedule(price.timeRule) }
    return {
      id, label, description, capabilities, iconUrl,
      ...(priceTier === 'low' || priceTier === 'mid' || priceTier === 'high' ? { priceTier } : {}),
      pricing: publicPrice
    }
  })
}
