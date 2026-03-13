import { readFile } from 'node:fs/promises'
import path from 'node:path'

const CATALOG_ROOT = path.resolve(process.cwd(), 'tests', 'catalog')

const readJson = async (filePath) => {
  const raw = await readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

export const CURRENT_CASE_CATALOG_PATH = path.join(CATALOG_ROOT, 'current-cases.json')
export const ARCHIVED_CASE_CATALOG_PATH = path.join(CATALOG_ROOT, 'archived-cases.json')

export const readCurrentCaseCatalog = async () => readJson(CURRENT_CASE_CATALOG_PATH)

export const readArchivedCaseCatalog = async () => readJson(ARCHIVED_CASE_CATALOG_PATH)

export const listCurrentCasesBySuite = async (suite) => {
  const catalog = await readCurrentCaseCatalog()
  return catalog.currentCases.filter((item) => item.suite === suite)
}

export const listActiveCurrentCasesBySuite = async (suite) => {
  const currentCases = await listCurrentCasesBySuite(suite)
  return currentCases.filter((item) => item.lifecycle === 'active')
}

export const findCurrentCase = async (suite, caseId) => {
  const currentCases = await listCurrentCasesBySuite(suite)
  return currentCases.find((item) => item.caseId === caseId) || null
}
