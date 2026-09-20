export const getIndexJobProgressNumbers = (job: {
  total_count: number
  processed_count: number
  failed_count: number
}): {
  total: number
  done: number
  percent: number
  hasDeterminateProgress: boolean
} => {
  const total = Math.max(0, job.total_count)
  // processed_count already includes failed items; failed_count is a subset used for reporting.
  const done = Math.min(total, Math.max(0, job.processed_count))
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  return {
    total,
    done,
    percent,
    hasDeterminateProgress: total > 0
  }
}
