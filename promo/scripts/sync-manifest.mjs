import path from 'node:path'
import { cliArgs, listEpisodes, resolveEpisode } from './lib.mjs'
import { syncEpisodeManifest } from './manifest.mjs'

const args = cliArgs()
const selectors = args.includes('--all')
  ? await listEpisodes()
  : [(await resolveEpisode(args[0])).name]

for (const selector of selectors) {
  const { episodeDir } = await resolveEpisode(selector)
  await syncEpisodeManifest(episodeDir)
  console.log(`素材清单已更新：${path.basename(episodeDir)}`)
}
