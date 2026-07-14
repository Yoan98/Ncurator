import type { AiLlmIoRecord } from '../../../src/shared/types'

export type CacheSummaryBucket = {
  calls: number
  unavailableCalls: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheMissInputTokens: number
  cacheHitRate: number | null
}

export type CacheSummary = CacheSummaryBucket & {
  schemaVersion: 1
  providerKinds: string[]
  models: string[]
  baseUrlHosts: string[]
  byCaller: Record<string, CacheSummaryBucket>
  byStablePrefixHash: Record<string, CacheSummaryBucket>
}

const createBucket = (): CacheSummaryBucket => ({
  calls: 0,
  unavailableCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  cacheMissInputTokens: 0,
  cacheHitRate: null
})

const addRecordToBucket = (bucket: CacheSummaryBucket, record: AiLlmIoRecord): void => {
  bucket.calls += 1
  const usage = record.usage
  if (!usage || usage.source === 'unavailable') {
    bucket.unavailableCalls += 1
    return
  }

  bucket.inputTokens += usage.inputTokens || 0
  bucket.outputTokens += usage.outputTokens || 0
  bucket.cachedInputTokens += usage.cachedInputTokens || 0
  bucket.cacheMissInputTokens += usage.cacheMissInputTokens || 0
}

const finalizeBucket = (bucket: CacheSummaryBucket): CacheSummaryBucket => ({
  ...bucket,
  cacheHitRate: bucket.inputTokens > 0 ? bucket.cachedInputTokens / bucket.inputTokens : null
})

const sortedUnique = (values: Array<string | undefined>): string[] =>
  Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean))).sort()

export const buildCacheSummary = (records: readonly AiLlmIoRecord[]): CacheSummary => {
  const total = createBucket()
  const byCaller: Record<string, CacheSummaryBucket> = {}
  const byStablePrefixHash: Record<string, CacheSummaryBucket> = {}

  records.forEach((record) => {
    addRecordToBucket(total, record)

    const caller = String(record.caller || 'unknown')
    byCaller[caller] ||= createBucket()
    addRecordToBucket(byCaller[caller], record)

    const stablePrefixHash = String(record.stablePrefixHash || 'missing')
    byStablePrefixHash[stablePrefixHash] ||= createBucket()
    addRecordToBucket(byStablePrefixHash[stablePrefixHash], record)
  })

  return {
    schemaVersion: 1,
    ...finalizeBucket(total),
    providerKinds: sortedUnique(records.map((record) => record.providerKind)),
    models: sortedUnique(records.map((record) => record.model)),
    baseUrlHosts: sortedUnique(records.map((record) => record.baseUrlHost)),
    byCaller: Object.fromEntries(
      Object.entries(byCaller).map(([key, bucket]) => [key, finalizeBucket(bucket)])
    ),
    byStablePrefixHash: Object.fromEntries(
      Object.entries(byStablePrefixHash).map(([key, bucket]) => [key, finalizeBucket(bucket)])
    )
  }
}
