import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { cliArgs, promoEnvironment, promoRoot, resolveEpisode } from './lib.mjs'

const [selector] = cliArgs()
const { name, episodeDir } = await resolveEpisode(selector)
const profilePath = path.join(promoRoot, 'library', 'voice', 'profile.json')
const profile = JSON.parse(await readFile(profilePath, 'utf8'))
const narrationPath = path.join(episodeDir, 'narration.txt')
const narrationText = (await readFile(narrationPath, 'utf8')).trim()
const segments = narrationText
  .split(/\n+/)
  .map((line) => line.trim())
  .filter(Boolean)

if (profile.provider !== 'qwen3-tts-local') {
  throw new Error(`当前只启用了 Qwen3-TTS 本地人声，实际配置：${profile.provider}`)
}
if (!narrationText || segments.length === 0) {
  throw new Error('narration.txt 没有可生成的中文旁白')
}

const pythonPath = path.join(
  homedir(),
  '.cache',
  'ncurator-promo',
  'tts',
  'venv',
  'bin',
  'python'
)
const generatorPath = path.join(promoRoot, 'scripts', 'generate-local-voice.py')
const audioDir = path.join(episodeDir, 'assets', 'audio')
const narrationAudioPath = path.join(audioDir, 'narration.wav')
const rawNarrationAudioPath = path.join(audioDir, 'narration.raw.wav')
await mkdir(audioDir, { recursive: true })

function runCommand(command, args, cwd = episodeDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: promoEnvironment(),
      stdio: 'inherit'
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} 执行失败，退出码：${code}`))
    })
  })
}

function runCommandCapture(command, args, cwd = episodeDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: promoEnvironment(),
      stdio: ['ignore', 'pipe', 'inherit']
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += String(chunk)
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve(output)
      else reject(new Error(`${command} 执行失败，退出码：${code}`))
    })
  })
}

console.log(`正在使用 Qwen3-TTS 本地松弛男声生成旁白：${name}`)
await runCommand(pythonPath, [
  generatorPath,
  narrationPath,
  rawNarrationAudioPath,
  '--model',
  profile.model,
  '--language',
  profile.language,
  '--style',
  profile.style
])

await runCommand('ffmpeg', [
  '-loglevel',
  'error',
  '-y',
  '-i',
  rawNarrationAudioPath,
  '-af',
  `atempo=${profile.speed},loudnorm=I=-17:TP=-1:LRA=7`,
  '-ar',
  '48000',
  '-ac',
  '1',
  '-c:a',
  'pcm_s16le',
  narrationAudioPath
])

const durationOutput = await runCommandCapture('ffprobe', [
  '-v',
  'error',
  '-show_entries',
  'format=duration',
  '-of',
  'default=noprint_wrappers=1:nokey=1',
  narrationAudioPath
])
const duration = Number.parseFloat(durationOutput.trim())
if (!Number.isFinite(duration) || duration <= 0) {
  throw new Error('无法读取旁白时长')
}

// Qwen 按整段生成以保持真人般的连续语气。字幕按每行文字量分配，
// 后续如果需要逐字卡点，再增加本地强制对齐模型。
const weights = segments.map((text) => [...text.replace(/[，。！？：；、,.!?:;]/g, '')].length)
const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
let cursor = 0
const transcript = segments.map((text, index) => {
  const start = cursor
  const end = index === segments.length - 1
    ? duration
    : cursor + duration * (weights[index] / totalWeight)
  cursor = end
  return { text, start, end }
})

await writeFile(
  path.join(episodeDir, 'transcript.json'),
  `${JSON.stringify(transcript, null, 2)}\n`
)
await rm(rawNarrationAudioPath, { force: true })
console.log(`旁白和字幕时间已经生成：${name}（${duration.toFixed(2)} 秒）`)
