import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { cliArgs, hyperframesVersion, promoEnvironment, resolveEpisode } from './lib.mjs'
import { probeVideo, sha256File, sha256Text, syncEpisodeManifest } from './manifest.mjs'
import { verifyEpisode } from './verify-promo.mjs'

const [command, selector] = cliArgs()
const supportedCommands = new Set(['check', 'preview', 'render'])

if (!supportedCommands.has(command)) {
  throw new Error('用法：run-episode.mjs <check|preview|render> [视频目录]')
}

const { name, episodeDir } = await resolveEpisode(selector)
await syncEpisodeManifest(episodeDir)
await verifyEpisode(episodeDir, { checkFinal: command === 'check' })
const args = ['--yes', `hyperframes@${hyperframesVersion}`]

if (command === 'check') {
  args.push('check')
}

if (command === 'preview') {
  args.push('preview', '--port', process.env.PROMO_PORT || '3002')
}

if (command === 'render') {
  await mkdir(path.join(episodeDir, '.work', 'render'), { recursive: true })
  args.push(
    'render',
    '--output',
    '.work/render/candidate.mp4',
    '--fps',
    '30',
    '--quality',
    'high',
    '--strict'
  )
}

console.log(
  `正在${command === 'render' ? '渲染候选成片' : command === 'preview' ? '预览' : '检查'}：${name}`
)
await new Promise((resolve, reject) => {
  const child = spawn('npx', args, {
    cwd: episodeDir,
    env: promoEnvironment(),
    stdio: 'inherit'
  })
  child.on('error', reject)
  child.on('exit', (code, signal) => {
    if (signal) reject(new Error(`HyperFrames 被信号终止：${signal}`))
    else if (code === 0) resolve()
    else reject(new Error(`HyperFrames 执行失败，退出码：${code}`))
  })
})

if (command === 'render') {
  const candidatePath = path.join(episodeDir, '.work', 'render', 'candidate.mp4')
  const candidateStat = await stat(candidatePath)
  const episodeText = await readFile(path.join(episodeDir, 'episode.json'), 'utf8')
  await writeFile(
    path.join(episodeDir, '.work', 'render', 'candidate.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        path: '.work/render/candidate.mp4',
        size: candidateStat.size,
        sha256: await sha256File(candidatePath),
        episodeManifestSha256: sha256Text(episodeText),
        video: await probeVideo(candidatePath)
      },
      null,
      2
    )}\n`
  )
  console.log(`候选成片已生成：${name}/.work/render/candidate.mp4`)
  console.log(`确认后运行：pnpm promo:publish -- ${name}`)
}
