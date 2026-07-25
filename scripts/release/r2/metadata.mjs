import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { parseReleaseTag } from '../tag.mjs'

const [inputDirectory = '', outputDirectory = '', releaseTag = '', fragmentPath = ''] =
  process.argv.slice(2)

if (!inputDirectory || !outputDirectory || !releaseTag) {
  throw new Error(
    'usage: node scripts/release/r2/metadata.mjs <input-dir> <output-dir> <platform-v1.2.3> [fragment-json]'
  )
}
parseReleaseTag(releaseTag)

const familyForMetadata = (fileName) => (fileName === 'latest.yml' ? 'windows' : 'macos')

const storageNames = new Map()
if (fragmentPath) {
  const fragment = JSON.parse(await readFile(fragmentPath, 'utf8'))
  for (const file of fragment.files || []) storageNames.set(file.name, file.storageName)
}

const rewriteMetadata = (content, fileName) =>
  content.replace(
    /^(\s*(?:- url:|path:)\s+)([^\s/][^\s]*)$/gmu,
    (_line, prefix, assetName) => {
      const family = familyForMetadata(fileName)
      const storageName = storageNames.get(assetName) || assetName
      if (family === 'windows' && !storageNames.has(assetName)) {
        throw new Error(`Windows metadata contains an unmapped release asset: ${assetName}`)
      }
      return `${prefix}../../artifacts/${family}/${releaseTag}/${storageName}`
    }
  )

const pathExists = (filePath) =>
  access(filePath)
    .then(() => true)
    .catch(() => false)

await mkdir(outputDirectory, { recursive: true })
let preparedCount = 0
for (const fileName of ['latest.yml', 'latest-mac.yml']) {
  const inputPath = path.join(inputDirectory, fileName)
  if (!(await pathExists(inputPath))) continue
  parseReleaseTag(releaseTag, familyForMetadata(fileName) === 'macos' ? 'mac' : 'windows')
  if (fileName === 'latest.yml' && !fragmentPath) {
    throw new Error('Windows metadata requires a release fragment storage-name mapping')
  }
  const outputPath = path.join(outputDirectory, fileName)
  const content = await readFile(inputPath, 'utf8')
  const rewritten = rewriteMetadata(content, fileName)
  if (!rewritten.includes(`../../artifacts/${familyForMetadata(fileName)}/${releaseTag}/`)) {
    throw new Error(`${fileName} does not contain rewritten release asset URLs`)
  }
  await writeFile(outputPath, rewritten, 'utf8')
  preparedCount += 1
}

if (preparedCount === 0) throw new Error('no update metadata files were found')
