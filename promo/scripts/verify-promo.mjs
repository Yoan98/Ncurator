import { execFile } from 'node:child_process'
import { access, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { cliArgs, listEpisodes, promoRoot, resolveEpisode } from './lib.mjs'
import { listFiles, probeVideo, renderSourceNames, sha256File, sha256Text } from './manifest.mjs'

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(promoRoot, '..')
const lfsExtensions = new Set(['.wav', '.mp4', '.webm', '.mov', '.otf', '.ttf'])
const textExtensions = new Set(['.html', '.json', '.md', '.mjs', '.js', '.txt'])
const forbiddenNames =
  /(^|\/)(app\.sqlite|Preferences|Local Storage|Session Storage|leveldb|GPUCache|Code Cache)(\/|$)/iu

const relativePosix = (from, value) => path.relative(from, value).split(path.sep).join('/')

const requireFile = async (filePath, description) => {
  await access(filePath).catch(() => {
    throw new Error(`${description}缺失：${filePath}`)
  })
}

const verifyLfsAttribute = async (filePath) => {
  if (!lfsExtensions.has(path.extname(filePath).toLowerCase())) return
  const { stdout } = await execFileAsync('git', ['check-attr', 'filter', '--', filePath], {
    cwd: repoRoot
  })
  if (!stdout.trim().endsWith(': lfs')) {
    throw new Error(`大文件没有交给 Git LFS：${filePath}`)
  }
}

export const verifyEpisode = async (episodeDir, { checkFinal = true } = {}) => {
  const name = path.basename(episodeDir)
  const manifestPath = path.join(episodeDir, 'episode.json')
  await requireFile(manifestPath, '素材清单')
  const manifestText = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(manifestText)
  if (
    manifest.schemaVersion !== 1 ||
    manifest.id !== name ||
    !Array.isArray(manifest.sources) ||
    !Array.isArray(manifest.assets)
  ) {
    throw new Error(`${name}/episode.json 格式不正确`)
  }

  const actualFiles = await listFiles(path.join(episodeDir, 'assets'))
  const actualPaths = actualFiles.map((filePath) => relativePosix(episodeDir, filePath))
  const declaredPaths = manifest.assets.map((asset) => asset.path)
  const missingDeclarations = actualPaths.filter((item) => !declaredPaths.includes(item))
  const missingFiles = declaredPaths.filter((item) => !actualPaths.includes(item))
  if (missingDeclarations.length || missingFiles.length) {
    throw new Error(
      `${name} 素材清单不同步。未登记：${missingDeclarations.join(', ') || '无'}；缺失：${missingFiles.join(', ') || '无'}\n` +
        `请运行 pnpm promo:manifest -- ${name}`
    )
  }

  for (const asset of manifest.assets) {
    if (!/^assets\/(audio|fonts|captured\/(source|clips|stills))\//u.test(asset.path)) {
      throw new Error(`非法正式素材路径：${asset.path}`)
    }
    const filePath = path.join(episodeDir, asset.path)
    const fileStat = await stat(filePath)
    const digest = await sha256File(filePath)
    if (fileStat.size !== asset.size || digest !== asset.sha256) {
      throw new Error(`素材被改动但清单没有更新：${asset.path}`)
    }
    await verifyLfsAttribute(filePath)
  }

  const expectedSources = []
  for (const fileName of renderSourceNames) {
    const filePath = path.join(episodeDir, fileName)
    if (
      await access(filePath)
        .then(() => true)
        .catch(() => false)
    )
      expectedSources.push(fileName)
  }
  if (expectedSources.join('\n') !== manifest.sources.map((source) => source.path).join('\n')) {
    throw new Error(`${name} 的渲染源文件清单不同步`)
  }
  for (const source of manifest.sources) {
    const filePath = path.join(episodeDir, source.path)
    const fileStat = await stat(filePath)
    if (source.size !== fileStat.size || source.sha256 !== (await sha256File(filePath))) {
      throw new Error(`渲染源文件被改动但清单没有更新：${name}/${source.path}`)
    }
  }

  const html = await readFile(path.join(episodeDir, 'index.html'), 'utf8')
  const references = [...html.matchAll(/(?:src|href)=["'](assets\/[^"']+)["']/gu)].map(
    (match) => match[1]
  )
  for (const reference of references) {
    if (!declaredPaths.includes(reference)) {
      throw new Error(`index.html 引用了未登记素材：${reference}`)
    }
  }

  const projectFiles = await listFiles(episodeDir)
  for (const filePath of projectFiles) {
    const relativePath = relativePosix(episodeDir, filePath)
    if (relativePath.startsWith('.work/') || relativePath === '.DS_Store') continue
    if (forbiddenNames.test(relativePath)) {
      throw new Error(`检测到不应进 Git 的运行数据：${name}/${relativePath}`)
    }
    if (textExtensions.has(path.extname(filePath).toLowerCase())) {
      const content = await readFile(filePath, 'utf8')
      if (/\/(Users|home)\/[^/]+\//u.test(content) || /[A-Za-z]:\\Users\\/u.test(content)) {
        throw new Error(`检测到本机绝对路径：${name}/${relativePath}`)
      }
    }
  }

  const finalPath = path.join(episodeDir, 'renders', 'final.mp4')
  const finalManifestPath = path.join(episodeDir, 'renders', 'final.json')
  const finalExists = await access(finalPath)
    .then(() => true)
    .catch(() => false)
  const finalManifestExists = await access(finalManifestPath)
    .then(() => true)
    .catch(() => false)
  if (checkFinal && finalExists !== finalManifestExists) {
    throw new Error(`${name} 的 final.mp4 和 final.json 必须同时存在`)
  }
  if (checkFinal && finalExists) {
    const finalManifestText = await readFile(finalManifestPath, 'utf8')
    const finalManifest = JSON.parse(finalManifestText)
    const finalStat = await stat(finalPath)
    if (
      finalManifest.size !== finalStat.size ||
      finalManifest.sha256 !== (await sha256File(finalPath)) ||
      finalManifest.episodeManifestSha256 !== sha256Text(manifestText)
    ) {
      throw new Error(`${name} 的正式成片与当前工程不匹配，请重新渲染并发布`)
    }
    await verifyLfsAttribute(finalPath)
    const video = await probeVideo(finalPath)
    if (
      video.width !== manifest.video.width ||
      video.height !== manifest.video.height ||
      Math.abs(video.fps - manifest.video.fps) > 0.01 ||
      Math.abs(video.duration - manifest.video.duration) > 0.05
    ) {
      throw new Error(`${name} 的正式成片分辨率、帧率或时长不正确`)
    }
  }

  console.log(`Promo 校验通过：${name}`)
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isDirectRun) {
  const args = cliArgs()
  const selectors = args.includes('--all')
    ? await listEpisodes()
    : [(await resolveEpisode(args[0])).name]
  for (const selector of selectors) {
    const { episodeDir } = await resolveEpisode(selector)
    await verifyEpisode(episodeDir)
  }
}
