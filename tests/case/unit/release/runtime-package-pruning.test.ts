import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertRuntimePruningTrace,
  pruneRuntimePackages
} from '../../../../scripts/build/package/prune-runtime.mjs'

let temporaryDirectory = ''

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
  temporaryDirectory = ''
})

const runtimeTrace = {
  packages: [
    { name: 'mathjax-full' },
    { name: 'pdf-parse' },
    { name: 'exceljs' },
    { name: 'node-pty' }
  ],
  trace: {
    files: [
      'node_modules/.pnpm/mathjax-full@3.2.2/node_modules/mathjax-full/js/mathjax.js',
      'node_modules/.pnpm/mathjax-full@3.2.2/node_modules/mathjax-full/package.json',
      'node_modules/.pnpm/pdf-parse@1.1.1/node_modules/pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js',
      'node_modules/.pnpm/exceljs@4.4.0/node_modules/exceljs/lib/doc/workbook.js',
      'node_modules/.pnpm/node-pty@1.2.0/node_modules/node-pty/lib/index.js'
    ]
  }
}

const writeFixture = async (relativePath: string): Promise<void> => {
  const targetPath = path.join(temporaryDirectory, relativePath)
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, 'runtime-fixture')
}

describe('targeted runtime package pruning', () => {
  it('removes only approved redundant distributions on non-Windows targets', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-runtime-pruning-'))
    const removable = [
      'mathjax-full/es5/tex-svg.js',
      'mathjax-full/components/src/component.js',
      'mathjax-full/ts/input/tex.ts',
      'pdf-parse/lib/pdf.js/v1.9.426/build/pdf.js',
      'pdf-parse/lib/pdf.js/v1.10.88/build/pdf.js',
      'pdf-parse/lib/pdf.js/v2.0.550/build/pdf.js',
      'exceljs/dist/exceljs.js',
      'node-pty/third_party/conpty/conpty.dll'
    ]
    await Promise.all(
      [
        ...removable,
        'mathjax-full/js/mathjax.js',
        'pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js'
      ].map(writeFixture)
    )

    const result = pruneRuntimePackages({
      nodeModulesDirectory: temporaryDirectory,
      runtimeTrace,
      platform: 'darwin'
    })

    for (const relativePath of removable) {
      expect(fs.existsSync(path.join(temporaryDirectory, relativePath))).toBe(false)
    }
    expect(fs.existsSync(path.join(temporaryDirectory, 'mathjax-full/js/mathjax.js'))).toBe(true)
    expect(
      fs.existsSync(path.join(temporaryDirectory, 'pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js'))
    ).toBe(true)
    expect(result.totalBytes).toBeGreaterThan(0)
  })

  it('fails before pruning when trace reaches a removable distribution', () => {
    for (const unsafePath of [
      'node_modules/mathjax-full/es5/tex-svg.js',
      'node_modules/pdf-parse/lib/pdf.js/v2.0.550/build/pdf.js',
      'node_modules/exceljs/dist/exceljs.js',
      'node_modules/node-pty/third_party/conpty/conpty.dll'
    ]) {
      expect(() =>
        assertRuntimePruningTrace(
          {
            ...runtimeTrace,
            trace: { files: [...runtimeTrace.trace.files, unsafePath] }
          },
          'darwin'
        )
      ).toThrow('trace reaches')
    }
  })

  it('retains node-pty ConPTY on Windows targets', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-runtime-pruning-'))
    await writeFixture('node-pty/third_party/conpty/conpty.dll')

    pruneRuntimePackages({
      nodeModulesDirectory: temporaryDirectory,
      runtimeTrace,
      platform: 'win32'
    })

    expect(
      fs.existsSync(path.join(temporaryDirectory, 'node-pty/third_party/conpty/conpty.dll'))
    ).toBe(true)
  })
})
