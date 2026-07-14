import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('app update publish config', () => {
  it('uses the direct release download feed instead of the GitHub Atom provider', async () => {
    const config = await readFile(path.resolve('electron-builder.yml'), 'utf8')

    expect(config).toMatch(
      /publish:\s*\n\s*provider:\s*generic\s*\n\s*url:\s*https:\/\/download\.ncurator\.com\/updates\/latest/u
    )
    expect(config).not.toMatch(/publish:\s*\n\s*provider:\s*github/u)
  })
})
