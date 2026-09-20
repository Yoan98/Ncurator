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
  const done = Math.min(total, Math.max(0, job.processed_count + job.failed_count))
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  return {
    total,
    done,
    percent,
    hasDeterminateProgress: total > 0
  }
}

export const formatIndexJobProgressLabel = (input: {
  percent: number
  done: number
  total: number
}): string => `${input.percent}% · ${input.done}/${input.total}`

export const INDEX_JOB_PROGRESS_LABEL_PATTERN = /\d+%\s*·\s*\d+\/\d+/
