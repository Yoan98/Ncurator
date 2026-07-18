import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const [inputDirectory = '', outputDirectory = '', releaseTag = ''] = process.argv.slice(2)

if (!inputDirectory || !outputDirectory || !/^v\d+\.\d+\.\d+$/u.test(releaseTag)) {
  throw new Error(
    'usage: node scripts/prepare-r2-update-metadata.mjs <input-dir> <output-dir> <v1.2.3>'
  )
}

const rewriteMetadata = (content) =>
  content.replace(
    /^(\s*(?:- url:|path:)\s+)([^\s/][^\s]*)$/gmu,
    (_line, prefix, assetName) => `${prefix}../../artifacts/${releaseTag}/${assetName}`
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
  const outputPath = path.join(outputDirectory, fileName)
  const content = await readFile(inputPath, 'utf8')
  const rewritten = rewriteMetadata(content)
  if (!rewritten.includes(`../../artifacts/${releaseTag}/`)) {
    throw new Error(`${fileName} does not contain rewritten release asset URLs`)
  }
  await writeFile(outputPath, rewritten, 'utf8')
  preparedCount += 1
}

if (preparedCount === 0) throw new Error('no update metadata files were found')
