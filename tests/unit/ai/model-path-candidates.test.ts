import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  listKnownPersistentUserDataPaths,
  listModelPathCandidates
} from '../../../src/main/utils/paths'

describe('ai unit model path candidates', () => {
  it('includes known persistent macOS user data directories', () => {
    const candidates = listKnownPersistentUserDataPaths('darwin', '/Users/tester')

    expect(candidates).toEqual([
      '/Users/tester/Library/Application Support/ncurator',
      '/Users/tester/Library/Application Support/ncurator-desktop'
    ])
  })

  it('prefers the active user data models path and keeps persistent fallbacks', () => {
    const candidates = listModelPathCandidates(
      path.join('/tmp', 'ncurator-user-data'),
      'darwin',
      '/Users/tester',
      '/tmp'
    )

    expect(candidates).toEqual([
      '/Users/tester/Library/Application Support/ncurator/models',
      '/Users/tester/Library/Application Support/ncurator-desktop/models',
      path.join('/tmp', 'ncurator-user-data', 'models')
    ])
  })

  it('keeps the active path first on non-ephemeral user data directories', () => {
    const candidates = listModelPathCandidates(
      '/Users/tester/Library/Application Support/ncurator-desktop',
      'darwin',
      '/Users/tester',
      '/tmp'
    )

    expect(candidates).toEqual([
      '/Users/tester/Library/Application Support/ncurator-desktop/models',
      '/Users/tester/Library/Application Support/ncurator/models'
    ])
  })

  it('returns only the active user data models path on non-darwin platforms', () => {
    const candidates = listModelPathCandidates(
      path.join(os.tmpdir(), 'ncurator-user-data'),
      'linux',
      '/home/tester',
      os.tmpdir()
    )

    expect(candidates).toEqual([path.join(os.tmpdir(), 'ncurator-user-data', 'models')])
  })
})
