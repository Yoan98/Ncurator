import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { cliArgs, hyperframesVersion, promoEnvironment, resolveEpisode } from './lib.mjs'

const [command, selector] = cliArgs()
const supportedCommands = new Set(['check', 'preview', 'render'])

if (!supportedCommands.has(command)) {
  throw new Error('用法：run-episode.mjs <check|preview|render> [视频目录]')
}

const { name, episodeDir } = await resolveEpisode(selector)
const args = ['--yes', `hyperframes@${hyperframesVersion}`]

if (command === 'check') {
  args.push('check')
}

if (command === 'preview') {
  args.push('preview', '--port', process.env.PROMO_PORT || '3002')
}

if (command === 'render') {
  await mkdir(path.join(episodeDir, 'renders'), { recursive: true })
  args.push(
    'render',
    '--output',
    'renders/final.mp4',
    '--fps',
    '30',
    '--quality',
    'high',
    '--strict'
  )
}

console.log(
  `正在${command === 'render' ? '渲染' : command === 'preview' ? '预览' : '检查'}：${name}`
)
const child = spawn('npx', args, {
  cwd: episodeDir,
  env: promoEnvironment(),
  stdio: 'inherit'
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exitCode = code ?? 1
})
