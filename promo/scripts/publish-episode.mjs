import { copyFile, mkdir, readFile, rename, stat } from 'node:fs/promises'
import path from 'node:path'
import { cliArgs, resolveEpisode } from './lib.mjs'
import {
  probeVideo,
  sha256File,
  sha256Text,
  syncEpisodeManifest,
  syncFinalManifest
} from './manifest.mjs'
import { verifyEpisode } from './verify-promo.mjs'

const [selector] = cliArgs()
const { name, episodeDir } = await resolveEpisode(selector)
await syncEpisodeManifest(episodeDir)
await verifyEpisode(episodeDir, { checkFinal: false })

const candidatePath = path.join(episodeDir, '.work', 'render', 'candidate.mp4')
const candidateManifestPath = path.join(episodeDir, '.work', 'render', 'candidate.json')
const candidate = await probeVideo(candidatePath).catch(() => {
  throw new Error(`找不到合法的候选成片，请先运行 pnpm promo:render -- ${name}`)
})
const episodeText = await readFile(path.join(episodeDir, 'episode.json'), 'utf8')
const manifest = JSON.parse(episodeText)
const candidateManifest = JSON.parse(
  await readFile(candidateManifestPath, 'utf8').catch(() => {
    throw new Error(`候选成片缺少渲染凭证，请重新运行 pnpm promo:render -- ${name}`)
  })
)
const candidateStat = await stat(candidatePath)
if (
  candidateManifest.episodeManifestSha256 !== sha256Text(episodeText) ||
  candidateManifest.size !== candidateStat.size ||
  candidateManifest.sha256 !== (await sha256File(candidatePath))
) {
  throw new Error('候选成片与当前工程不匹配，请重新渲染')
}
if (
  candidate.width !== manifest.video.width ||
  candidate.height !== manifest.video.height ||
  Math.abs(candidate.fps - manifest.video.fps) > 0.01 ||
  Math.abs(candidate.duration - manifest.video.duration) > 0.05
) {
  throw new Error('候选成片的分辨率、帧率或时长不符合 episode.json')
}

const rendersDir = path.join(episodeDir, 'renders')
const tempFinalPath = path.join(rendersDir, 'final.mp4.tmp')
await mkdir(rendersDir, { recursive: true })
await copyFile(candidatePath, tempFinalPath)
await rename(tempFinalPath, path.join(rendersDir, 'final.mp4'))
await syncFinalManifest(episodeDir)
await verifyEpisode(episodeDir)
console.log(`正式成片已发布：${name}/renders/final.mp4`)
