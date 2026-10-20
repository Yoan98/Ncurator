import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { loadReleaseEnvironment } from './environment.mjs'
import { resolveReleaseStorageConfig } from '../storage/config.mjs'

const execFileAsync = promisify(execFile)

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

export const resolveAwsExecutable = async () => {
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
    ? [{ command: override, args: [] }]
    : process.platform === 'win32'
      ? [
          { command: 'python', args: [] },
          { command: 'python3', args: [] },
          { command: 'py', args: ['-3.12'] }
        ]
      : [
          { command: 'python3.12', args: [] },
          { command: 'python3', args: [] },
          { command: 'python', args: [] }
        ]
  for (const candidate of candidates) {
    const result = await commandResult(candidate.command, [
      ...candidate.args,
      '-c',
      'import platform, sys; print(f"{sys.version_info.major}.{sys.version_info.minor}|{platform.machine()}|{sys.executable}")'
    ])
    if (!result.ok) continue
    const [version, architecture, executable] = result.stdout.split('|')
    const [major, minor] = version.split('.').map(Number)
    if (major === 3 && minor === 12) {
      return {
        command: candidate.command,
        args: candidate.args,
        version,
        architecture,
        executable
      }
    }
  }
  return undefined
}

const expectedPnpmVersion = async (root) => {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  return String(packageJson.packageManager || '').match(/^pnpm@([^+]+)/u)?.[1] || ''
}

export const inspectLocalWindowsRelease = async (root, { requirePublish = true } = {}) => {
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
  if (!python) issues.push('Python 3.12 x64 is not available')
  else if (!/^(AMD64|x86_64)$/iu.test(python.architecture)) {
    issues.push(`Python architecture is ${python.architecture}, not x64`)
  }

  const awsExecutable = requirePublish ? await resolveAwsExecutable() : ''
  if (requirePublish && !awsExecutable) issues.push('AWS CLI is not available')
  if (requirePublish && !(await commandResult('gh', ['--version'])).ok) {
    issues.push(
      'GitHub CLI is not available; install gh and run gh auth login --hostname github.com'
    )
  }

  for (const [command, label] of [
    ['git', 'Git'],
    ['tar', 'tar']
  ]) {
    if (!(await commandResult(command, ['--version'])).ok) issues.push(`${label} is not available`)
  }

  if (requirePublish) {
    try {
      resolveReleaseStorageConfig()
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error))
    }
  }

  return {
    ready: issues.length === 0,
    issues,
    awsExecutable,
    pnpmExecutable,
    python
  }
}
