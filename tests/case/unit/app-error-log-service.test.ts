import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  APP_ERROR_LOG_MAX_BYTES,
  AppErrorLogService
} from '../../../src/main/services/logging/AppErrorLogService'

describe('AppErrorLogService', () => {
  let tempDir = ''

  afterEach(async () => {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('redacts sensitive values and keeps only recent log content when oversized', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-error-log-'))
    const service = new AppErrorLogService({
      userDataPath: tempDir,
      appVersion: '0.1.58',
      platform: 'win32',
      arch: 'x64'
    })
    const error = new Error('embedding failed at C:\\Users\\Jane\\Documents\\secret.pdf API_KEY=super-secret')
    error.stack = 'Error: C:\\Users\\Jane\\Documents\\secret.pdf'
    service.write({
      module: 'workspace-index',
      error,
      context: { file: 'team/brief.pdf' }
    })

    const firstContent = await fs.readFile(service.getFilePath(), 'utf8')
    expect(firstContent).toContain('module=workspace-index')
    expect(firstContent).toContain('file=team/brief.pdf')
    expect(firstContent).toContain('<redacted>')
    expect(firstContent).toContain('<path>')
    expect(firstContent).not.toContain('super-secret')
    expect(firstContent).not.toContain('Jane')

    for (let index = 0; index < 300; index += 1) {
      service.write({ module: 'workspace-index', error: `failure-${index}-${'x'.repeat(8_000)}` })
    }

    const stats = await fs.stat(service.getFilePath())
    const content = await fs.readFile(service.getFilePath(), 'utf8')
    expect(stats.size).toBeLessThanOrEqual(APP_ERROR_LOG_MAX_BYTES)
    expect(content).toContain('previous log content truncated')
  })
})
