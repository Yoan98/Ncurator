import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const pnpmStore = path.join(ROOT, 'node_modules', '.pnpm')
const findVditor = () => {
  if (!fs.existsSync(pnpmStore)) return null
  const candidates = fs
    .readdirSync(pnpmStore)
    .filter((name) => name.startsWith('vditor@'))
    .map((name) => path.join(pnpmStore, name, 'node_modules', 'vditor'))
    .filter((candidate) => fs.existsSync(path.join(candidate, 'dist')))
  return candidates[0] || null
}

const V = findVditor()
if (!V) {
  throw new Error('vditor package not found; run pnpm install first')
}

const DST = path.join(ROOT, 'src', 'renderer', 'public', 'vditor', 'dist')

const copyFile = (source, target) => {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
}

const copyDir = (source, target) => {
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source)) {
    const sourcePath = path.join(source, entry)
    const targetPath = path.join(target, entry)
    if (fs.statSync(sourcePath).isDirectory()) copyDir(sourcePath, targetPath)
    else copyFile(sourcePath, targetPath)
  }
}

copyDir(path.join(V, 'dist', 'js', 'lute'), path.join(DST, 'js', 'lute'))
copyDir(path.join(V, 'dist', 'js', 'katex'), path.join(DST, 'js', 'katex'))
copyFile(path.join(V, 'dist', 'js', 'i18n', 'zh_CN.js'), path.join(DST, 'js', 'i18n', 'zh_CN.js'))
copyFile(path.join(V, 'dist', 'js', 'icons', 'ant.js'), path.join(DST, 'js', 'icons', 'ant.js'))
copyFile(
  path.join(V, 'dist', 'js', 'highlight.js', 'highlight.min.js'),
  path.join(DST, 'js', 'highlight.js', 'highlight.min.js')
)
copyFile(
  path.join(V, 'dist', 'js', 'highlight.js', 'third-languages.js'),
  path.join(DST, 'js', 'highlight.js', 'third-languages.js')
)
copyFile(
  path.join(V, 'dist', 'js', 'highlight.js', 'styles', 'a11y-light.min.css'),
  path.join(DST, 'js', 'highlight.js', 'styles', 'a11y-light.min.css')
)
copyDir(path.join(V, 'dist', 'css', 'content-theme'), path.join(DST, 'css', 'content-theme'))

for (const filePath of fs.readdirSync(path.join(DST, 'js', 'katex', 'fonts'))) {
  if (filePath.endsWith('.ttf')) {
    fs.rmSync(path.join(DST, 'js', 'katex', 'fonts', filePath))
  }
}

console.log(`[vditor-assets] copied from ${V} to ${DST}`)
