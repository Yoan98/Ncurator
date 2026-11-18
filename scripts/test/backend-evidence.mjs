import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const backendEvidenceHash = (value) => createHash('sha256').update(value).digest('hex')
const fail = (message) => {
  throw new Error(`Backend evidence: ${message}`)
}
const caseFile = (file) => /^tests\/case\/.*\.test\.ts$/.test(file)
const ignored = (file) =>
  /^(doc\/|tests\/logs\/)/.test(file) || /^(README[^/]*|CONTRIBUTING[^/]*|AGENTS)\.md$/.test(file)
const schedulerPaths = new Set([
  'scripts/test/workflow.mjs',
  'scripts/test/backend-evidence.mjs',
  'scripts/release/prepare.mjs'
])
const stable = (value) =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v
  )
export const backendRuntimeHash = (runtime) => backendEvidenceHash(stable(runtime))

const presentationEnvKeys = new Set([
  '_',
  'SHLVL',
  'PWD',
  'OLDPWD',
  'TERM',
  'TERM_PROGRAM',
  'TERM_SESSION_ID',
  'COLORTERM',
  'FORCE_COLOR',
  'NO_COLOR',
  'COLUMNS',
  'LINES',
  // Per-tool invocation tracing only; other CODEX security/network inputs remain bound.
  'CODEX_TOOL_CALL_ID',
  'npm_lifecycle_event',
  'npm_lifecycle_script'
])
export function backendEnvironmentHash(env, envText) {
  if (!env || typeof env !== 'object' || typeof envText !== 'string')
    fail('missing environment input')
  const inherited = Object.fromEntries(
    Object.entries(env).filter(
      ([key, value]) => !presentationEnvKeys.has(key) && value !== undefined
    )
  )
  return backendEvidenceHash(stable({ inherited, envText }))
}

const git = (root, args) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 })
const normalizeFile = (file) => {
  if (
    typeof file !== 'string' ||
    !file ||
    file === '.' ||
    /[\x00-\x1f\x7f]/.test(file) ||
    file.includes('\\') ||
    path.posix.normalize(file) !== file ||
    file.startsWith('/') ||
    file.startsWith('../')
  )
    fail('invalid file path')
  return file
}

export async function captureBackendIdentity({ root, ref, runtime = {} }) {
  const commit = git(root, ['rev-parse', `${ref || 'HEAD'}^{commit}`])
    .toString()
    .trim()
  const files = {}
  if (ref) {
    const entries = git(root, ['ls-tree', '-r', '-z', commit])
      .toString()
      .split('\0')
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^([0-7]+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/)
        if (!match || match[2] !== 'blob') fail('unsupported git tree entry')
        return { oid: match[3], file: match[4] }
      })
      .filter((entry) => !ignored(entry.file))
    if (entries.length) {
      // One streaming process, binary-safe: never buffer a whole large fixture blob.
      const child = spawn('git', ['cat-file', '--batch'], {
        cwd: root,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      const completion = new Promise((resolve) => {
        child.once('error', (error) => resolve({ error }))
        child.once('close', (code) => resolve({ code }))
      })
      child.stderr.resume()
      child.stdin.on('error', () => {})
      child.stdin.end(entries.map((entry) => entry.oid).join('\n') + '\n')
      let pending = Buffer.alloc(0),
        index = 0,
        remaining = null,
        hash = null
      try {
        for await (const chunk of child.stdout) {
          pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
          while (pending.length) {
            if (remaining === null) {
              const end = pending.indexOf(10)
              if (end < 0) break
              const header = pending
                .subarray(0, end)
                .toString()
                .match(/^([a-f0-9]+) blob (\d+)$/)
              if (!header || header[1] !== entries[index]?.oid) fail('invalid git batch header')
              remaining = Number(header[2])
              hash = createHash('sha256')
              pending = pending.subarray(end + 1)
            }
            if (remaining > 0) {
              const count = Math.min(remaining, pending.length)
              hash.update(pending.subarray(0, count))
              remaining -= count
              pending = pending.subarray(count)
              if (remaining > 0) break
            }
            if (!pending.length) break
            if (pending[0] !== 10) fail('invalid git batch separator')
            files[entries[index++].file] = hash.digest('hex')
            remaining = null
            pending = pending.subarray(1)
          }
        }
        const result = await completion
        if (
          result.error ||
          result.code !== 0 ||
          index !== entries.length ||
          pending.length ||
          remaining !== null
        )
          fail('incomplete git batch read')
      } catch (error) {
        child.kill()
        await completion
        throw error
      }
    }
  } else {
    const names = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    for (const file of [...new Set(names.toString().split('\0').filter(Boolean))].sort()) {
      if (ignored(file)) continue
      try {
        files[file] = backendEvidenceHash(await readFile(path.join(root, file)))
      } catch (error) {
        if (error.code === 'ENOENT') continue
        throw error
      }
    }
  }
  return { commit, files, runtime }
}

const validateInput = ({ text, expectedSha256, identity, expectedFiles }) => {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 || '') || backendEvidenceHash(text) !== expectedSha256)
    fail('report hash mismatch')
  if (!/^[a-f0-9]{40}$/.test(identity?.commit || '') || !identity.files || !identity.runtime)
    fail('missing source identity')
  if (!expectedFiles?.length || new Set(expectedFiles).size !== expectedFiles.length)
    fail('missing or duplicate expected files')
  for (const file of expectedFiles)
    if (!caseFile(normalizeFile(file)) || !identity.files[file])
      fail(`missing source hash: ${file}`)
}
const finish = ({ text, expectedSha256, identity, expectedFiles }, format, results, provenance) => {
  if (stable(Object.keys(results).sort()) !== stable([...expectedFiles].sort()))
    fail('report file coverage mismatch')
  const attempt = { schema: 1, format, reportSha256: expectedSha256, identity, provenance, results }
  return { ...attempt, id: backendEvidenceHash(stable(attempt)) }
}
const summary = (text, label) => {
  const rows = [...text.matchAll(new RegExp(`^\\s*${label}\\s+(.+?)\\s+\\((\\d+)\\)\\s*$`, 'gm'))]
  if (rows.length !== 1) fail(`missing or ambiguous ${label} summary`)
  const counts = { passed: 0, failed: 0, skipped: 0 }
  for (const piece of rows[0][1].split('|')) {
    const m = piece.trim().match(/^(\d+) (passed|failed|skipped)$/)
    if (!m) fail(`unsupported ${label} summary`)
    counts[m[2]] += Number(m[1])
  }
  if (Object.values(counts).reduce((a, b) => a + b, 0) !== Number(rows[0][2]))
    fail('summary total mismatch')
  return counts
}
export function importLegacyBackendReport(input) {
  validateInput(input)
  const { provenance, identity } = input
  if (
    provenance?.commit !== identity.commit ||
    provenance.cleanTree !== true ||
    !provenance.statement?.trim()
  )
    fail('legacy report requires explicit clean-commit provenance')
  const text = input.text.replace(/\x1b\[[0-9;]*m/g, '')
  if ([...text.matchAll(/^\s*RUN\s+v\S+/gm)].length !== 1 || !/^\s*Duration\s+/m.test(text))
    fail('incomplete or multiple Vitest runs')
  if (/Unhandled Errors|Unhandled Rejection|Uncaught Exception|^\s*Errors\s+\d+/m.test(text))
    fail('unhandled run errors')
  const files = summary(text, 'Test Files'),
    tests = summary(text, 'Tests'),
    results = {}
  const actualFiles = { passed: 0, failed: 0, skipped: 0 },
    actualTests = { passed: 0, failed: 0, skipped: 0 }
  for (const match of text.matchAll(
    /^\s*[✓❯↓]\s+(tests\/case\/\S+\.test\.ts)\s+\((\d+) tests?([^)]*)\)(?:\s+\d+(?:\.\d+)?ms)?\s*$/gm
  )) {
    const [, file, n, detail] = match
    if (results[file]) fail(`duplicate result: ${file}`)
    const total = Number(n),
      failed = Number(detail.match(/\|\s*(\d+) failed/)?.[1] || 0),
      skipped = Number(detail.match(/\|\s*(\d+) skipped/)?.[1] || 0)
    if (detail.replace(/\|\s*\d+ (failed|skipped)/g, '').trim() || total < failed + skipped)
      fail('unsupported result counts')
    const passed = total - failed - skipped,
      status = failed ? 'failed' : passed ? 'passed' : 'skipped'
    results[file] = { status, passed, failed, skipped }
    actualFiles[status]++
    for (const key of Object.keys(actualTests)) actualTests[key] += results[file][key]
  }
  if (stable(files) !== stable(actualFiles) || stable(tests) !== stable(actualTests))
    fail('per-file results disagree with complete summary')
  return finish(input, 'vitest-text', results, provenance)
}

export function importVitestBackendReport(input) {
  validateInput(input)
  const report = JSON.parse(input.text),
    results = {}
  if (typeof report.success !== 'boolean') fail('missing JSON success status')
  if (![0, 1].includes(input.processExitCode) || input.processSignal != null)
    fail('invalid process outcome')
  if (
    !Array.isArray(report.testResults) ||
    !Number.isInteger(report.numTotalTestSuites) ||
    report.numTotalTestSuites < report.testResults.length ||
    report.wasInterrupted === true
  )
    fail('incomplete JSON report')
  for (const key of [
    'numRuntimeErrorTestSuites',
    'numUnhandledErrors',
    'unhandledErrors',
    'unhandledRejections',
    'errors',
    'testExecError'
  ]) {
    const value = report[key]
    if (
      value !== undefined &&
      value !== null &&
      value !== 0 &&
      value !== false &&
      !(Array.isArray(value) && value.length === 0)
    )
      fail(`unhandled JSON run errors: ${key}`)
  }
  let total = 0,
    passed = 0,
    failed = 0,
    skipped = 0
  for (const item of report.testResults) {
    const file = normalizeFile(
      path.isAbsolute(item.name)
        ? path.relative(input.root, item.name).split(path.sep).join('/')
        : item.name
    )
    if (
      results[file] ||
      !Array.isArray(item.assertionResults) ||
      !item.assertionResults.length ||
      !['passed', 'failed'].includes(item.status)
    )
      fail('invalid JSON suite')
    const counts = { passed: 0, failed: 0, skipped: 0 }
    for (const assertion of item.assertionResults) {
      const status =
        assertion.status === 'pending' || assertion.status === 'todo' ? 'skipped' : assertion.status
      if (!(status in counts)) fail('unfinished JSON test')
      counts[status]++
    }
    if (item.status === 'passed' && counts.failed) fail('inconsistent JSON status')
    results[file] = {
      status: item.status === 'failed' ? 'failed' : counts.passed ? 'passed' : 'skipped',
      ...counts
    }
    total += item.assertionResults.length
    passed += counts.passed
    failed += counts.failed
    skipped += counts.skipped
  }
  if (
    report.numTotalTests !== total ||
    report.numPassedTests !== passed ||
    report.numFailedTests !== failed ||
    report.numPendingTests + (report.numTodoTests || 0) !== skipped
  )
    fail('JSON summary mismatch')
  const hasFailedResult = Object.values(results).some((result) => result.status === 'failed')
  if (
    !(
      (input.processExitCode === 0 && report.success === true && !hasFailedResult) ||
      (input.processExitCode === 1 && report.success === false && hasFailedResult)
    )
  )
    fail('process outcome disagrees with JSON report')
  return finish(input, 'vitest-json', results, {
    commit: input.identity.commit,
    sourceBinding: 'caller-bound-source',
    processExitCode: input.processExitCode
  })
}

export function planBackendResume({
  attempts,
  currentIdentity,
  files,
  approvedSchedulingChanges = [],
  legacyEnvironmentAudits = []
}) {
  if (!files.length || new Set(files).size !== files.length)
    fail('empty or duplicate resume selection')
  const reuse = [],
    pending = [],
    latest = new Map()
  for (const attempt of attempts) {
    const { id, ...body } = attempt
    if (attempt.schema !== 1 || id !== backendEvidenceHash(stable(body)))
      fail('attempt integrity mismatch')
    const oldRuntime = attempt.identity.runtime
    const legacyEnvironment =
      attempt.format === 'vitest-text' &&
      oldRuntime.environmentSha256 === null &&
      oldRuntime.environmentEvidence === 'not-recorded'
    if (legacyEnvironment) {
      const base = ({ environmentSha256, environmentEvidence, ...rest }) => rest
      if (
        !['platform', 'arch', 'nodeVersion'].every(
          (key) => typeof oldRuntime[key] === 'string' && oldRuntime[key]
        ) ||
        stable(base(oldRuntime)) !== stable(base(currentIdentity.runtime)) ||
        !/^[a-f0-9]{64}$/.test(currentIdentity.runtime.environmentSha256 || '')
      )
        fail('legacy runtime base identity changed')
    } else if (stable(oldRuntime) !== stable(currentIdentity.runtime))
      fail('runtime/config identity changed')
    for (const file of new Set([
      ...Object.keys(attempt.identity.files),
      ...Object.keys(currentIdentity.files)
    ])) {
      if (caseFile(file)) continue
      const from = attempt.identity.files[file] ?? null,
        to = currentIdentity.files[file] ?? null
      if (from === to) continue
      if (
        !schedulerPaths.has(file) ||
        !approvedSchedulingChanges.some(
          (a) => a.path === file && a.from === from && a.to === to && a.impact?.trim()
        )
      )
        fail(`protected source changed: ${file}`)
    }
    for (const [file, result] of Object.entries(attempt.results))
      latest.set(file, { attempt, result, legacyEnvironment })
  }
  for (const file of files) {
    if (!caseFile(normalizeFile(file)) || !currentIdentity.files[file])
      fail(`invalid current test: ${file}`)
    const prior = latest.get(file)
    let environmentAudit
    if (prior?.legacyEnvironment) {
      const matches = legacyEnvironmentAudits.filter(
        (audit) => audit.attemptId === prior.attempt.id && audit.file === file
      )
      const audit = matches.length === 1 ? matches[0] : undefined
      // This validates an external dependency audit, not an automatic proof of purity.
      if (
        audit &&
        audit.review?.method === 'transitive-pure-dependency-audit' &&
        typeof audit.review.statement === 'string' &&
        audit.review.statement.trim() &&
        audit.testHash === currentIdentity.files[file] &&
        audit.currentRuntimeHash === backendRuntimeHash(currentIdentity.runtime) &&
        audit.dependencyHashes &&
        typeof audit.dependencyHashes === 'object' &&
        !Array.isArray(audit.dependencyHashes) &&
        audit.dependencyHashes[file] === audit.testHash &&
        Object.entries(audit.dependencyHashes).every(
          ([dependency, hash]) =>
            /^[a-f0-9]{64}$/.test(hash) &&
            hash === prior.attempt.identity.files[dependency] &&
            hash === currentIdentity.files[dependency]
        )
      )
        environmentAudit = audit
    }
    if (
      prior?.result.status === 'passed' &&
      (!prior.legacyEnvironment || environmentAudit) &&
      currentIdentity.files[file] &&
      currentIdentity.files[file] === prior.attempt.identity.files[file]
    )
      reuse.push({
        file,
        attemptId: prior.attempt.id,
        ...(environmentAudit && { environmentAudit })
      })
    else pending.push(file)
  }
  return { reuse, pending, complete: pending.length === 0, approvedSchedulingChanges }
}
