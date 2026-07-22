import { cp, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { cliArgs, episodesRoot, promoRoot } from './lib.mjs'

const [title, requestedSlug] = cliArgs()

if (!title) {
  throw new Error('用法：pnpm promo:new -- "本期主题" "episode-slug"')
}

await mkdir(episodesRoot, { recursive: true })
const entries = await readdir(episodesRoot, { withFileTypes: true })
const usedNumbers = entries
  .filter((entry) => entry.isDirectory())
  .map((entry) => Number.parseInt(entry.name.slice(0, 3), 10))
  .filter(Number.isFinite)
const nextNumber = String(Math.max(0, ...usedNumbers) + 1).padStart(3, '0')
const slug =
  (requestedSlug || 'episode')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'episode'
const episodeName = `${nextNumber}-${slug}`
const episodeDir = path.join(episodesRoot, episodeName)
const templateDir = path.join(promoRoot, 'templates', 'vertical-product-demo')

await cp(templateDir, episodeDir, { recursive: true, verbatimSymlinks: true })
await rm(path.join(episodeDir, 'DESIGN.md'), { force: true })
await rm(path.join(episodeDir, 'meta.json'), { force: true })
await symlink('../../doc/DESIGN.md', path.join(episodeDir, 'DESIGN.md'))
await mkdir(path.join(episodeDir, 'assets', 'captured', 'source'), { recursive: true })
await mkdir(path.join(episodeDir, 'assets', 'captured', 'clips'), { recursive: true })
await mkdir(path.join(episodeDir, 'assets', 'captured', 'stills'), { recursive: true })
await mkdir(path.join(episodeDir, 'assets', 'audio'), { recursive: true })
await mkdir(path.join(episodeDir, 'renders'), { recursive: true })
await mkdir(path.join(episodeDir, '.work'), { recursive: true })

const meta = {
  id: episodeName,
  name: episodeName,
  title,
  createdAt: new Date().toISOString()
}
await writeFile(
  path.join(episodeDir, 'episode.json'),
  `${JSON.stringify({ schemaVersion: 1, ...meta, video: null, assets: [] }, null, 2)}\n`
)

await writeFile(
  path.join(episodeDir, 'brief.md'),
  `# ${title}\n\n## 目标受众\n\n待填写。\n\n## 核心问题\n\n待填写。\n\n## 馆长如何解决\n\n待填写。\n\n## 真实产品画面\n\n待填写。\n`
)
await writeFile(
  path.join(episodeDir, 'shot-list.md'),
  '# 镜头表\n\n| 时间 | 画面 | 旁白 | 素材 |\n|---|---|---|---|\n| 0-3 秒 | 开场问题 | 待填写 | 待采集 |\n| 3-20 秒 | 真实操作 | 待填写 | 待采集 |\n| 20-30 秒 | 真实结果 | 待填写 | 待采集 |\n'
)
await writeFile(path.join(episodeDir, 'narration.txt'), '请把本期中文旁白写在这里。\n')

console.log(`已创建：${episodeDir}`)
