import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  getLanceDbPath,
  getModelsPath,
  getSqliteDbPath,
  getUserDataPath
} from '../../../../src/main/utils/paths'

describe('ai unit path resolution', () => {
  it('resolves user data paths when called instead of at module load time', () => {
    const original = process.env.NCURATOR_USER_DATA_PATH
    const firstPath = path.join(os.tmpdir(), 'ncurator-paths-first')
    const secondPath = path.join(os.tmpdir(), 'ncurator-paths-second')

    try {
      process.env.NCURATOR_USER_DATA_PATH = firstPath
      expect(getUserDataPath()).toBe(firstPath)
      expect(getSqliteDbPath()).toBe(path.join(firstPath, 'app.sqlite'))
      expect(getLanceDbPath()).toBe(path.join(firstPath, 'lancedb'))

      process.env.NCURATOR_USER_DATA_PATH = secondPath
      expect(getUserDataPath()).toBe(secondPath)
    } finally {
      if (original === undefined) {
        delete process.env.NCURATOR_USER_DATA_PATH
      } else {
        process.env.NCURATOR_USER_DATA_PATH = original
      }
    }
  })

  it('resolves models path under the active user data directory', () => {
    const originalUserDataPath = process.env.NCURATOR_USER_DATA_PATH
    const originalModelsPath = process.env.NCURATOR_MODELS_PATH
    const userDataPath = path.join(os.tmpdir(), 'ncurator-user-data')

    try {
      process.env.NCURATOR_USER_DATA_PATH = userDataPath
      delete process.env.NCURATOR_MODELS_PATH
      expect(getModelsPath()).toBe(path.join(userDataPath, 'models'))
    } finally {
      if (originalUserDataPath === undefined) {
        delete process.env.NCURATOR_USER_DATA_PATH
      } else {
        process.env.NCURATOR_USER_DATA_PATH = originalUserDataPath
      }
      if (originalModelsPath === undefined) {
        delete process.env.NCURATOR_MODELS_PATH
      } else {
        process.env.NCURATOR_MODELS_PATH = originalModelsPath
      }
    }
  })

  it('prefers the NCURATOR_MODELS_PATH override', () => {
    const originalModelsPath = process.env.NCURATOR_MODELS_PATH
    const customModelsPath = path.join(os.tmpdir(), 'ncurator-custom-models')

    try {
      process.env.NCURATOR_MODELS_PATH = customModelsPath
      expect(getModelsPath()).toBe(path.resolve(customModelsPath))
    } finally {
      if (originalModelsPath === undefined) {
        delete process.env.NCURATOR_MODELS_PATH
      } else {
        process.env.NCURATOR_MODELS_PATH = originalModelsPath
      }
    }
  })

  it('falls back to a stable tmp directory outside electron', () => {
    const originalUserDataPath = process.env.NCURATOR_USER_DATA_PATH
    const originalModelsPath = process.env.NCURATOR_MODELS_PATH

    try {
      delete process.env.NCURATOR_USER_DATA_PATH
      delete process.env.NCURATOR_MODELS_PATH
      expect(getUserDataPath()).toBe(path.join(os.tmpdir(), 'ncurator-user-data'))
      expect(getModelsPath()).toBe(path.join(os.tmpdir(), 'ncurator-user-data', 'models'))
    } finally {
      if (originalUserDataPath === undefined) {
        delete process.env.NCURATOR_USER_DATA_PATH
      } else {
        process.env.NCURATOR_USER_DATA_PATH = originalUserDataPath
      }
      if (originalModelsPath === undefined) {
        delete process.env.NCURATOR_MODELS_PATH
      } else {
        process.env.NCURATOR_MODELS_PATH = originalModelsPath
      }
    }
  })
})
