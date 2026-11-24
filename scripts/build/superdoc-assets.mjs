import { build } from 'vite'
import { copyFile, readdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { brotliCompressSync, constants } from 'node:zlib'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const dist = path.dirname(require.resolve('superdoc'))
const outDir = path.resolve('src/renderer/public/superdoc')
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
    brotliCompressSync(await readFile(file), { params: { [constants.BROTLI_PARAM_QUALITY]: 7 } })
  )
  await unlink(file)
}
