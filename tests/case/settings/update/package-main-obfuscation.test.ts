import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_MAIN_OBFUSCATION_GROWTH_BYTES,
  PROTECTED_MAIN_PLAINTEXT_MARKERS,
  obfuscateMainJavaScript,
  obfuscatePackageMain,
  verifyPackageMainObfuscation
} from '../../../../scripts/package-main-obfuscation.mjs'

let temporaryDirectory = ''

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
  temporaryDirectory = ''
})

const fixtureSource = `
'use strict'
const path = require('node:path')
const buildPrompt = (input) => [
  '<system>',
  '像一个判断稳定的人类执行者一样工作',
  '你的职责是基于已经提供的信息，面向用户交付最终结果',
  JSON.stringify({ input, schema: { type: 'object', required: ['answer'] } }, null, 2),
  '</system>',
  path.sep
].join('\\n')
globalThis.__ncuratorPromptResult = buildPrompt('中文、emoji 🚀、换行\\n保持一致')
`

const executeFixture = (source: string): string => {
  const requiredSpecifiers: string[] = []
  const context: Record<string, unknown> = {
    require: (specifier: string) => {
      requiredSpecifiers.push(specifier)
      return { sep: '/' }
    }
  }
  vm.runInNewContext(source, context, { timeout: 10_000 })
  return JSON.stringify({
    prompt: String(context.__ncuratorPromptResult || ''),
    requiredSpecifiers
  })
}

describe('package-main-obfuscation main-process release protection', () => {
  it('preserves the exact runtime prompt while hiding protected plaintext', () => {
    const originalPrompt = executeFixture(fixtureSource)
    const obfuscated = obfuscateMainJavaScript(fixtureSource, 'out/main/index.js')
    const repeated = obfuscateMainJavaScript(fixtureSource, 'out/main/index.js')
    const otherFile = obfuscateMainJavaScript(fixtureSource, 'out/main/worker.js')
    const obfuscatedPrompt = executeFixture(obfuscated)

    expect(obfuscatedPrompt).toBe(originalPrompt)
    expect(obfuscated).not.toBe(fixtureSource)
    expect(repeated).toBe(obfuscated)
    expect(otherFile).not.toBe(obfuscated)
    for (const marker of PROTECTED_MAIN_PLAINTEXT_MARKERS) {
      expect(fixtureSource).toContain(marker.value)
      expect(obfuscated).not.toContain(marker.value)
    }
  })

  it('writes and verifies a report tied to every staged main-process file', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-main-obfuscation-'))
    const stageDirectory = path.join(temporaryDirectory, 'app')
    const mainDirectory = path.join(stageDirectory, 'out', 'main')
    const reportPath = path.join(temporaryDirectory, 'main-obfuscation-report.json')
    await mkdir(mainDirectory, { recursive: true })
    await writeFile(
      path.join(stageDirectory, 'package.json'),
      `${JSON.stringify({ name: 'fixture', version: '1.2.3' })}\n`,
      'utf8'
    )
    await writeFile(path.join(mainDirectory, 'index.js'), fixtureSource, 'utf8')
    await writeFile(
      path.join(mainDirectory, 'worker.js'),
      `'use strict'; globalThis.__workerReady = true\n`,
      'utf8'
    )

    const report = obfuscatePackageMain({ stageDirectory, reportPath })
    const verified = verifyPackageMainObfuscation({ stageDirectory, reportPath })
    const stagedSource = await readFile(path.join(mainDirectory, 'index.js'), 'utf8')

    expect(report.status).toBe('passed')
    expect(verified.packageVersion).toBe('1.2.3')
    expect(verified.files.map((item: { path: string }) => item.path)).toEqual([
      'out/main/index.js',
      'out/main/worker.js'
    ])
    expect(verified.totals.growthBytes).toBeLessThanOrEqual(MAX_MAIN_OBFUSCATION_GROWTH_BYTES)
    for (const marker of PROTECTED_MAIN_PLAINTEXT_MARKERS) {
      expect(stagedSource).not.toContain(marker.value)
    }

    await writeFile(path.join(mainDirectory, 'index.js'), `${stagedSource}\n// tampered\n`, 'utf8')
    expect(() => verifyPackageMainObfuscation({ stageDirectory, reportPath })).toThrow(
      'hash mismatch'
    )
  })

  it('runs only after dependency collection and keeps packaged-app protection auditing', async () => {
    const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'))
    const buildScript = String(packageJson.scripts.build || '')
    const prepareIndex = buildScript.indexOf('prepare-package-stage.mjs')
    const obfuscateIndex = buildScript.indexOf('obfuscate-package-main.mjs')
    const verifyIndex = buildScript.indexOf('verify-package-main-obfuscation.mjs')
    const auditIndex = buildScript.lastIndexOf('audit-package-stage.mjs')
    const packagedAudit = await readFile(path.resolve('scripts/audit-packaged-app.mjs'), 'utf8')

    expect(prepareIndex).toBeGreaterThanOrEqual(0)
    expect(obfuscateIndex).toBeGreaterThan(prepareIndex)
    expect(verifyIndex).toBeGreaterThan(obfuscateIndex)
    expect(auditIndex).toBeGreaterThan(verifyIndex)
    expect(packagedAudit).toContain('assertProtectedMainPlaintextAbsent')
  })
})
