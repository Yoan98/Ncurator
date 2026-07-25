import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { assertPackageAudit, assertReleaseFragment } from './fragment-contract.mjs'
import { parseReleaseTag } from '../tag.mjs'

const [inputDirectory = '', outputPath = '', releaseTag = '', platform = ''] = process.argv.slice(2)

const definitions = {
  'windows-x64': {
    metadata: 'latest.yml',
    signature: undefined,
    assets: (version) => [
      [`馆长-${version}-Windows-x64.exe`, 'Ncurator-windows-x64.exe', 'installer'],
      [`馆长-${version}-Windows-x64.exe.blockmap`, 'Ncurator-windows-x64.exe.blockmap', 'update']
    ]
  },
  'macos-arm64': {
    metadata: 'latest-mac.yml',
    signature: 'mac-update-signature.txt',
    assets: () => [
      ['Ncurator-mac-arm64.dmg', 'Ncurator-mac-arm64.dmg', 'installer'],
      ['Ncurator-mac-arm64.dmg.blockmap', 'Ncurator-mac-arm64.dmg.blockmap', 'update'],
      ['Ncurator-mac-arm64.zip', 'Ncurator-mac-arm64.zip', 'update'],
      ['Ncurator-mac-arm64.zip.blockmap', 'Ncurator-mac-arm64.zip.blockmap', 'update']
    ]
  },
  'macos-x64': {
    metadata: 'latest-mac.yml',
    signature: 'mac-update-signature.txt',
    assets: () => [
      ['Ncurator-mac-x64.dmg', 'Ncurator-mac-x64.dmg', 'installer'],
      ['Ncurator-mac-x64.dmg.blockmap', 'Ncurator-mac-x64.dmg.blockmap', 'update'],
      ['Ncurator-mac-x64.zip', 'Ncurator-mac-x64.zip', 'update'],
      ['Ncurator-mac-x64.zip.blockmap', 'Ncurator-mac-x64.zip.blockmap', 'update']
    ]
  }
}

if (!inputDirectory || !outputPath || !releaseTag) {
  throw new Error(
    'usage: node scripts/release/r2/create-fragment.mjs <input-dir> <output-json> <platform-v1.2.3> <platform>'
  )
}

const definition = definitions[platform]
if (!definition) throw new Error(`unsupported release platform: ${platform}`)
const { version } = parseReleaseTag(releaseTag, platform)

const auditPath = path.join(inputDirectory, 'package-audit.json')
const audit = JSON.parse(await readFile(auditPath, 'utf8'))
assertPackageAudit(audit, platform, `package security audit ${auditPath}`)
if (platform.startsWith('macos-') && !['passed', 'warning'].includes(audit.sizeBudget?.status)) {
  throw new Error(`macOS package size budget is missing or failed: ${auditPath}`)
}

const sha512 = async (filePath) =>
  createHash('sha512')
    .update(await readFile(filePath))
    .digest('base64')

const files = []
for (const [name, storageName, role] of definition.assets(version)) {
  const filePath = path.join(inputDirectory, name)
  const fileStat = await stat(filePath)
  files.push({ name, storageName, role, size: fileStat.size, sha512: await sha512(filePath) })
}

const metadata = await readFile(path.join(inputDirectory, definition.metadata), 'utf8')
if (!new RegExp(`^version:\\s*${version.replaceAll('.', '\\.')}\\s*$`, 'mu').test(metadata)) {
  throw new Error(`${definition.metadata} does not declare version ${version}`)
}

const signature = definition.signature
  ? (await readFile(path.join(inputDirectory, definition.signature), 'utf8')).trim()
  : undefined

const fragment = {
  schemaVersion: 3,
  tag: releaseTag,
  version,
  platform,
  createdAt: new Date().toISOString(),
  files,
  metadata,
  audit: {
    schemaVersion: audit.schemaVersion,
    generatedAt: audit.generatedAt,
    platform: audit.platform,
    arch: audit.arch,
    applications: audit.applications.map((application) => ({
      root: application.root,
      totalBytes: application.totalBytes,
      archiveBytes: application.archiveBytes,
      archiveFileCount: application.archiveFileCount
    })),
    ...(audit.sizeBudget ? { sizeBudget: audit.sizeBudget } : {})
  },
  ...(signature ? { signature } : {})
}
assertReleaseFragment(fragment, { tag: releaseTag, platform })
await writeFile(outputPath, `${JSON.stringify(fragment, null, 2)}\n`, 'utf8')
