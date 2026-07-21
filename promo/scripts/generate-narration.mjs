import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { cliArgs, promoEnvironment, promoRoot, resolveEpisode } from './lib.mjs'

const [selector] = cliArgs()
const { name, episodeDir } = await resolveEpisode(selector)
const profilePath = path.join(promoRoot, 'library', 'voice', 'profile.json')
const profile = JSON.parse(await readFile(profilePath, 'utf8'))
const narrationPath = path.join(episodeDir, 'narration.txt')
const narrationText = await readFile(narrationPath, 'utf8')
const segments = narrationText
  .split(/\n+/)
  .flatMap((line) => line.match(/[^。！？!?]+[。！？!?]?/g) || [])
  .map((line) => line.trim())
  .filter(Boolean)

if (profile.provider !== 'macos-say') {
  throw new Error(`当前只启用了 macOS 本地人声，实际配置：${profile.provider}`)
}
if (!profile.voiceId) {
  throw new Error('尚未选定中文音色，请先填写 promo/library/voice/profile.json')
}
if (segments.length === 0) {
  throw new Error('narration.txt 没有可生成的中文旁白')
}

const audioDir = path.join(episodeDir, 'assets', 'audio')
const segmentDir = path.join(audioDir, 'segments')
const narrationAudioPath = path.join(audioDir, 'narration.wav')
const concatListPath = path.join(audioDir, 'concat.txt')
await rm(segmentDir, { recursive: true, force: true })
await mkdir(segmentDir, { recursive: true })

function runCommand(command, args, cwd = episodeDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: promoEnvironment(),
      stdio: 'inherit'
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} 执行失败，退出码：${code}`))
      }
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
      if (code === 0) {
        resolve(output)
      } else {
        reject(new Error(`${command} 执行失败，退出码：${code}`))
      }
    })
  })
}

console.log(`正在生成旁白：${name}`)
const transcript = []
const segmentFiles = []
let cursor = 0

for (const [index, text] of segments.entries()) {
  const baseName = String(index + 1).padStart(3, '0')
  const textPath = path.join(segmentDir, `${baseName}.txt`)
  const aiffPath = path.join(segmentDir, `${baseName}.aiff`)
  const wavPath = path.join(segmentDir, `${baseName}.wav`)
  await writeFile(textPath, `${text}\n`)
  await runCommand('say', [
    '-v',
    profile.voiceId,
    '-r',
    String(profile.rate),
    '-o',
    aiffPath,
    '-f',
    textPath
  ])
  await runCommand('ffmpeg', [
    '-loglevel',
    'error',
    '-y',
    '-i',
    aiffPath,
    '-ar',
    '48000',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    wavPath
  ])
  const durationOutput = await runCommandCapture('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    wavPath
  ])
  const duration = Number.parseFloat(durationOutput.trim())
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`无法读取第 ${index + 1} 句旁白时长`)
  }
  transcript.push({ text, start: cursor, end: cursor + duration })
  cursor += duration
  segmentFiles.push(`file 'segments/${baseName}.wav'`)
}

await writeFile(concatListPath, `${segmentFiles.join('\n')}\n`)
await runCommand(
  'ffmpeg',
  [
    '-loglevel',
    'error',
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    path.basename(concatListPath),
    '-c:a',
    'pcm_s16le',
    path.basename(narrationAudioPath)
  ],
  audioDir
)
await writeFile(
  path.join(episodeDir, 'transcript.json'),
  `${JSON.stringify(transcript, null, 2)}\n`
)
await rm(segmentDir, { recursive: true, force: true })
await rm(concatListPath, { force: true })
console.log(`旁白和精确字幕时间已经生成：${name}`)
