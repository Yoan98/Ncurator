/* eslint-disable @typescript-eslint/explicit-function-return-type */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(process.argv[2] || 'release-artifacts')
const outputPath = path.join(root, 'latest-mac.yml')

const walk = (directory) => {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(entryPath)
    return [entryPath]
  })
}

const parseScalar = (content, key) => {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  if (!match) return ''
  return match[1].trim().replace(/^'|'$/g, '')
}

const parseFileEntries = (content) => {
  const entries = []
  let current = null

  for (const line of content.split('\n')) {
    const urlMatch = line.match(/^\s{2}- url:\s*(.+)$/)
    if (urlMatch) {
      current = {
        url: urlMatch[1].trim(),
        sha512: '',
        size: 0
      }
      entries.push(current)
      continue
    }

    if (!current) continue

    const sha512Match = line.match(/^\s{4}sha512:\s*(.+)$/)
    if (sha512Match) {
      current.sha512 = sha512Match[1].trim()
      continue
    }

    const sizeMatch = line.match(/^\s{4}size:\s*(\d+)$/)
    if (sizeMatch) {
      current.size = Number(sizeMatch[1])
    }
  }

  return entries.filter((entry) => entry.url && entry.sha512 && entry.size > 0)
}

const yamlFiles = walk(root).filter((filePath) => path.basename(filePath) === 'latest-mac.yml')

if (yamlFiles.length === 0) {
  process.stderr.write(`No latest-mac.yml files found under ${root}\n`)
  process.exit(1)
}

const parsedFiles = yamlFiles.map((filePath) => {
  const content = fs.readFileSync(filePath, 'utf8')
  return {
    filePath,
    version: parseScalar(content, 'version'),
    releaseDate: parseScalar(content, 'releaseDate'),
    entries: parseFileEntries(content)
  }
})

const version = parsedFiles[0].version
if (!version || parsedFiles.some((item) => item.version !== version)) {
  process.stderr.write('latest-mac.yml files must have the same non-empty version\n')
  process.exit(1)
}

const entriesByUrl = new Map()
for (const item of parsedFiles) {
  for (const entry of item.entries) {
    entriesByUrl.set(entry.url, entry)
  }
}

const entries = [...entriesByUrl.values()].sort((left, right) => left.url.localeCompare(right.url))
const primaryEntry =
  entries.find((entry) => entry.url.endsWith('.zip') && entry.url.includes('arm64')) ||
  entries.find((entry) => entry.url.endsWith('.zip')) ||
  entries[0]

if (!primaryEntry) {
  process.stderr.write('No macOS release files found in latest-mac.yml files\n')
  process.exit(1)
}

for (const filePath of yamlFiles) {
  fs.unlinkSync(filePath)
}

const releaseDate =
  parsedFiles.find((item) => item.releaseDate)?.releaseDate || new Date().toISOString()
const lines = [
  `version: ${version}`,
  'files:',
  ...entries.flatMap((entry) => [
    `  - url: ${entry.url}`,
    `    sha512: ${entry.sha512}`,
    `    size: ${entry.size}`
  ]),
  `path: ${primaryEntry.url}`,
  `sha512: ${primaryEntry.sha512}`,
  `releaseDate: '${releaseDate}'`,
  ''
]

fs.writeFileSync(outputPath, lines.join('\n'), 'utf8')
