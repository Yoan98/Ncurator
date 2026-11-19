import { createHash } from 'node:crypto'
import { assertDistribution } from './shared/distribution.mjs'
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { verifyReleaseBundle } from './artifact-bundle.mjs'
import { resolveReleaseAssetPath } from './r2/fragment-contract.mjs'
import { compareReleaseVersions, parseReleaseTag } from './tag.mjs'
import { assertPackageRegressionPassed, RELEASE_CACHE_CASES } from './regression.mjs'

const CANDIDATE_STATES = new Set(['prepared', 'ready', 'rejected', 'published'])
const E2E_STATES = new Set(['pending', 'passed', 'failed', 'skipped'])

const candidateRoot = () =>
  path.resolve(
    String(process.env.NCURATOR_RELEASE_CANDIDATE_ROOT || '').trim() ||
      path.join(os.homedir(), '.ncurator', 'release-candidates')
  )

export const resolveCandidateDirectory = (tag, platform, distribution = 'domestic') =>
  path.join(candidateRoot(), tag, platform, assertDistribution(distribution))

const statePathFor = (directory) => path.join(directory, 'candidate-state.json')

const assertCandidateState = (state, expected = {}) => {
  if (!state || typeof state !== 'object') throw new Error('candidate state is missing')
  if (state.schemaVersion !== 2) throw new Error('candidate state schemaVersion must be 2')
  try {
    parseReleaseTag(state.tag, state.platform)
  } catch {
    throw new Error('candidate state tag is invalid')
  }
  if (!/^[a-f0-9]{40}$/u.test(state.commit)) throw new Error('candidate state commit is invalid')
  if (expected.tag && state.tag !== expected.tag) {
    throw new Error(`candidate state tag must be ${expected.tag}`)
  }
  if (expected.platform && state.platform !== expected.platform) {
    throw new Error(`candidate state platform must be ${expected.platform}`)
  }
  if (!CANDIDATE_STATES.has(state.status)) throw new Error('candidate status is invalid')
  if (!E2E_STATES.has(state.e2e?.status)) throw new Error('candidate E2E status is invalid')
  const allowedE2EStatuses = {
    prepared: ['pending'],
    ready: ['passed', 'skipped'],
    rejected: ['failed'],
    published: ['passed', 'skipped']
  }[state.status]
  if (!allowedE2EStatuses.includes(state.e2e.status)) {
    throw new Error(
      `candidate ${state.status} state must use E2E status ${allowedE2EStatuses.join(' or ')}`
    )
  }
  if (typeof state.bundle !== 'string' || state.bundle !== path.basename(state.bundle)) {
    throw new Error('candidate bundle path is invalid')
  }
  return state
}

const writeState = async (directory, state) => {
  assertCandidateState(state)
  const statePath = statePathFor(directory)
  const temporaryPath = `${statePath}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, statePath)
  return state
}

export const materializeReleaseCandidate = async ({ bundlePath }) => {
  const verified = await verifyReleaseBundle(bundlePath)
  const distribution = verified.bundle.distribution || 'domestic'
  const directory = resolveCandidateDirectory(
    verified.bundle.tag,
    verified.bundle.platform,
    distribution
  )
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  await mkdir(directory, { recursive: true })

  const bundleName = path.basename(bundlePath)
  await copyFile(bundlePath, path.join(directory, bundleName))
  await copyFile(verified.fragmentPath, path.join(directory, path.basename(verified.fragmentPath)))
  for (const file of verified.bundle.files) {
    const source = await resolveReleaseAssetPath(verified.directory, file)
    await copyFile(source, path.join(directory, file.name))
  }

  const candidateBundlePath = path.join(directory, bundleName)
  await verifyReleaseBundle(candidateBundlePath, {
    tag: verified.bundle.tag,
    platform: verified.bundle.platform
  })
  const state = await writeState(directory, {
    schemaVersion: 2,
    tag: verified.bundle.tag,
    commit: verified.bundle.commit,
    platform: verified.bundle.platform,
    distribution,
    bundle: bundleName,
    preparedAt: new Date().toISOString(),
    status: 'prepared',
    e2e: { status: 'pending' }
  })
  return { directory, bundlePath: candidateBundlePath, state }
}

export const readReleaseCandidate = async ({ tag, platform, distribution = 'domestic' }) => {
  const directory = resolveCandidateDirectory(tag, platform, distribution)
  const state = assertCandidateState(JSON.parse(await readFile(statePathFor(directory), 'utf8')), {
    tag,
    platform
  })
  const bundlePath = path.join(directory, state.bundle)
  const verified = await verifyReleaseBundle(bundlePath, { tag, platform })
  if (
    (verified.bundle.distribution || 'domestic') !== distribution ||
    (state.distribution || 'domestic') !== distribution
  )
    throw new Error('candidate distribution does not match bundle')
  if (verified.bundle.commit !== state.commit) {
    throw new Error('candidate state commit does not match release bundle')
  }
  return { directory, state, bundlePath, verified }
}

export const recordCandidateE2E = async ({
  tag,
  platform,
  status,
  resultPath = '',
  selection,
  reason = ''
}) => {
  if (!['passed', 'failed'].includes(status)) {
    throw new Error(`unsupported candidate E2E status: ${status}`)
  }
  const candidate = await readReleaseCandidate({ tag, platform, distribution: 'domestic' })
  return recordVerifiedCandidateE2E(candidate, { status, resultPath, selection, reason })
}

const recordVerifiedCandidateE2E = async (
  candidate,
  { status, resultPath, selection, reason, recheck = false, scopeReview }
) => {
  if (candidate.state.status === 'published') {
    throw new Error(
      `published candidate ${candidate.state.tag} ${candidate.state.platform} cannot be retested`
    )
  }
  if (status === 'passed') await verifyCandidateRegression(candidate, resultPath, scopeReview)
  const state = {
    ...candidate.state,
    status: status === 'failed' ? 'rejected' : 'ready',
    e2e: {
      status,
      recordedAt: new Date().toISOString(),
      ...(resultPath ? { result: path.relative(candidate.directory, resultPath) } : {}),
      ...(selection ? { selection } : {}),
      ...(scopeReview ? { scopeReview } : {}),
      ...(reason ? { reason: String(reason).trim() } : {})
    }
  }
  if (recheck) {
    const current = JSON.parse(await readFile(statePathFor(candidate.directory), 'utf8'))
    if (JSON.stringify(current) !== JSON.stringify(candidate.state)) {
      throw new Error('candidate state changed during recheck; stop other release operations first')
    }
  }
  await writeState(candidate.directory, state)
  return { ...candidate, state }
}

const isCacheGateTest = (test) =>
  RELEASE_CACHE_CASES.some(
    (id) =>
      String(test.file || '')
        .split(/[\\/]/u)
        .at(-1) ===
        id + '.e2e.test.ts' || test.cases?.some((item) => item.caseId === id)
  )

// Canonical runner evidence is read but never modified. Only explicit impact
// selection with a recorded reason can scope out historical non-gate outcomes.
export const recheckWindowsCandidateE2E = async ({ tag, commit, impactReason }) => {
  const platform = 'windows-x64'
  const candidate = await readReleaseCandidate({ tag, platform, distribution: 'domestic' })
  if (candidate.state.commit !== commit) {
    throw new Error('candidate commit does not match release tag')
  }
  const resultPath = path.join(candidate.directory, 'package-e2e-result.json')
  let scopeReview
  if (impactReason !== undefined) {
    if (!String(impactReason).trim()) throw new Error('gates-only review requires an impact reason')
    const bytes = await readFile(resultPath)
    const original = JSON.parse(bytes)
    scopeReview = {
      mode: 'gates-only',
      impactReason: String(impactReason).trim(),
      originalResultSha256: sha256Bytes(bytes),
      excludedFiles: (original.tests || [])
        .filter((test) => !isCacheGateTest(test))
        .map(({ file, status }) => ({ file, status }))
    }
  }
  return recordVerifiedCandidateE2E(candidate, {
    recheck: true,
    status: 'passed',
    resultPath,
    selection: scopeReview
      ? {
          mode: 'selected',
          cases: RELEASE_CACHE_CASES,
          gatesOnly: true,
          impactReason: scopeReview.impactReason
        }
      : candidate.state.e2e.selection,
    scopeReview,
    reason: 'Canonical package E2E evidence rechecked under the current release policy'
  })
}

const sha256Bytes = (bytes) => createHash('sha256').update(bytes).digest('hex')

const verifyCandidateRegression = async (candidate, resultPath = '', scopeReview) => {
  const file =
    resultPath ||
    (candidate.state.e2e.result && path.join(candidate.directory, candidate.state.e2e.result))
  if (!file) throw new Error('candidate requires a package E2E result file')
  const bytes = await readFile(file)
  const original = JSON.parse(bytes)
  const installer = candidate.verified.bundle.files.find((item) => item.role === 'installer')
  const scope = resultPath ? scopeReview : candidate.state.e2e.scopeReview
  if (scope) {
    if (
      scope.mode !== 'gates-only' ||
      !scope.impactReason ||
      scope.originalResultSha256 !== sha256Bytes(bytes)
    ) {
      throw new Error('scoped review source evidence changed; repeat impact review')
    }
    const tests = (original.tests || []).filter(isCacheGateTest)
    // The aggregate status reflects all historical tests. Recompute only for
    // the explicit scope; assertPackageRegressionPassed still validates every
    // selected entry, required case ID, and candidate identity.
    assertPackageRegressionPassed(
      { ...original, tests, status: 'passed' },
      candidate.verified.bundle,
      installer
    )
  } else {
    assertPackageRegressionPassed(original, candidate.verified.bundle, installer)
  }
}

export const assertCandidatePublishable = async ({
  tag,
  platform,
  commit,
  allowPublished = false,
  distribution = 'domestic'
}) => {
  let candidate = await readReleaseCandidate({ tag, platform, distribution })
  if (candidate.state.commit !== commit) {
    throw new Error(
      `candidate commit ${candidate.state.commit} does not match ${tag} commit ${commit}`
    )
  }
  if (distribution === 'international') {
    const domestic = await assertCandidatePublishable({
      tag,
      platform,
      commit,
      allowPublished,
      distribution: 'domestic'
    })
    if (domestic.state.e2e.status !== 'passed')
      throw new Error('international publication requires passed domestic E2E')
    const resourceHash = domestic.verified.bundle.sharedAppHash
    if (
      !/^[a-f0-9]{64}$/u.test(resourceHash || '') ||
      resourceHash !== candidate.verified.bundle.sharedAppHash
    )
      throw new Error('international resources do not match tested domestic resources')
    const domesticBundleSha256 = createHash('sha256')
      .update(await readFile(domestic.bundlePath))
      .digest('hex')
    if (candidate.state.status !== 'published') {
      const state = {
        ...candidate.state,
        status: 'ready',
        e2e: {
          status: 'skipped',
          reason: 'No independent international E2E; inherits domestic regression',
          domesticBundleSha256,
          sharedAppHash: resourceHash,
          recordedAt: new Date().toISOString()
        }
      }
      await writeState(candidate.directory, state)
      candidate = { ...candidate, state }
    } else if (candidate.state.e2e.domesticBundleSha256 !== domesticBundleSha256) {
      throw new Error('published international candidate domestic evidence changed')
    }
  }
  if (
    candidate.state.status !== 'ready' &&
    !(allowPublished && candidate.state.status === 'published')
  ) {
    throw new Error(
      `candidate ${tag} ${platform} is ${candidate.state.status}; prepare or test it before publishing`
    )
  }
  if (distribution === 'domestic') {
    if (candidate.state.e2e.status !== 'passed')
      throw new Error('domestic package E2E cannot be skipped')
    await verifyCandidateRegression(candidate)
  }
  return candidate
}

export const markCandidatePublished = async ({ tag, platform, distribution = 'domestic' }) => {
  const candidate = await readReleaseCandidate({ tag, platform, distribution })
  const state = {
    ...candidate.state,
    status: 'published',
    publishedAt: new Date().toISOString()
  }
  await writeState(candidate.directory, state)
  return { ...candidate, state }
}

const removeDirectoryIfEmpty = async (directory) => {
  try {
    await rmdir(directory)
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) throw error
  }
}

export const cleanupSupersededReleaseCandidates = async ({ tag, platforms }) => {
  const current = parseReleaseTag(tag)
  const selectedPlatforms = [...new Set(platforms || [])]
  if (selectedPlatforms.length === 0) throw new Error('candidate cleanup requires a platform')
  for (const platform of selectedPlatforms) parseReleaseTag(tag, platform)

  const root = candidateRoot()
  const entries = await readdir(root, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') return []
    throw error
  })
  const removed = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    let previous
    try {
      previous = parseReleaseTag(entry.name)
    } catch {
      continue
    }
    if (
      previous.family !== current.family ||
      compareReleaseVersions(previous.version, current.version) >= 0
    ) {
      continue
    }
    for (const platform of selectedPlatforms) {
      const directory = path.join(root, entry.name, platform)
      const exists = await access(directory)
        .then(() => true)
        .catch((error) => {
          if (error?.code === 'ENOENT') return false
          throw error
        })
      if (!exists) continue
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
      removed.push(directory)
    }
    await removeDirectoryIfEmpty(path.join(root, entry.name))
  }
  await removeDirectoryIfEmpty(root)
  return removed
}
