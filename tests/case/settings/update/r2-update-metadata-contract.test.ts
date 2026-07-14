import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
let temporaryDirectory = ''

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
})

describe('R2 update metadata', () => {
  it('points latest metadata to immutable versioned assets', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-update-metadata-'))
    const inputDirectory = path.join(temporaryDirectory, 'input')
    const outputDirectory = path.join(temporaryDirectory, 'output')
    await import('node:fs/promises').then(({ mkdir }) => mkdir(inputDirectory, { recursive: true }))
    await writeFile(
      path.join(inputDirectory, 'latest.yml'),
      'version: 0.1.1\nfiles:\n  - url: Ncurator-windows-x64.exe\npath: Ncurator-windows-x64.exe\n',
      'utf8'
    )
    await writeFile(
      path.join(inputDirectory, 'latest-mac.yml'),
      'version: 0.1.1\nfiles:\n  - url: Ncurator-mac-arm64.zip\npath: Ncurator-mac-arm64.zip\n',
      'utf8'
    )

    await execFileAsync(
      process.execPath,
      [
        path.resolve('scripts/prepare-r2-update-metadata.mjs'),
        inputDirectory,
        outputDirectory,
        'v0.1.1'
      ],
      { cwd: process.cwd() }
    )

    const windowsMetadata = await readFile(path.join(outputDirectory, 'latest.yml'), 'utf8')
    const macMetadata = await readFile(path.join(outputDirectory, 'latest-mac.yml'), 'utf8')
    expect(windowsMetadata).toContain('../../artifacts/v0.1.1/Ncurator-windows-x64.exe')
    expect(macMetadata).toContain('../../artifacts/v0.1.1/Ncurator-mac-arm64.zip')
  })
})
