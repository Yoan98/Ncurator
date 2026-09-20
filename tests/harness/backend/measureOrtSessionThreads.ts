import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { toOrtSessionOptions, type OrtThreadBudget } from '../../../src/main/services/vector/indexSpeed'

const probePath = fileURLToPath(new URL('./measure-embedding-thread-budget.mjs', import.meta.url))

export type OrtSessionThreadMeasurement = {
  intraOpNumThreads: number
  before: number
  after: number
}

export const measureOrtSessionThreads = (input: {
  budget: OrtThreadBudget
  modelsPath: string
}): OrtSessionThreadMeasurement => {
  const result = spawnSync(
    process.execPath,
    [probePath, JSON.stringify(toOrtSessionOptions(input.budget))],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        NCURATOR_MODELS_PATH: input.modelsPath
      }
    }
  )
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() || result.stdout?.trim() || `thread probe exited ${String(result.status)}`
    )
  }
  const line = result.stdout.trim().split('\n').at(-1) || ''
  const measured = JSON.parse(line) as OrtSessionThreadMeasurement
  if (
    !Number.isInteger(measured.intraOpNumThreads) ||
    !Number.isInteger(measured.before) ||
    !Number.isInteger(measured.after)
  ) {
    throw new Error(`invalid thread probe output: ${line}`)
  }
  return measured
}
