import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { build } = require(
  require.resolve('esbuild', {
    paths: [path.dirname(require.resolve('vite/package.json'))]
  })
)

// esbuild's graph follows runtime imports and erases type-only imports. Changes to
// unrelated application modules therefore do not invalidate computation results.
export const fingerprintKnowledgePipeline = async (root, entryPoints) => {
  const graph = await build({
    absWorkingDir: root,
    entryPoints,
    bundle: true,
    platform: 'node',
    packages: 'external',
    write: false,
    metafile: true,
    outdir: 'knowledge-identity',
    logLevel: 'silent'
  })
  const records = new Map()
  const seenPackages = new Set()
  const visitPackage = async (specifier, importer) => {
    if (specifier.startsWith('node:') || specifier === 'electron') return
    const resolver = createRequire(importer)
    let resolved
    try {
      resolved = resolver.resolve(specifier)
    } catch {
      return
    }
    if (!path.isAbsolute(resolved)) return
    let directory = path.dirname(await realpath(resolved))
    let manifest
    while (directory !== path.dirname(directory)) {
      try {
        manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
        break
      } catch {
        directory = path.dirname(directory)
      }
    }
    if (!manifest || seenPackages.has(directory)) return
    seenPackages.add(directory)
    const installedReference =
      directory.split(`${path.sep}.pnpm${path.sep}`)[1]?.split(path.sep)[0] ||
      `${manifest.name}@${manifest.version}`
    records.set(`package:${installedReference}`, JSON.stringify(manifest))
    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies
    }).sort()) {
      await visitPackage(dependency, path.join(directory, 'package.json'))
    }
  }
  for (const [file, metadata] of Object.entries(graph.metafile.inputs).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const absolutePath = path.resolve(root, file)
    records.set(file, await readFile(absolutePath))
    for (const dependency of metadata.imports.filter((item) => item.external)) {
      await visitPackage(dependency.path, absolutePath)
    }
  }
  const hash = createHash('sha256')
  for (const [name, content] of [...records].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(name).update('\0').update(content).update('\0')
  }
  hash.update(`${process.platform}/${process.arch}`)
  return hash.digest('hex')
}

export const createKnowledgeCacheIdentity = async (root = process.cwd()) => ({
  split: await fingerprintKnowledgePipeline(root, [
    'src/main/services/workspace/worker/workspacePrepareWorker.ts',
    'src/main/services/pdf/worker/pdfWorker.ts'
  ]),
  embedding: await fingerprintKnowledgePipeline(root, [
    'src/main/services/vector/runtime/TransformersEmbeddingExecutor.ts',
    'src/main/services/vector/EmbeddingService.ts'
  ])
})
