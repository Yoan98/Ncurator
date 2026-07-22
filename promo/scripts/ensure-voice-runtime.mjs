import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promoRoot } from './lib.mjs'

const defaultVenvDir = path.join(homedir(), '.cache', 'ncurator-promo', 'tts', 'venv')
const requirementsPath = path.join(promoRoot, 'library', 'voice', 'requirements.txt')

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      env: process.env
    })
    let output = ''
    if (options.capture) {
      child.stdout.on('data', (chunk) => {
        output += String(chunk)
      })
      child.stderr.on('data', (chunk) => {
        output += String(chunk)
      })
    }
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve(output)
      else reject(new Error(`${command} 执行失败，退出码：${code}${output ? `\n${output}` : ''}`))
    })
  })

const runtimeWorks = async (pythonPath) => {
  try {
    await access(pythonPath)
    await run(pythonPath, ['-c', 'import mlx_audio, soundfile'], { capture: true })
    return true
  } catch {
    return false
  }
}

const resolveUv = async () => {
  if (process.env.UV_BIN) return process.env.UV_BIN
  const userUv = path.join(homedir(), '.local', 'bin', 'uv')
  try {
    await access(userUv)
    return userUv
  } catch {
    return 'uv'
  }
}

export const ensureVoiceRuntime = async () => {
  const venvDir = process.env.PROMO_TTS_VENV || defaultVenvDir
  const pythonPath = path.join(venvDir, 'bin', 'python')
  if (await runtimeWorks(pythonPath)) return pythonPath

  if (process.env.PROMO_TTS_AUTO_SETUP === '0') {
    throw new Error(
      `Qwen3-TTS 环境不可用：${pythonPath}\n` +
        '已禁止自动安装。请运行 pnpm promo:voice:setup，不能改用 Edge、macOS say 或其他系统语音。'
    )
  }

  const uv = await resolveUv()
  console.log('首次使用：正在准备馆长固定 Qwen3-TTS 配音环境…')
  await run(uv, ['venv', venvDir, '--python', '3.11'])
  await run(uv, ['pip', 'install', '--python', pythonPath, '-r', requirementsPath])

  if (!(await runtimeWorks(pythonPath))) {
    throw new Error('Qwen3-TTS 环境安装后仍无法使用；停止生成，禁止降级到系统语音。')
  }
  return pythonPath
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isDirectRun) {
  const pythonPath = await ensureVoiceRuntime()
  console.log(`馆长固定配音环境可用：${pythonPath}`)
}
