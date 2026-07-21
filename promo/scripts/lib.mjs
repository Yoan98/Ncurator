import { access, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const promoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const episodesRoot = path.join(promoRoot, 'episodes')
export const hyperframesVersion = '0.7.65'

export function cliArgs() {
  return process.argv.slice(2).filter((arg) => arg !== '--')
}

export async function resolveEpisode(selector) {
  const entries = await readdir(episodesRoot, { withFileTypes: true }).catch(() => [])
  const names = entries
    .filter((entry) => entry.isDirectory() && /^\d{3}-/.test(entry.name))
    .map((entry) => entry.name)
    .sort()

  if (names.length === 0) {
    throw new Error('还没有视频工程，请先运行 pnpm promo:new -- "主题" "英文短名"')
  }

  const name = selector || names.at(-1)
  if (!names.includes(name)) {
    throw new Error(`找不到视频工程：${name}`)
  }

  const episodeDir = path.join(episodesRoot, name)
  await access(path.join(episodeDir, 'index.html'))
  return { name, episodeDir }
}

export function promoEnvironment() {
  return { ...process.env }
}
