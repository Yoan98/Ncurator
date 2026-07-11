import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  listKnownPersistentUserDataPaths,
  listModelPathCandidates
} from '../../../../src/main/utils/paths'

describe('ai unit model path candidates', () => {
  it('includes known persistent macOS user data directories', () => {
    const homeDir = path.join('/Users', 'tester')
    const candidates = listKnownPersistentUserDataPaths('darwin', homeDir)

    expect(candidates).toEqual([
      path.join(homeDir, 'Library', 'Application Support', 'ncurator'),
      path.join(homeDir, 'Library', 'Application Support', 'ncurator-desktop')
    ])
  })

  it('prefers the active user data models path and keeps persistent fallbacks', () => {
    const homeDir = path.join('/Users', 'tester')
    const candidates = listModelPathCandidates(
      path.join('/tmp', 'ncurator-user-data'),
      'darwin',
      homeDir,
      '/tmp'
    )

    expect(candidates).toEqual([
      path.resolve(path.join(homeDir, 'Library', 'Application Support', 'ncurator', 'models')),
      path.resolve(
        path.join(homeDir, 'Library', 'Application Support', 'ncurator-desktop', 'models')
      ),
      path.resolve(path.join('/tmp', 'ncurator-user-data', 'models'))
    ])
  })

  it('keeps the active path first on non-ephemeral user data directories', () => {
    const homeDir = path.join('/Users', 'tester')
    const activeUserData = path.join(homeDir, 'Library', 'Application Support', 'ncurator-desktop')
    const candidates = listModelPathCandidates(activeUserData, 'darwin', homeDir, '/tmp')

    expect(candidates).toEqual([
      path.resolve(path.join(activeUserData, 'models')),
      path.resolve(path.join(homeDir, 'Library', 'Application Support', 'ncurator', 'models'))
    ])
  })

  it('includes known persistent windows user data directories', () => {
    const homeDir = path.join('C:', 'Users', 'tester')
    const candidates = listKnownPersistentUserDataPaths('win32', homeDir)

    expect(candidates).toEqual([
      path.join(homeDir, 'AppData', 'Roaming', 'ncurator'),
      path.join(homeDir, 'AppData', 'Roaming', 'ncurator-desktop')
    ])
  })

  it('prefers persistent windows models paths for ephemeral user data directories', () => {
    const homeDir = path.join('C:', 'Users', 'tester')
    const candidates = listModelPathCandidates(
      path.join(os.tmpdir(), 'ncurator-user-data'),
      'win32',
      homeDir,
      os.tmpdir()
    )

    expect(candidates).toEqual([
      path.resolve(path.join(homeDir, 'AppData', 'Roaming', 'ncurator', 'models')),
      path.resolve(path.join(homeDir, 'AppData', 'Roaming', 'ncurator-desktop', 'models')),
      path.resolve(path.join(os.tmpdir(), 'ncurator-user-data', 'models'))
    ])
  })

  it('returns only the active user data models path on linux', () => {
    const candidates = listModelPathCandidates(
      path.join(os.tmpdir(), 'ncurator-user-data'),
      'linux',
      '/home/tester',
      os.tmpdir()
    )

    expect(candidates).toEqual([path.join(os.tmpdir(), 'ncurator-user-data', 'models')])
  })
})
