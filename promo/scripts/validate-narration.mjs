import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cliArgs, promoRoot, resolveEpisode } from './lib.mjs'

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

export const validateNarration = async (episodeDir) => {
  const indexHtml = await readFile(path.join(episodeDir, 'index.html'), 'utf8')
  if (!indexHtml.includes('assets/audio/narration.wav')) return null

  const profilePath = path.join(promoRoot, 'library', 'voice', 'profile.json')
  const narrationPath = path.join(episodeDir, 'narration.txt')
  const transcriptPath = path.join(episodeDir, 'transcript.json')
  const audioPath = path.join(episodeDir, 'assets', 'audio', 'narration.wav')
  const metaPath = path.join(episodeDir, 'assets', 'audio', 'narration.meta.json')

  let loaded
  try {
    loaded = await Promise.all([
      readFile(profilePath, 'utf8'),
      readFile(narrationPath, 'utf8'),
      readFile(transcriptPath, 'utf8'),
      readFile(audioPath),
      readFile(metaPath, 'utf8').then(JSON.parse)
    ])
  } catch (error) {
    throw new Error(
      `旁白文件或生成凭证缺失。必须先运行 pnpm promo:voice -- <视频目录>，禁止使用 Edge、macOS say 或其他系统语音。\n${error instanceof Error ? error.message : String(error)}`
    )
  }
  const [profileText, narrationText, transcriptText, audioBuffer, meta] = loaded

  const profile = JSON.parse(profileText)
  const transcript = JSON.parse(transcriptText)
  const indexNarrationDuration = Number(
    indexHtml.match(/id="narration"[^>]*data-duration="([\d.]+)"/)?.[1]
  )
  const compositionDuration = Number(
    indexHtml.match(/data-composition-id="main"[\s\S]*?data-duration="([\d.]+)"/)?.[1]
  )
  const expected = {
    voiceId: profile.voiceId,
    provider: profile.provider,
    model: profile.model,
    language: profile.language,
    speed: profile.speed,
    style: profile.style,
    narrationSha256: sha256(narrationText.trim()),
    transcriptSha256: sha256(transcriptText),
    profileSha256: sha256(JSON.stringify(profile)),
    audioSha256: sha256(audioBuffer)
  }
  const mismatches = Object.entries(expected)
    .filter(([key, value]) => meta[key] !== value)
    .map(([key]) => key)
  const transcriptEnd = Number(transcript.at(-1)?.end)
  if (
    !Number.isFinite(indexNarrationDuration) ||
    Math.abs(indexNarrationDuration - meta.duration) > 0.02
  ) {
    mismatches.push('indexNarrationDuration')
  }
  if (!Number.isFinite(transcriptEnd) || Math.abs(transcriptEnd - meta.duration) > 0.001) {
    mismatches.push('transcriptDuration')
  }
  if (!Number.isFinite(compositionDuration) || compositionDuration < meta.duration + 0.2) {
    mismatches.push('compositionDuration')
  }

  if (profile.provider !== 'qwen3-tts-local' || mismatches.length > 0) {
    throw new Error(
      `旁白不是当前固定 Qwen3-TTS 人声，或文案、配置、音频已被改动。异常字段：${mismatches.join(', ') || 'provider'}。\n` +
        '请重新运行 pnpm promo:voice -- <视频目录>；禁止用系统语音覆盖 narration.wav。'
    )
  }

  console.log(`旁白校验通过：${meta.voiceId} · ${Number(meta.duration).toFixed(2)} 秒`)
  return meta
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isDirectRun) {
  const [selector] = cliArgs()
  const { episodeDir } = await resolveEpisode(selector)
  await validateNarration(episodeDir)
}
