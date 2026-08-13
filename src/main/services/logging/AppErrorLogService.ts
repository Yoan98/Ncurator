import fs from 'node:fs'
import path from 'node:path'

export const APP_ERROR_LOG_MAX_BYTES = 2 * 1024 * 1024
const RETAINED_LOG_BYTES = Math.floor(APP_ERROR_LOG_MAX_BYTES * 0.75)

export type AppErrorLogContext = Record<string, boolean | number | string | undefined>

export type AppErrorLogEntry = {
  module: string
  error: Error | string
  context?: AppErrorLogContext
}

export class AppErrorLogService {
  private readonly directoryPath: string
  private readonly filePath: string

  public constructor(
    private readonly input: {
      userDataPath: string
      appVersion: string
      platform?: NodeJS.Platform
      arch?: string
    }
  ) {
    this.directoryPath = path.join(this.input.userDataPath, 'logs')
    this.filePath = path.join(this.directoryPath, 'app.log')
  }

  public getDirectoryPath(): string {
    return this.directoryPath
  }

  public getFilePath(): string {
    return this.filePath
  }

  public ensureDirectory(): void {
    fs.mkdirSync(this.directoryPath, { recursive: true })
  }

  public write(entry: AppErrorLogEntry): void {
    try {
      this.ensureDirectory()
      fs.appendFileSync(this.filePath, this.formatEntry(entry), 'utf8')
      this.trimIfNeeded()
    } catch (writeError) {
      console.error('[APP-ERROR-LOG] Failed to write error log:', writeError)
    }
  }

  private formatEntry(entry: AppErrorLogEntry): string {
    const error = entry.error instanceof Error ? entry.error : new Error(String(entry.error || 'Unknown error'))
    const context = Object.entries(entry.context || {})
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${this.sanitize(String(value))}`)
      .join(' ')
    const metadata = [
      `time=${new Date().toISOString()}`,
      `appVersion=${this.sanitize(this.input.appVersion)}`,
      `platform=${this.input.platform || process.platform}`,
      `arch=${this.input.arch || process.arch}`,
      `module=${this.sanitize(entry.module)}`,
      context
    ]
      .filter(Boolean)
      .join(' ')

    return [
      `[${metadata}]`,
      `message=${this.sanitize(error.message)}`,
      error.stack ? `stack=${this.sanitize(error.stack)}` : '' ,
      ''
    ]
      .filter(Boolean)
      .join('\n')
      .concat('\n')
  }

  private trimIfNeeded(): void {
    const size = fs.statSync(this.filePath).size
    if (size <= APP_ERROR_LOG_MAX_BYTES) return
    const descriptor = fs.openSync(this.filePath, 'r')
    try {
      const buffer = Buffer.alloc(RETAINED_LOG_BYTES)
      fs.readSync(descriptor, buffer, 0, RETAINED_LOG_BYTES, size - RETAINED_LOG_BYTES)
      fs.writeFileSync(
        this.filePath,
        `[time=${new Date().toISOString()} module=app-error-log] previous log content truncated\n${buffer.toString('utf8')}`,
        'utf8'
      )
    } finally {
      fs.closeSync(descriptor)
    }
  }

  private sanitize(value: string): string {
    return value
      .replace(/(api[_ -]?key|authorization|bearer)\s*[:=]\s*[^\s,;]+/gi, '$1=<redacted>')
      .replace(/[A-Za-z]:\\(?:[^\\\s\r\n]+\\)*[^\\\s\r\n]*/g, '<path>')
      .replace(/\/(?:Users|home|private|var|tmp)(?:\/[^\s'"`]+)+/g, '<path>')
      .replace(/\r?\n/g, '\n')
      .slice(0, 8_000)
  }
}
