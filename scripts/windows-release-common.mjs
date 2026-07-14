/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { loadReleaseEnvironment } from './release-environment.mjs'

const execFileAsync = promisify(execFile)
const WINDOWS_PLATFORM = 'windows-x64'
const PUBLIC_RELEASE_BASE_URL = 'https://download.ncurator.com'

const commandResult = async (command, args, options = {}) => {
  try {
    const result = await execFileAsync(command, args, {
      maxBuffer: 10 * 1024 * 1024,
      shell: process.platform === 'win32' && /\.(cmd|bat)$/iu.test(command),
      ...options
    })
    return { ok: true, stdout: result.stdout.trim(), stderr: result.stderr.trim() }
  } catch (error) {
    return {
      ok: false,
      stdout: String(error?.stdout || '').trim(),
      stderr: String(error?.stderr || error?.message || '').trim()
    }
  }
}

const resolveAwsCandidates = () => {
  const configured = String(process.env.NCURATOR_AWS_CLI || '').trim()
  if (configured) return [configured]
  const candidates = []
  if (process.platform === 'win32') {
    if (process.env.ProgramFiles) {
      candidates.push(path.join(process.env.ProgramFiles, 'Amazon', 'AWSCLIV2', 'aws.exe'))
    }
    candidates.push(path.join(os.homedir(), '.ncurator', 'release-tools', 'awscli', 'aws.exe'))
  } else {
    candidates.push(path.join(os.homedir(), '.ncurator', 'release-tools', 'awscli', 'bin', 'aws'))
  }
  candidates.push('aws')
  return [...new Set(candidates)]
}

const resolveAwsExecutable = async () => {
  for (const candidate of resolveAwsCandidates()) {
    if (path.isAbsolute(candidate)) {
      const exists = await access(candidate)
        .then(() => true)
        .catch(() => false)
      if (!exists) continue
    }
    const result = await commandResult(candidate, ['--version'])
    if (result.ok) return candidate
  }
  return ''
}

const resolvePython = async () => {
  const override = String(process.env.NCURATOR_SIDECAR_BUILD_PYTHON || '').trim()
  const candidates = override
    ? [override]
    : process.platform === 'win32'
      ? ['python', 'python3', 'py']
      : ['python3.12', 'python3.11', 'python3.10', 'python3', 'python']
  for (const candidate of candidates) {
    const args = candidate === 'py' ? ['-3'] : []
    const result = await commandResult(candidate, [
      ...args,
      '-c',
      'import platform, sys; print(f"{sys.version_info.major}.{sys.version_info.minor}|{platform.machine()}")'
    ])
    if (!result.ok) continue
    const [version, architecture] = result.stdout.split('|')
    const [major, minor] = version.split('.').map(Number)
    if (major > 3 || (major === 3 && minor >= 10)) {
      return { command: candidate, args, version, architecture }
    }
  }
  return undefined
}

const expectedPnpmVersion = async (root) => {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  return String(packageJson.packageManager || '').match(/^pnpm@([^+]+)/u)?.[1] || ''
}

export const inspectLocalWindowsRelease = async (root) => {
  await loadReleaseEnvironment(root)
  const issues = []
  if (process.platform !== 'win32')
    issues.push(`operating system is ${process.platform}, not win32`)
  if (process.arch !== 'x64') issues.push(`Node architecture is ${process.arch}, not x64`)
  if (issues.length > 0) return { ready: false, issues }

  const nodeMajor = Number(process.versions.node.split('.')[0])
  if (nodeMajor !== 22)
    issues.push(`Node ${process.versions.node} is installed; Node 22 is required`)

  const pnpmExecutable = 'pnpm.cmd'
  const pnpm = await commandResult(pnpmExecutable, ['--version'], { cwd: root })
  const expectedPnpm = await expectedPnpmVersion(root)
  if (!pnpm.ok) issues.push('pnpm is not available')
  else if (expectedPnpm && pnpm.stdout !== expectedPnpm) {
    issues.push(`pnpm ${pnpm.stdout} is installed; pnpm ${expectedPnpm} is required`)
  }

  const python = await resolvePython()
  if (!python) issues.push('Python >= 3.10 is not available')
  else if (!/^(AMD64|x86_64)$/iu.test(python.architecture)) {
    issues.push(`Python architecture is ${python.architecture}, not x64`)
  }

  const awsExecutable = await resolveAwsExecutable()
  if (!awsExecutable) issues.push('AWS CLI is not available')

  for (const name of [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'R2_ACCOUNT_ID',
    'R2_BUCKET_NAME',
    'R2_PUBLIC_BASE_URL'
  ]) {
    if (!String(process.env[name] || '').trim())
      issues.push(`missing environment variable: ${name}`)
  }
  const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/u, '')
  if (publicBaseUrl && publicBaseUrl !== PUBLIC_RELEASE_BASE_URL) {
    issues.push(`R2_PUBLIC_BASE_URL must be ${PUBLIC_RELEASE_BASE_URL}`)
  }

  return {
    ready: issues.length === 0,
    issues,
    awsExecutable,
    pnpmExecutable,
    python
  }
}

export const assertWindowsReleaseRouteAvailable = async ({
  root,
  forceLocal,
  forceActions,
  localInspection
}) => {
  await loadReleaseEnvironment(root)
  const inspection =
    localInspection || (forceActions ? undefined : await inspectLocalWindowsRelease(root))
  if (forceLocal) {
    if (!inspection?.ready) {
      throw new Error(`local Windows release is unavailable:\n- ${inspection?.issues.join('\n- ')}`)
    }
    return 'local'
  }
  if (!forceActions && inspection?.ready) return 'local'
  if (!String(process.env.NCURATOR_ACTIONS_TOKEN || '').trim()) {
    const reason = inspection?.issues?.length ? `\n- ${inspection.issues.join('\n- ')}` : ''
    throw new Error(
      `Windows cannot be released locally and NCURATOR_ACTIONS_TOKEN is not configured for the Actions fallback${reason}`
    )
  }
  return 'actions'
}

export const dispatchWindowsRelease = async (root, releaseTag) => {
  await loadReleaseEnvironment(root)
  const token = String(process.env.NCURATOR_ACTIONS_TOKEN || '').trim()
  if (!token) throw new Error('NCURATOR_ACTIONS_TOKEN is required to dispatch GitHub Actions')
  const repository = String(process.env.RELEASE_REPOSITORY || 'Yoan98/Ncurator')
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/workflows/release.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ref: 'main', inputs: { tag: releaseTag } })
    }
  )
  if (!response.ok) {
    throw new Error(
      `GitHub Actions dispatch failed: HTTP ${response.status} ${await response.text()}`
    )
  }
  process.stdout.write(`[release] dispatched GitHub Actions for Windows ${releaseTag}\n`)
}

export const readPublicReleaseFragment = async (
  releaseTag,
  platform,
  publicBaseUrl = PUBLIC_RELEASE_BASE_URL
) => {
  const response = await fetch(
    `${publicBaseUrl}/release-status/${releaseTag}/${platform}.json?check=${Date.now()}`,
    { cache: 'no-store' }
  )
  if (response.status === 404) return undefined
  if (!response.ok) {
    throw new Error(`release status lookup failed for ${platform}: HTTP ${response.status}`)
  }
  const fragment = await response.json()
  if (
    fragment.schemaVersion !== 1 ||
    fragment.tag !== releaseTag ||
    fragment.platform !== platform ||
    !Array.isArray(fragment.files)
  ) {
    throw new Error(`invalid remote release fragment: ${platform}`)
  }
  return fragment
}

export const verifyPublicReleaseFragment = async (
  fragment,
  publicBaseUrl = PUBLIC_RELEASE_BASE_URL
) => {
  for (const file of fragment.files) {
    const response = await fetch(`${publicBaseUrl}/artifacts/${fragment.tag}/${file.name}`, {
      method: 'HEAD',
      cache: 'no-store'
    })
    if (!response.ok || Number(response.headers.get('content-length')) !== file.size) {
      throw new Error(`remote release asset verification failed: ${file.name}`)
    }
  }
}

export { PUBLIC_RELEASE_BASE_URL, WINDOWS_PLATFORM }
