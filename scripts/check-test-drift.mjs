#!/usr/bin/env node
import { access, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { readCurrentCaseCatalog } from './lib/testCatalog.mjs'

const TEST_ROOT = path.resolve(process.cwd(), 'tests')
const MANAGED_ROOTS = ['main', 'renderer', 'e2e'].map((segment) => path.join(TEST_ROOT, segment))
const UNIT_ROOT = path.join(TEST_ROOT, 'unit')
const SKIP_ROOT_NAMES = new Set(['catalog', 'fixtures', 'harness', 'report'])
const CASE_METADATA_PATTERNS = [
  'caseId:',
  'caseMetadata:',
  'retentionTier:',
  'runPolicy:',
  'capabilityArea:'
]

const listTestFiles = async (root) => {
  const results = []

  const walk = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_ROOT_NAMES.has(entry.name)) {
          continue
        }
        await walk(fullPath)
        continue
      }
      if (/\.(test|spec)\.[cm]?tsx?$/.test(entry.name)) {
        results.push(fullPath)
      }
    }
  }

  await walk(root)
  return results.sort()
}

const assertFileExists = async (filePath) => {
  try {
    await access(filePath)
  } catch {
    throw new Error(`current catalog source file does not exist: ${path.relative(process.cwd(), filePath)}`)
  }
}

const isUnderRoot = (filePath, root) => {
  const relative = path.relative(root, filePath)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

const main = async () => {
  const catalog = await readCurrentCaseCatalog()
  const managedSourceFiles = new Set(
    catalog.currentCases.map((item) => path.resolve(process.cwd(), item.sourceFile))
  )

  for (const sourceFile of managedSourceFiles) {
    await assertFileExists(sourceFile)
    if (isUnderRoot(sourceFile, UNIT_ROOT)) {
      throw new Error(`managed current case may not live under tests/unit: ${path.relative(process.cwd(), sourceFile)}`)
    }
    if (!MANAGED_ROOTS.some((root) => isUnderRoot(sourceFile, root))) {
      throw new Error(`managed current case must live under tests/main, tests/renderer, or tests/e2e: ${path.relative(process.cwd(), sourceFile)}`)
    }
  }

  const allTestFiles = await listTestFiles(TEST_ROOT)
  const unexpectedManagedFiles = []

  for (const oneFile of allTestFiles) {
    const relativePath = path.relative(process.cwd(), oneFile)

    if (isUnderRoot(oneFile, UNIT_ROOT)) {
      if (managedSourceFiles.has(oneFile)) {
        throw new Error(`tests/unit file leaked into current catalog: ${relativePath}`)
      }

      const content = await readFile(oneFile, 'utf8')
      if (CASE_METADATA_PATTERNS.some((pattern) => content.includes(pattern))) {
        throw new Error(`tests/unit file contains managed case metadata and must move back to managed roots: ${relativePath}`)
      }
      continue
    }

    if (MANAGED_ROOTS.some((root) => isUnderRoot(oneFile, root))) {
      if (!managedSourceFiles.has(oneFile)) {
        unexpectedManagedFiles.push(relativePath)
      }
      continue
    }

    throw new Error(`test file lives outside managed/unit roots: ${relativePath}`)
  }

  if (unexpectedManagedFiles.length > 0) {
    throw new Error(
      `managed roots contain test files missing from current catalog:\n${unexpectedManagedFiles.join('\n')}`
    )
  }

  process.stdout.write('Test drift check passed.\n')
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
