#!/usr/bin/env node
import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { ARCHIVED_CASE_RECORDS, ARCHIVED_REPORT_SUITES } from '../tests/catalog/case-governance.mjs'
import { readCurrentCaseCatalog } from './lib/testCatalog.mjs'

const REPORT_ROOT = path.resolve(process.cwd(), 'tests', 'report')
const REPORT_META_DIRS = new Set(['batches', 'compare'])

const main = async () => {
  const currentCatalog = await readCurrentCaseCatalog()
  const activePairs = new Set(currentCatalog.currentCases.map((item) => `${item.suite}/${item.caseId}`))
  const archivedPairs = new Set(ARCHIVED_CASE_RECORDS.map((item) => `${item.suite}/${item.caseId}`))

  for (const suite of ARCHIVED_REPORT_SUITES) {
    const suiteRoot = path.join(REPORT_ROOT, suite)
    await rm(suiteRoot, { recursive: true, force: true })
    process.stdout.write(`Removed stale suite: ${suiteRoot}\n`)
  }

  const suites = await readdir(REPORT_ROOT, { withFileTypes: true })
  for (const suiteEntry of suites) {
    if (!suiteEntry.isDirectory()) continue
    if (ARCHIVED_REPORT_SUITES.includes(suiteEntry.name)) continue

    const suiteRoot = path.join(REPORT_ROOT, suiteEntry.name)
    const caseEntries = await readdir(suiteRoot, { withFileTypes: true })
    for (const caseEntry of caseEntries) {
      if (!caseEntry.isDirectory()) continue
      if (REPORT_META_DIRS.has(caseEntry.name)) continue

      const pair = `${suiteEntry.name}/${caseEntry.name}`
      if (activePairs.has(pair)) continue
      if (!archivedPairs.has(pair)) {
        throw new Error(`refusing to remove unknown stale report dir: ${pair}`)
      }

      const caseRoot = path.join(suiteRoot, caseEntry.name)
      await rm(caseRoot, { recursive: true, force: true })
      process.stdout.write(`Removed stale case report dir: ${caseRoot}\n`)
    }
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
