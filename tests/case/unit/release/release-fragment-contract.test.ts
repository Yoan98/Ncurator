import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertPackageAudit,
  assertReleaseFragment
} from '../../../../scripts/release/r2/fragment-contract.mjs'
import {
  compareReleaseVersions,
  createReleaseTag,
  parseReleaseTag
} from '../../../../scripts/release/tag.mjs'

const execFileAsync = promisify(execFile)
let temporaryDirectory = ''

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
})

describe('release fragment', () => {
  it('manages macOS and Windows tag versions independently', () => {
    expect(createReleaseTag('mac', '0.1.30')).toBe('mac-v0.1.30')
    expect(createReleaseTag('windows', '0.1.32')).toBe('windows-v0.1.32')
    expect(parseReleaseTag('mac-v0.1.30', 'macos-arm64').version).toBe('0.1.30')
    expect(() => parseReleaseTag('mac-v0.1.30', 'macos-x64')).toThrow(/unsupported/u)
    expect(() => parseReleaseTag('windows-v0.1.32', 'macos-arm64')).toThrow(/does not match/u)
    expect(compareReleaseVersions('0.1.30', '0.1.29')).toBeGreaterThan(0)
    expect(compareReleaseVersions('0.1.30', '0.1.31')).toBeLessThan(0)
  })

  it('records immutable Windows assets and update metadata', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-release-fragment-'))
    const input = path.join(temporaryDirectory, 'input')
    const output = path.join(temporaryDirectory, 'windows.json')
    await mkdir(input, { recursive: true })
    const installer = Buffer.from('windows-installer')
    const blockmap = Buffer.from('windows-blockmap')
    await writeFile(path.join(input, '馆长-0.1.3-Windows-x64.exe'), installer)
    await writeFile(path.join(input, '馆长-0.1.3-Windows-x64.exe.blockmap'), blockmap)
    await writeFile(
      path.join(input, 'latest.yml'),
      'version: 0.1.3\npath: 馆长-0.1.3-Windows-x64.exe\n',
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
      path.resolve('scripts/release/r2/create-fragment.mjs'),
      input,
      output,
      'windows-v0.1.3',
      'windows-x64'
    ])

    const fragment = JSON.parse(await readFile(output, 'utf8'))
    expect(fragment.schemaVersion).toBe(3)
    expect(fragment.tag).toBe('windows-v0.1.3')
    expect(fragment.platform).toBe('windows-x64')
    expect(fragment.metadata).toContain('version: 0.1.3')
    expect(fragment.audit).toEqual({
      distribution: 'domestic',
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
    })
    expect(fragment.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: '馆长-0.1.3-Windows-x64.exe',
          storageName: 'Ncurator-windows-x64.exe',
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
        path.resolve('scripts/release/r2/create-fragment.mjs'),
        input,
        output,
        'windows-v0.1.3',
        'windows-x64'
      ])
    ).rejects.toThrow(/package-audit\.json/u)
  })

  it('rejects old, mismatched, unsafe, or forged release fragments', () => {
    const validFragment = {
      schemaVersion: 3,
      tag: 'windows-v0.1.3',
      version: '0.1.3',
      platform: 'windows-x64',
      createdAt: '2026-07-15T00:00:00.000Z',
      files: [
        {
          name: '馆长-0.1.3-Windows-x64.exe',
          storageName: 'Ncurator-windows-x64.exe',
          role: 'installer',
          size: 100,
          sha512: createHash('sha512').update('installer').digest('base64')
        },
        {
          name: '馆长-0.1.3-Windows-x64.exe.blockmap',
          storageName: 'Ncurator-windows-x64.exe.blockmap',
          role: 'update',
          size: 50,
          sha512: createHash('sha512').update('blockmap').digest('base64')
        }
      ],
      metadata: 'version: 0.1.3\npath: 馆长-0.1.3-Windows-x64.exe\n',
      audit: {
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
      }
    }

    expect(() => assertReleaseFragment(validFragment)).not.toThrow()
    expect(() =>
      assertReleaseFragment({
        ...validFragment,
        audit: { ...validFragment.audit, distribution: 'international' }
      })
    ).toThrow(/distribution does not match audit/u)
    expect(() => assertReleaseFragment({ ...validFragment, tag: 'mac-v0.1.3' })).toThrow(
      /tag must match its platform/u
    )
    expect(() => assertReleaseFragment({ ...validFragment, schemaVersion: 2 })).toThrow(
      /schemaVersion must be 3/u
    )
    expect(() =>
      assertReleaseFragment({
        ...validFragment,
        audit: { ...validFragment.audit, arch: 'arm64' }
      })
    ).toThrow(/expected win32-x64/u)
    expect(() =>
      assertReleaseFragment({
        ...validFragment,
        files: [{ ...validFragment.files[0], name: '../Ncurator.exe' }, validFragment.files[1]]
      })
    ).toThrow(/plain filename/u)
    expect(() =>
      assertReleaseFragment({
        ...validFragment,
        files: [{ ...validFragment.files[0], name: '..\\Ncurator.exe' }, validFragment.files[1]]
      })
    ).toThrow(/plain filename/u)
    expect(() =>
      assertReleaseFragment({
        ...validFragment,
        files: [{ ...validFragment.files[0], storageName: '馆长.exe' }, validFragment.files[1]]
      })
    ).toThrow(/storageName must be an ASCII filename/u)
    expect(() =>
      assertReleaseFragment({
        ...validFragment,
        files: [{ ...validFragment.files[0], sha512: 'not-a-sha512' }, validFragment.files[1]]
      })
    ).toThrow(/invalid sha512/u)
    expect(() =>
      assertReleaseFragment({
        ...validFragment,
        audit: {
          ...validFragment.audit,
          sizeBudget: {
            status: 'failed',
            platform: 'win32-x64',
            metrics: []
          }
        }
      })
    ).toThrow(/package size budget did not pass/u)
  })

  it('requires macOS installer display name to use 馆长 while storage stays ASCII', () => {
    const sha512 = createHash('sha512').update('mac-installer').digest('base64')
    const macFragment = {
      schemaVersion: 3,
      tag: 'mac-v0.1.3',
      platform: 'macos-arm64',
      version: '0.1.3',
      createdAt: '2026-07-17T00:00:00.000Z',
      files: [
        {
          name: '馆长-0.1.3-macos-arm64.dmg',
          storageName: 'Ncurator-mac-arm64.dmg',
          role: 'installer',
          size: 10,
          sha512
        },
        {
          name: 'Ncurator-mac-arm64.dmg.blockmap',
          storageName: 'Ncurator-mac-arm64.dmg.blockmap',
          role: 'update',
          size: 10,
          sha512
        },
        {
          name: 'Ncurator-mac-arm64.zip',
          storageName: 'Ncurator-mac-arm64.zip',
          role: 'update',
          size: 10,
          sha512
        },
        {
          name: 'Ncurator-mac-arm64.zip.blockmap',
          storageName: 'Ncurator-mac-arm64.zip.blockmap',
          role: 'update',
          size: 10,
          sha512
        }
      ],
      metadata: 'version: 0.1.3\npath: Ncurator-mac-arm64.zip\n',
      signature: 'mac-update-signature',
      audit: {
        schemaVersion: 1,
        generatedAt: '2026-07-17T00:00:00.000Z',
        platform: 'darwin',
        arch: 'arm64',
        applications: [
          {
            root: 'mac-arm64/Ncurator.app',
            totalBytes: 1_000,
            archiveBytes: 500,
            archiveFileCount: 20
          }
        ],
        sizeBudget: {
          status: 'passed',
          platform: 'darwin-arm64',
          metrics: [
            {
              name: 'installedApp',
              status: 'passed',
              actualBytes: 10,
              baselineBytes: 10,
              hardLimitBytes: 20,
              growthPercent: 0
            },
            {
              name: 'appAsar',
              status: 'passed',
              actualBytes: 10,
              baselineBytes: 10,
              hardLimitBytes: 20,
              growthPercent: 0
            },
            {
              name: 'dmg',
              status: 'passed',
              actualBytes: 10,
              baselineBytes: 10,
              hardLimitBytes: 20,
              growthPercent: 0
            },
            {
              name: 'zip',
              status: 'passed',
              actualBytes: 10,
              baselineBytes: 10,
              hardLimitBytes: 20,
              growthPercent: 0
            }
          ]
        }
      }
    }
    expect(() => assertReleaseFragment(macFragment)).not.toThrow()
    expect(() =>
      assertReleaseFragment({
        ...macFragment,
        files: macFragment.files.map((file, index) =>
          index === 0 ? { ...file, name: 'Ncurator-0.1.3-macos-arm64.dmg' } : file
        )
      })
    ).toThrow(/macOS asset names do not match/u)
  })

  it('requires all four macOS size metrics before publishing', () => {
    expect(() =>
      assertPackageAudit(
        {
          schemaVersion: 1,
          generatedAt: '2026-07-17T00:00:00.000Z',
          platform: 'darwin',
          arch: 'arm64',
          applications: [
            {
              root: 'mac-arm64/Ncurator.app',
              totalBytes: 1_000,
              archiveBytes: 500,
              archiveFileCount: 20
            }
          ],
          sizeBudget: {
            status: 'passed',
            platform: 'darwin-arm64',
            metrics: []
          }
        },
        'macos-arm64'
      )
    ).toThrow(/missing size budget metric installedApp/u)
  })
})
