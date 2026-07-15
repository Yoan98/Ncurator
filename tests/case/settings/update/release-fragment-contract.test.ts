import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
let temporaryDirectory = ''

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
})

describe('release fragment', () => {
  it('records immutable Windows assets and update metadata', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-release-fragment-'))
    const input = path.join(temporaryDirectory, 'input')
    const output = path.join(temporaryDirectory, 'windows.json')
    await mkdir(input, { recursive: true })
    const installer = Buffer.from('windows-installer')
    const blockmap = Buffer.from('windows-blockmap')
    await writeFile(path.join(input, 'Ncurator-windows-x64.exe'), installer)
    await writeFile(path.join(input, 'Ncurator-windows-x64.exe.blockmap'), blockmap)
    await writeFile(
      path.join(input, 'latest.yml'),
      'version: 0.1.3\npath: Ncurator-windows-x64.exe\n',
      'utf8'
    )
    await writeFile(
      path.join(input, 'package-audit.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        generatedAt: '2026-07-15T00:00:00.000Z',
        platform: 'win32',
        arch: 'x64',
        applications: [
          {
            root: 'win-unpacked',
            totalBytes: 1_000,
            archiveBytes: 500,
            archiveFileCount: 20
          }
        ]
      })}\n`,
      'utf8'
    )

    await execFileAsync(process.execPath, [
      path.resolve('scripts/create-release-fragment.mjs'),
      input,
      output,
      'v0.1.3',
      'windows-x64'
    ])

    const fragment = JSON.parse(await readFile(output, 'utf8'))
    expect(fragment.tag).toBe('v0.1.3')
    expect(fragment.platform).toBe('windows-x64')
    expect(fragment.metadata).toContain('version: 0.1.3')
    expect(fragment.audit).toEqual({
      generatedAt: '2026-07-15T00:00:00.000Z',
      platform: 'win32',
      arch: 'x64',
      applications: [
        {
          root: 'win-unpacked',
          totalBytes: 1_000,
          archiveBytes: 500,
          archiveFileCount: 20
        }
      ]
    })
    expect(fragment.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Ncurator-windows-x64.exe',
          role: 'installer',
          size: installer.length,
          sha512: createHash('sha512').update(installer).digest('base64')
        })
      ])
    )
  })

  it('rejects release assets without a package security audit', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-release-fragment-'))
    const input = path.join(temporaryDirectory, 'input')
    const output = path.join(temporaryDirectory, 'windows.json')
    await mkdir(input, { recursive: true })

    await expect(
      execFileAsync(process.execPath, [
        path.resolve('scripts/create-release-fragment.mjs'),
        input,
        output,
        'v0.1.3',
        'windows-x64'
      ])
    ).rejects.toThrow(/package-audit\.json/u)
  })
})
