import { spawn, spawnSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import ffmpeg from 'ffmpeg-static'
import ffprobe from '@ffprobe-installer/ffprobe'

export const unpackMediaPath = (file: string): string =>
  file.replace(/app\.asar([/\\])/u, 'app.asar.unpacked$1')
export const mediaBinaries = (): { ffmpeg: string; ffprobe: string } => ({
  ffmpeg: unpackMediaPath(ffmpeg || ''),
  ffprobe: unpackMediaPath(ffprobe.path)
})

export const runMediaProcess = (
  executable: string,
  args: string[],
  signal?: AbortSignal,
  environment?: NodeJS.ProcessEnv,
  cwd?: string
): Promise<string> =>
  new Promise((resolveResult, reject) => {
    signal?.throwIfAborted()
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: environment || process.env,
      cwd,
      detached: process.platform !== 'win32'
    })
    let stdout = ''
    let stderr = ''
    const abort = (): void => {
      if (!child.pid) return
      if (process.platform === 'win32')
        spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore'
        })
      else {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }
    }
    signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (data: Buffer) => {
      stdout = (stdout + data.toString()).slice(-4 * 1024 * 1024)
    })
    child.stderr.on('data', (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-16000)
    })
    child.once('error', reject)
    child.once('close', (code) => {
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) reject(new Error('Media operation cancelled'))
      else if (code === 0) resolveResult(stdout)
      else reject(new Error(`${resolve(executable)} exited ${code}: ${stderr}`))
    })
  })

export const hashMediaFile = async (file: string, signal?: AbortSignal): Promise<string> => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk)
  return hash.digest('hex')
}
