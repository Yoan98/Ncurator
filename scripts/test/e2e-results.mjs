import { createReadStream } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'

export const readTestCaseIds = (filePath, source) => {
  const constants = new Map(
    [...source.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*['"]([^'"]+)['"]/gu)].map((match) => [
      match[1],
      match[2]
    ])
  )
  const ids = [...source.matchAll(/\bcaseId\s*:\s*([^,\n}]+)/gu)]
    .map((match) => match[1].trim())
    .map((value) => value.match(/^['"]([^'"]+)['"]$/u)?.[1] || constants.get(value))
    .filter(Boolean)
  return [...new Set(ids.length ? ids : [path.basename(filePath).replace(/\.e2e\.test\.ts$/u, '')])]
}

export const readE2ECaseResults = async ({ root, testFile, startedAt, caseIds }) => {
  const scope = path.relative(path.join(root, 'tests/case'), path.dirname(testFile))
  const results = []
  for (const caseId of caseIds) {
    const directory = path.join(root, 'tests/logs', scope, caseId)
    let runs
    try {
      runs = await readdir(directory)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      runs = []
    }
    let found
    for (const run of runs.sort().reverse()) {
      const logDir = path.join(directory, run)
      let meta
      try {
        meta = JSON.parse(await readFile(path.join(logDir, 'meta.json'), 'utf8'))
      } catch (error) {
        if (error.code === 'ENOENT') continue
        throw error
      }
      if (meta.caseId !== caseId || Date.parse(meta.startedAt) < startedAt) continue
      let app
      const stream = createReadStream(path.join(logDir, 'timeline.jsonl'), { encoding: 'utf8' })
      const lines = createInterface({ input: stream, crlfDelay: Infinity })
      try {
        for await (const line of lines) {
          const event = JSON.parse(line)
          if (event.name !== 'electron-app-verified' || event.status !== 'ok') continue
          const info = event.data
          app = {
            target: info.target,
            isPackaged: info.isPackaged,
            artifactSha256: info.artifactSha256
          }
          break
        }
      } finally {
        lines.close()
        stream.destroy()
      }
      found = {
        caseId,
        status: meta.status,
        runId: meta.runId,
        logDir: path.relative(root, logDir),
        app
      }
      break
    }
    results.push(found || { caseId, status: 'missing' })
  }
  return results
}

export const mergeE2ETestResults = (previous = [], current = []) => {
  const results = new Map(previous.map((test) => [`${test.targetId}/${test.file}`, test]))
  for (const test of current) {
    const key = `${test.targetId}/${test.file}`
    const old = results.get(key)
    const cases = new Map((old?.cases || []).map((item) => [item.caseId, item]))
    for (const item of test.cases || []) cases.set(item.caseId, item)
    const merged = { ...test, cases: [...cases.values()] }
    if (merged.cases.some((item) => item.status !== 'passed')) merged.status = 'failed'
    results.set(key, merged)
  }
  return [...results.values()]
}

export const passedPackageTest = (test, artifactSha256) =>
  test.status === 'passed' &&
  test.exitCode === 0 &&
  test.cases?.length > 0 &&
  test.cases.every(
    (item) =>
      item.status === 'passed' &&
      item.app?.target === 'package' &&
      item.app.isPackaged === true &&
      item.app.artifactSha256 === artifactSha256
  )

export const runE2EGates = async (tasks, runTask) => {
  for (const task of tasks) {
    const outcome = await runTask(task)
    if (outcome.code !== 0) return { task, code: outcome.code }
  }
  return null
}
