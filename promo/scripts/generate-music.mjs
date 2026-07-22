import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promoRoot } from './lib.mjs'

const sampleRate = 48_000
const duration = 19.2
const frameCount = Math.round(sampleRate * duration)
const channelCount = 2
const bytesPerSample = 2
const dataSize = frameCount * channelCount * bytesPerSample
const outputDir = path.join(promoRoot, 'library', 'audio', 'files')
const outputPath = path.join(outputDir, 'light-organize-96bpm.wav')
const bpm = 96
const beatDuration = 60 / bpm
const chordRoots = [130.81, 110, 87.31, 98]
const chordKinds = ['major7', 'minor7', 'major7', 'sus4']

let noiseState = 0x6d2b79f5
const noise = () => {
  noiseState = (noiseState * 1664525 + 1013904223) >>> 0
  return noiseState / 0xffffffff * 2 - 1
}

const clamp = (value) => Math.max(-1, Math.min(1, value))
const triangle = (phase) => 2 * Math.abs(2 * (phase - Math.floor(phase + 0.5))) - 1
const chordRatios = {
  major7: [1, 1.2599, 1.4983, 1.8877],
  minor7: [1, 1.1892, 1.4983, 1.7818],
  sus4: [1, 1.3348, 1.4983, 1.7818]
}

const samples = Buffer.alloc(dataSize)
let previousNoise = 0

for (let frame = 0; frame < frameCount; frame += 1) {
  const time = frame / sampleRate
  const beat = time / beatDuration
  const chordIndex = Math.floor(beat / 4) % chordRoots.length
  const root = chordRoots[chordIndex]
  const ratios = chordRatios[chordKinds[chordIndex]]
  const chordTime = time % (beatDuration * 4)
  const padEnvelope = Math.min(1, chordTime / 0.35) * Math.min(1, (beatDuration * 4 - chordTime) / 0.45)

  let pad = 0
  for (const [toneIndex, ratio] of ratios.entries()) {
    const frequency = root * ratio
    const phase = (time * frequency + toneIndex * 0.13) % 1
    pad += triangle(phase) * (toneIndex === 0 ? 0.34 : 0.18)
  }
  pad *= padEnvelope * 0.14

  const beatPhase = beat - Math.floor(beat)
  const eighth = beat * 2
  const eighthPhase = eighth - Math.floor(eighth)
  const beatIndex = Math.floor(beat)

  const kickEnvelope = Math.exp(-beatPhase * 15)
  const kickFrequency = 48 + 38 * Math.exp(-beatPhase * 22)
  const kick = Math.sin(2 * Math.PI * kickFrequency * beatPhase * beatDuration) * kickEnvelope * 0.24

  const rawNoise = noise()
  const highNoise = rawNoise - previousNoise * 0.82
  previousNoise = rawNoise
  const hat = highNoise * Math.exp(-eighthPhase * 42) * (Math.floor(eighth) % 2 === 0 ? 0.035 : 0.022)
  const snare =
    beatIndex % 4 === 1 || beatIndex % 4 === 3
      ? highNoise * Math.exp(-beatPhase * 20) * 0.085
      : 0

  const pluckStep = beatIndex % 8
  const pluckRatio = ratios[[0, 1, 2, 3, 2, 1, 3, 1][pluckStep] % ratios.length]
  const pluckFrequency = root * 2 * pluckRatio
  const pluckEnvelope = Math.exp(-beatPhase * 6.8)
  const pluck =
    (Math.sin(2 * Math.PI * pluckFrequency * time) +
      0.32 * Math.sin(2 * Math.PI * pluckFrequency * 2 * time)) *
    pluckEnvelope *
    0.075

  const fadeIn = Math.min(1, time / 0.45)
  const fadeOut = Math.min(1, (duration - time) / 1.1)
  const master = fadeIn * fadeOut
  const left = clamp((pad + kick + hat + snare + pluck * 0.92) * master)
  const right = clamp((pad + kick + hat * 0.86 + snare + pluck * 1.08) * master)
  const offset = frame * 4
  samples.writeInt16LE(Math.round(left * 32767), offset)
  samples.writeInt16LE(Math.round(right * 32767), offset + 2)
}

const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.writeUInt32LE(36 + dataSize, 4)
header.write('WAVE', 8)
header.write('fmt ', 12)
header.writeUInt32LE(16, 16)
header.writeUInt16LE(1, 20)
header.writeUInt16LE(channelCount, 22)
header.writeUInt32LE(sampleRate, 24)
header.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28)
header.writeUInt16LE(channelCount * bytesPerSample, 32)
header.writeUInt16LE(bytesPerSample * 8, 34)
header.write('data', 36)
header.writeUInt32LE(dataSize, 40)

await mkdir(outputDir, { recursive: true })
await writeFile(outputPath, Buffer.concat([header, samples]))
console.log(`已生成原创伴奏：${outputPath}`)
