import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  packageNamesFromTracePath,
  traceRuntimeDependencies
} from '../../../../scripts/build/runtime/trace.mjs'

let temporaryDirectory = ''

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
  temporaryDirectory = ''
})

const writePackage = async (
  root: string,
  name: string,
  manifest: Record<string, unknown>,
  source: string
) => {
  const directory = path.join(root, 'node_modules', ...name.split('/'))
  await mkdir(directory, { recursive: true })
  await writeFile(
    path.join(directory, 'package.json'),
    `${JSON.stringify({ name, version: '1.0.0', main: 'index.js', ...manifest })}\n`
  )
  await writeFile(path.join(directory, 'index.js'), source)
}

describe('recursive packaged runtime trace', () => {
  it('maps pnpm paths back to logical package names', () => {
    expect(
      packageNamesFromTracePath(
        'node_modules/.pnpm/@scope+parent@1.0.0/node_modules/@scope/parent/index.js'
      )
    ).toEqual(['@scope/parent'])
  })

  it('includes a literal dynamic optional peer and validates its version', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-runtime-trace-'))
    const entryPath = path.join(temporaryDirectory, 'out', 'main', 'index.js')
    const policyPath = path.join(temporaryDirectory, 'runtime-trace-policy.json')
    await mkdir(path.dirname(entryPath), { recursive: true })
    await writeFile(
      path.join(temporaryDirectory, 'package.json'),
      `${JSON.stringify({
        name: 'trace-fixture',
        version: '1.0.0',
        dependencies: { 'fixture-parent': '1.0.0', 'fixture-optional': '1.0.0' }
      })}\n`
    )
    await writeFile(entryPath, `require('fixture-parent')\n`)
    await writePackage(
      temporaryDirectory,
      'fixture-parent',
      {
        peerDependencies: { 'fixture-optional': '^1.0.0' },
        peerDependenciesMeta: { 'fixture-optional': { optional: true } }
      },
      `module.exports = () => import('fixture-optional')\n`
    )
    await writePackage(temporaryDirectory, 'fixture-optional', {}, `module.exports = 'ready'\n`)
    await writeFile(
      policyPath,
      `${JSON.stringify({
        schemaVersion: 1,
        traceIgnore: [],
        explicitIncludes: [],
        warningRules: [
          {
            id: 'fixture-unused-warning-rule',
            kind: 'parse',
            package: 'fixture-parent',
            reason: 'Only present to exercise policy validation.'
          }
        ],
        requiredFiles: [
          { id: 'fixture-optional-entry', package: 'fixture-optional', path: 'index.js' }
        ]
      })}\n`
    )

    const report = await traceRuntimeDependencies({
      rootDirectory: temporaryDirectory,
      entryPaths: [entryPath],
      directPackageNames: ['fixture-parent'],
      policyPath
    })

    expect(report.packages.map((dependency: { name: string }) => dependency.name)).toEqual([
      'fixture-optional',
      'fixture-parent'
    ])
    expect(report.optionalPeerChecks).toEqual([
      {
        consumer: 'fixture-parent',
        peer: 'fixture-optional',
        range: '^1.0.0',
        installed: '1.0.0'
      }
    ])
  })
})
