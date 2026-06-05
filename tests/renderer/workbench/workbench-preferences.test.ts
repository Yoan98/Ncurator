import { beforeEach, describe, expect, it } from 'vitest'
import type { LlmRemoteModel, WorkspaceSource } from '../../../src/shared/types'
import {
  readWorkbenchModePreference,
  readWorkbenchModelPreference,
  readWorkbenchWorkspacePreference,
  resolveWorkbenchModelSelection,
  resolveWorkbenchWorkspaceSelection,
  writeWorkbenchModePreference,
  writeWorkbenchModelPreference,
  writeWorkbenchWorkspacePreference
} from '../../../src/renderer/src/components/workbench/utils'

const workspaceFixtures: WorkspaceSource[] = [
  {
    id: 'workspace-1',
    name: '资料库 A',
    created_at: 1,
    updated_at: 1
  },
  {
    id: 'workspace-2',
    name: '资料库 B',
    created_at: 2,
    updated_at: 2
  }
]

const modelFixtures: LlmRemoteModel[] = [
  { id: 'model-a', label: 'Model A' },
  { id: 'model-b', label: 'Model B' }
]

describe('workbench preferences', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('persists mode as ai/search and falls back to ai for invalid values', () => {
    expect(readWorkbenchModePreference(window.localStorage)).toBe('ai')

    writeWorkbenchModePreference(window.localStorage, 'search')
    expect(readWorkbenchModePreference(window.localStorage)).toBe('search')

    window.localStorage.setItem('workbench.preference.mode', 'invalid')
    expect(readWorkbenchModePreference(window.localStorage)).toBe('ai')
  })

  it('restores workspace preference and falls back to the first available workspace', () => {
    writeWorkbenchWorkspacePreference(window.localStorage, 'workspace-2')
    expect(readWorkbenchWorkspacePreference(window.localStorage)).toBe('workspace-2')
    expect(resolveWorkbenchWorkspaceSelection(workspaceFixtures, 'workspace-2')).toBe('workspace-2')

    expect(resolveWorkbenchWorkspaceSelection(workspaceFixtures, 'workspace-missing')).toBe(
      'workspace-1'
    )

    writeWorkbenchWorkspacePreference(window.localStorage, null)
    expect(readWorkbenchWorkspacePreference(window.localStorage)).toBeNull()
  })

  it('restores workbench model preference before default_model and falls back when invalid', () => {
    writeWorkbenchModelPreference(window.localStorage, {
      configId: 'config-1',
      modelName: 'model-b'
    })

    expect(readWorkbenchModelPreference(window.localStorage)).toEqual({
      configId: 'config-1',
      modelName: 'model-b'
    })

    expect(
      resolveWorkbenchModelSelection({
        configId: 'config-1',
        models: modelFixtures,
        defaultModelName: 'model-a',
        preference: readWorkbenchModelPreference(window.localStorage)
      })
    ).toBe('model-b')

    expect(
      resolveWorkbenchModelSelection({
        configId: 'config-2',
        models: modelFixtures,
        defaultModelName: 'model-a',
        preference: readWorkbenchModelPreference(window.localStorage)
      })
    ).toBe('model-a')

    expect(
      resolveWorkbenchModelSelection({
        configId: 'config-1',
        models: [{ id: 'model-a', label: 'Model A' }],
        defaultModelName: 'model-a',
        preference: readWorkbenchModelPreference(window.localStorage)
      })
    ).toBe('model-a')
  })
})
