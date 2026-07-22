import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { verifyReleaseBundle } from './artifact-bundle.mjs'

const CANDIDATE_STATES = new Set(['prepared', 'ready', 'rejected', 'published'])
const E2E_STATES = new Set(['pending', 'skipped', 'passed', 'failed'])

const candidateRoot = () =>
  path.resolve(
    String(process.env.NCURATOR_RELEASE_CANDIDATE_ROOT || '').trim() ||
      path.join(os.homedir(), '.ncurator', 'release-candidates')
  )

export const resolveCandidateDirectory = (tag, platform) =>
  path.join(candidateRoot(), tag, platform)

const statePathFor = (directory) => path.join(directory, 'candidate-state.json')

const assertCandidateState = (state, expected = {}) => {
  if (!state || typeof state !== 'object') throw new Error('candidate state is missing')
  if (state.schemaVersion !== 1) throw new Error('candidate state schemaVersion must be 1')
  if (!/^v\d+\.\d+\.\d+$/u.test(state.tag)) throw new Error('candidate state tag is invalid')
  if (!/^[a-f0-9]{40}$/u.test(state.commit)) throw new Error('candidate state commit is invalid')
  if (expected.tag && state.tag !== expected.tag) {
    throw new Error(`candidate state tag must be ${expected.tag}`)
  }
  if (expected.platform && state.platform !== expected.platform) {
    throw new Error(`candidate state platform must be ${expected.platform}`)
  }
  if (!CANDIDATE_STATES.has(state.status)) throw new Error('candidate status is invalid')
  if (!E2E_STATES.has(state.e2e?.status)) throw new Error('candidate E2E status is invalid')
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
  const directory = resolveCandidateDirectory(verified.bundle.tag, verified.bundle.platform)
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  await mkdir(directory, { recursive: true })

  const bundleName = path.basename(bundlePath)
  await copyFile(bundlePath, path.join(directory, bundleName))
  await copyFile(verified.fragmentPath, path.join(directory, path.basename(verified.fragmentPath)))
  for (const file of verified.bundle.files) {
    await copyFile(path.join(verified.directory, file.name), path.join(directory, file.name))
  }

  const candidateBundlePath = path.join(directory, bundleName)
  await verifyReleaseBundle(candidateBundlePath, {
    tag: verified.bundle.tag,
    platform: verified.bundle.platform
  })
  const state = await writeState(directory, {
    schemaVersion: 1,
    tag: verified.bundle.tag,
    commit: verified.bundle.commit,
    platform: verified.bundle.platform,
    bundle: bundleName,
    preparedAt: new Date().toISOString(),
    status: 'prepared',
    e2e: { status: 'pending' }
  })
  return { directory, bundlePath: candidateBundlePath, state }
}

export const readReleaseCandidate = async ({ tag, platform }) => {
  const directory = resolveCandidateDirectory(tag, platform)
  const state = assertCandidateState(JSON.parse(await readFile(statePathFor(directory), 'utf8')), {
    tag,
    platform
  })
  const bundlePath = path.join(directory, state.bundle)
  const verified = await verifyReleaseBundle(bundlePath, { tag, platform })
  if (verified.bundle.commit !== state.commit) {
    throw new Error('candidate state commit does not match release bundle')
  }
  return { directory, state, bundlePath, verified }
}

export const recordCandidateE2E = async ({ tag, platform, status, resultPath = '' }) => {
  if (!['skipped', 'passed', 'failed'].includes(status)) {
    throw new Error(`unsupported candidate E2E status: ${status}`)
  }
  const candidate = await readReleaseCandidate({ tag, platform })
  const state = {
    ...candidate.state,
    status: status === 'failed' ? 'rejected' : 'ready',
    e2e: {
      status,
      recordedAt: new Date().toISOString(),
      ...(resultPath ? { result: path.relative(candidate.directory, resultPath) } : {})
    }
  }
  await writeState(candidate.directory, state)
  return { ...candidate, state }
}

export const assertCandidatePublishable = async ({ tag, platform, commit }) => {
  const candidate = await readReleaseCandidate({ tag, platform })
  if (candidate.state.commit !== commit) {
    throw new Error(
      `candidate commit ${candidate.state.commit} does not match ${tag} commit ${commit}`
    )
  }
  if (candidate.state.status !== 'ready') {
    throw new Error(
      `candidate ${tag} ${platform} is ${candidate.state.status}; prepare or test it before publishing`
    )
  }
  return candidate
}

export const markCandidatePublished = async ({ tag, platform }) => {
  const candidate = await readReleaseCandidate({ tag, platform })
  const state = {
    ...candidate.state,
    status: 'published',
    publishedAt: new Date().toISOString()
  }
  await writeState(candidate.directory, state)
  return { ...candidate, state }
}
