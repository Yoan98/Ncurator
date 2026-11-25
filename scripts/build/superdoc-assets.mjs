import { build } from 'vite'
import { copyFile, readdir, readFile, writeFile, unlink, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { brotliCompressSync, constants } from 'node:zlib'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const dist = path.dirname(require.resolve('superdoc'))
const outDir = path.resolve('src/renderer/public/superdoc')
const fingerprint = createHash('sha256')
  .update(await readFile(new URL(import.meta.url)))
  .update(await readFile('pnpm-lock.yaml'))
  .update(
    JSON.stringify(
      await stat(path.join(dist, 'superdoc.es.js')).then(({ size, mtimeMs }) => ({ size, mtimeMs }))
    )
  )
  .digest('hex')
const manifestPath = path.join(outDir, 'manifest.json')
try {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (
    manifest.fingerprint === fingerprint &&
    manifest.files.length > 0 &&
    (
      await Promise.all(
        manifest.files.map(
          async ({ name, size }) => (await stat(path.join(outDir, name))).size === size
        )
      )
    ).every(Boolean)
  ) {
    console.log('[superdoc-assets] using cached editor assets')
    process.exit(0)
  }
} catch {
  // Missing or incomplete generated assets are rebuilt from the locked dependency.
}
// Build the standalone editor separately so the desktop bundle never has to hold
// the Office layout engine and the rest of Workbench in the same Rollup graph.
await build({
  configFile: false,
  publicDir: false,
  base: './',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir,
    emptyOutDir: true,
    target: 'chrome138',
    reportCompressedSize: false,
    rollupOptions: {
      input: path.join(dist, 'superdoc.es.js'),
      preserveEntrySignatures: 'strict',
      output: { entryFileNames: 'editor.js' }
    }
  }
})
await copyFile(path.join(dist, '..', 'LICENSE'), path.join(outDir, 'LICENSE'))

await copyFile(path.join(dist, '..', 'NOTICE'), path.join(outDir, 'NOTICE'))

// Electron ASAR stores each entry uncompressed. Keep the layout engine compressed
// on disk and inflate only the local modules Chromium actually requests.
for (const name of await readdir(outDir, { recursive: true })) {
  if (!name.endsWith('.js')) continue
  const file = path.join(outDir, name)
  await writeFile(
    file + '.br',
    brotliCompressSync(await readFile(file), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })
  )
  await unlink(file)
}
const files = await Promise.all(
  (await readdir(outDir, { recursive: true })).map(async (name) => {
    const info = await stat(path.join(outDir, name))
    return info.isFile() ? { name, size: info.size } : null
  })
)
await writeFile(manifestPath, JSON.stringify({ fingerprint, files: files.filter(Boolean) }))
