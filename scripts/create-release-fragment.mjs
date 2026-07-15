/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const [inputDirectory = '', outputPath = '', releaseTag = '', platform = ''] = process.argv.slice(2)

const definitions = {
  'windows-x64': {
    metadata: 'latest.yml',
    signature: undefined,
    assets: [
      ['Ncurator-windows-x64.exe', 'installer'],
      ['Ncurator-windows-x64.exe.blockmap', 'update']
    ]
  },
  'macos-arm64': {
    metadata: 'latest-mac.yml',
    signature: 'mac-update-signature.txt',
    assets: [
      ['Ncurator-mac-arm64.dmg', 'installer'],
      ['Ncurator-mac-arm64.dmg.blockmap', 'update'],
      ['Ncurator-mac-arm64.zip', 'update'],
      ['Ncurator-mac-arm64.zip.blockmap', 'update']
    ]
  },
  'macos-x64': {
    metadata: 'latest-mac.yml',
    signature: 'mac-update-signature.txt',
    assets: [
      ['Ncurator-mac-x64.dmg', 'installer'],
      ['Ncurator-mac-x64.dmg.blockmap', 'update'],
      ['Ncurator-mac-x64.zip', 'update'],
      ['Ncurator-mac-x64.zip.blockmap', 'update']
    ]
  }
}

if (!inputDirectory || !outputPath || !/^v\d+\.\d+\.\d+$/u.test(releaseTag)) {
  throw new Error(
    'usage: node scripts/create-release-fragment.mjs <input-dir> <output-json> <v1.2.3> <platform>'
  )
}

const definition = definitions[platform]
if (!definition) throw new Error(`unsupported release platform: ${platform}`)

const expectedAuditPlatform = platform.startsWith('macos-') ? 'darwin' : 'win32'
const expectedAuditArch = platform.endsWith('-arm64') ? 'arm64' : 'x64'
const auditPath = path.join(inputDirectory, 'package-audit.json')
const audit = JSON.parse(await readFile(auditPath, 'utf8'))
if (
  audit.schemaVersion !== 1 ||
  audit.platform !== expectedAuditPlatform ||
  audit.arch !== expectedAuditArch ||
  !Array.isArray(audit.applications) ||
  audit.applications.length === 0
) {
  throw new Error(`package security audit does not match ${platform}: ${auditPath}`)
}

const version = releaseTag.slice(1)
const sha512 = async (filePath) =>
  createHash('sha512')
    .update(await readFile(filePath))
    .digest('base64')

const files = []
for (const [name, role] of definition.assets) {
  const filePath = path.join(inputDirectory, name)
  const fileStat = await stat(filePath)
  files.push({ name, role, size: fileStat.size, sha512: await sha512(filePath) })
}

const metadata = await readFile(path.join(inputDirectory, definition.metadata), 'utf8')
if (!new RegExp(`^version:\\s*${version.replaceAll('.', '\\.')}\\s*$`, 'mu').test(metadata)) {
  throw new Error(`${definition.metadata} does not declare version ${version}`)
}

const signature = definition.signature
  ? (await readFile(path.join(inputDirectory, definition.signature), 'utf8')).trim()
  : undefined

await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      tag: releaseTag,
      version,
      platform,
      createdAt: new Date().toISOString(),
      files,
      metadata,
      audit: {
        generatedAt: audit.generatedAt,
        platform: audit.platform,
        arch: audit.arch,
        applications: audit.applications.map((application) => ({
          root: application.root,
          totalBytes: application.totalBytes,
          archiveBytes: application.archiveBytes,
          archiveFileCount: application.archiveFileCount
        }))
      },
      ...(signature ? { signature } : {})
    },
    null,
    2
  )}\n`,
  'utf8'
)
