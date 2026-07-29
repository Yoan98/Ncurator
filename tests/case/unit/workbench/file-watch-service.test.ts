import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileWatchService } from '../../../../src/main/services/files/FileWatchService'

const temporaryDirectories: string[] = []
const services: FileWatchService[] = []

const createWatchedFile = async (): Promise<{ directory: string; filePath: string }> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-file-watch-'))
  temporaryDirectories.push(directory)
  const filePath = path.join(directory, 'current.md')
  await fs.writeFile(filePath, '# original')
  return { directory, filePath }
}

const waitFor = async (predicate: () => boolean, timeoutMs = 2_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for file watch event')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

afterEach(async () => {
  services.splice(0).forEach((service) => service.dispose())
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  )
})

describe('FileWatchService', () => {
  it('debounces repeated saves and emits only after the file fingerprint changes', async () => {
    const { filePath } = await createWatchedFile()
    const service = new FileWatchService({ debounceMs: 40 })
    services.push(service)
    const onChange = vi.fn()
    await service.start({ ownerId: 1, filePath, onChange })

    await fs.writeFile(filePath, '# first change')
    await fs.writeFile(filePath, '# second change')
    await fs.writeFile(filePath, '# final change')
    await waitFor(() => onChange.mock.calls.length === 1)
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ filePath }))
  })

  it('observes a temporary file renamed over the watched path', async () => {
    const { directory, filePath } = await createWatchedFile()
    const service = new FileWatchService({ debounceMs: 40 })
    services.push(service)
    const onChange = vi.fn()
    await service.start({ ownerId: 2, filePath, onChange })

    const temporaryPath = path.join(directory, 'save.tmp')
    const backupPath = path.join(directory, 'current.backup')
    await fs.writeFile(temporaryPath, '# replacement')
    await fs.rename(filePath, backupPath)
    await fs.rename(temporaryPath, filePath)
    await waitFor(() => onChange.mock.calls.length === 1)

    expect(await fs.readFile(filePath, 'utf8')).toBe('# replacement')
  })

  it('supports focus checks without duplicating the later directory event', async () => {
    const { filePath } = await createWatchedFile()
    const service = new FileWatchService({ debounceMs: 200 })
    services.push(service)
    const onChange = vi.fn()
    const { watchId } = await service.start({ ownerId: 3, filePath, onChange })

    expect(await service.check(watchId)).toBe(false)
    await fs.writeFile(filePath, '# focus check')
    expect(await service.check(watchId)).toBe(true)
    expect(await service.check(watchId)).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('stops individual and owner watches', async () => {
    const first = await createWatchedFile()
    const second = await createWatchedFile()
    const service = new FileWatchService({ debounceMs: 30 })
    services.push(service)
    const firstChange = vi.fn()
    const secondChange = vi.fn()
    const firstWatch = await service.start({
      ownerId: 4,
      filePath: first.filePath,
      onChange: firstChange
    })
    await service.start({ ownerId: 5, filePath: second.filePath, onChange: secondChange })

    expect(service.stop(firstWatch.watchId)).toBe(true)
    service.stopOwner(5)
    await fs.writeFile(first.filePath, '# stopped')
    await fs.writeFile(second.filePath, '# owner stopped')
    await new Promise((resolve) => setTimeout(resolve, 120))

    expect(firstChange).not.toHaveBeenCalled()
    expect(secondChange).not.toHaveBeenCalled()
  })
})
