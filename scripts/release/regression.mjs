import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveBundleInstaller } from './artifact-bundle.mjs'
import { passedPackageTest } from '../test/e2e-results.mjs'

const valueAfter = (args, name) => {
  const index = args.indexOf(name)
  if (index < 0) return ''
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

const VALUE_OPTIONS = new Set(['--tag', '--domain', '--suite', '--group', '--case'])
const FLAG_OPTIONS = new Set([
  '--prepare-only',
  '--test-only',
  '--publish-only',
  '--fresh-knowledge-cache'
])

export const validateReleaseArgs = (args) => {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (VALUE_OPTIONS.has(argument)) {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a value`)
      }
      index += 1
      continue
    }
    if (FLAG_OPTIONS.has(argument)) continue
    throw new Error(`unknown argument: ${argument}`)
  }
}

export const readRegressionSelection = (args) => {
  const domain = valueAfter(args, '--domain')
  const suite = valueAfter(args, '--suite')
  const groups = []
  const caseIds = []
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index]
    if (name === '--group' || name === '--case') {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
      if (name === '--group') groups.push(value)
      else caseIds.push(value)
      index += 1
    }
  }
  const freshKnowledgeCache = args.includes('--fresh-knowledge-cache')

  if (suite && !domain) throw new Error('--suite requires --domain')
  if (groups.length > 0 && (!domain || !suite)) {
    throw new Error('--group requires --domain and --suite')
  }
  if (suite === 'showcase' || groups.includes('showcase')) {
    throw new Error('不允许选择 showcase；请使用 pnpm test:showcase')
  }

  const workflowArgs = []
  if (domain) workflowArgs.push('--domain', domain)
  if (suite) workflowArgs.push('--suite', suite)
  for (const group of groups) workflowArgs.push('--group', group)
  for (const caseId of caseIds) workflowArgs.push('--case', caseId)
  if (freshKnowledgeCache) workflowArgs.push('--fresh-knowledge-cache')

  const selected = Boolean(domain || suite || groups.length > 0 || caseIds.length > 0)
  return {
    workflowArgs,
    state: {
      mode: selected ? 'selected' : 'full',
      ...(domain ? { domain } : {}),
      ...(suite ? { suite } : {}),
      ...(groups.length > 0 ? { groups } : {}),
      ...(caseIds.length > 0 ? { cases: caseIds } : {}),
      ...(freshKnowledgeCache ? { freshKnowledgeCache: true } : {})
    }
  }
}

export const hasRegressionSelectionArgs = (args) =>
  args.some((arg) =>
    ['--domain', '--suite', '--group', '--case', '--fresh-knowledge-cache'].includes(arg)
  )
export const RELEASE_CACHE_CASES = ['prefix-cache-retain-live', 'subagent-prefix-cache-retain-live']

export const assertPackageResultIdentity = (result, bundle, installer) => {
  if (
    result?.releaseTag !== bundle.tag ||
    result.releaseCommit !== bundle.commit ||
    result.releasePlatform !== bundle.platform ||
    result.artifactSha256 !== installer.sha256
  ) {
    throw new Error(
      'package E2E result does not match the candidate tag, commit, platform or installer'
    )
  }
}

export const assertPackageRegressionPassed = (result, bundle, installer) => {
  assertPackageResultIdentity(result, bundle, installer)
  if (
    result.status !== 'passed' ||
    !result.tests?.length ||
    !result.tests.every((test) => passedPackageTest(test, installer.sha256))
  ) {
    throw new Error('candidate requires actual passed package E2E case evidence')
  }
  for (const id of RELEASE_CACHE_CASES) {
    if (
      !result.tests.some((test) =>
        test.cases.some((item) => item.caseId === id && item.status === 'passed')
      )
    ) {
      throw new Error(`candidate requires passed package cache gate: ${id}`)
    }
  }
}

const runPackageRegression = async (bundlePath, resultPath, args) => {
  const { bundle, installer } = await resolveBundleInstaller(bundlePath)
  let previousResults = []
  try {
    const previous = JSON.parse(await readFile(resultPath, 'utf8'))
    assertPackageResultIdentity(previous, bundle, installer)
    previousResults = previous.tests || []
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const { runTestWorkflow } = await import('../test/workflow.mjs')
  const code = await runTestWorkflow(
    [
      '--type',
      'e2e',
      '--target',
      'package',
      '--bundle',
      bundlePath,
      '--result',
      resultPath,
      ...args
    ],
    { gateCaseIds: RELEASE_CACHE_CASES, previousResults }
  )
  if (code !== 0) return code
  assertPackageRegressionPassed(JSON.parse(await readFile(resultPath, 'utf8')), bundle, installer)
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [bundlePath, resultPath, ...args] = process.argv.slice(2)
  if (!bundlePath || !resultPath)
    throw new Error('release regression requires bundle and result paths')
  runPackageRegression(bundlePath, resultPath, args)
    .then((code) => {
      process.exit(code)
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    })
}
