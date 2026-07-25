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
      'version: 0.1.1\nfiles:\n  - url: 馆长-0.1.1-Windows-x64.exe\npath: 馆长-0.1.1-Windows-x64.exe\n',
      'utf8'
    )
    const fragmentPath = path.join(temporaryDirectory, 'windows-x64.json')
    await writeFile(
      fragmentPath,
      JSON.stringify({
        files: [
          {
            name: '馆长-0.1.1-Windows-x64.exe',
            storageName: 'Ncurator-windows-x64.exe'
          }
        ]
      }),
      'utf8'
    )
    await execFileAsync(
      process.execPath,
      [
        path.resolve('scripts/release/r2/metadata.mjs'),
        inputDirectory,
        outputDirectory,
        'windows-v0.1.1',
        fragmentPath
      ],
      { cwd: process.cwd() }
    )

    const windowsMetadata = await readFile(path.join(outputDirectory, 'latest.yml'), 'utf8')
    expect(windowsMetadata).toContain(
      '../../artifacts/windows/windows-v0.1.1/Ncurator-windows-x64.exe'
    )
  })

  it('can prepare only macOS metadata for a platform-only release', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-update-metadata-'))
    const inputDirectory = path.join(temporaryDirectory, 'input')
    const outputDirectory = path.join(temporaryDirectory, 'output')
    await import('node:fs/promises').then(({ mkdir }) => mkdir(inputDirectory, { recursive: true }))
    await writeFile(
      path.join(inputDirectory, 'latest-mac.yml'),
      'version: 0.1.4\nfiles:\n  - url: Ncurator-mac-arm64.zip\npath: Ncurator-mac-arm64.zip\n',
      'utf8'
    )

    await execFileAsync(process.execPath, [
      path.resolve('scripts/release/r2/metadata.mjs'),
      inputDirectory,
      outputDirectory,
      'mac-v0.1.4'
    ])

    const macMetadata = await readFile(path.join(outputDirectory, 'latest-mac.yml'), 'utf8')
    expect(macMetadata).toContain('../../artifacts/macos/mac-v0.1.4/Ncurator-mac-arm64.zip')
    await expect(readFile(path.join(outputDirectory, 'latest.yml'), 'utf8')).rejects.toThrow()
  })
})
