import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { transformWithEsbuild } from 'vite'

export const mediaBrowserAssets = () => ({
  name: 'media-browser-assets',
  async generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'scene-sans.otf',
      source: await readFile(path.resolve('resources/media/fonts/SceneSans.otf'))
    })
    this.emitFile({
      type: 'asset',
      fileName: 'media-font-OFL.txt',
      source: await readFile(path.resolve('resources/media/fonts/OFL.txt'))
    })
    for (const [source, output] of [
      ['engine/browserSdk.ts', 'drawing-sdk.mjs'],
      ['video/browserScene.ts', 'video-scene.mjs']
    ]) {
      const file = path.resolve('src/main/services/media', source)
      const compiled = await transformWithEsbuild(await readFile(file, 'utf8'), file, {
        loader: 'ts',
        format: 'esm',
        target: 'es2022'
      })
      this.emitFile({
        type: 'asset',
        fileName: output,
        source: compiled.code.replace('../engine/browserSdk', '@ncurator/drawing')
      })
    }
  }
})
