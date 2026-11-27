import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  readBundleGraph,
  collectRuntimePackageNames
} from '../../../../scripts/build/runtime/bundle-graph.mjs'

describe('runtime bundle import discovery', () => {
  it('traces actual imports while ignoring import examples embedded in engine prompts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ncurator-imports-'))
    try {
      const entry = path.join(root, 'main.js')
      fs.writeFileSync(
        entry,
        `const protocol="import { text } from '@ncurator/drawing'";const x=require('node:fs');require('./worker.js');import('jszip');require.resolve('yaml');`
      )
      fs.writeFileSync(
        path.join(root, 'worker.js'),
        `import semver from 'semver'; export { parse } from 'yaml';`
      )
      const graph = readBundleGraph(entry)
      expect([...graph.externalImports].sort()).toEqual(['jszip', 'node:fs', 'semver', 'yaml'])
      expect(graph.visited.size).toBe(2)
      expect(collectRuntimePackageNames([entry])).toEqual(['jszip', 'semver', 'yaml'])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
