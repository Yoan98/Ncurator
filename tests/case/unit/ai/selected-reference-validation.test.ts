import { describe, expect, it } from 'vitest'
import type { AiRunEvent, SelectedReference } from '../../../../src/shared/types'
import { validateSelectedReferencesForRun } from '../../../../src/main/services/sourceScope/validation'

const WORKSPACE_ID = 'workspace-1'
const WORKSPACE_ROOT = '/tmp/ncurator-test-workspace'

const createFileReference = (absolutePath: string): SelectedReference => ({
  kind: 'file',
  workspaceId: WORKSPACE_ID,
  nodeId: 'node-1',
  name: 'evidence.txt',
  relativePath: 'docs/evidence.txt',
  absolutePath,
  kbDocumentIds: ['doc-1'],
  kbAvailability: 'indexed',
  fileExt: '.txt'
})

describe('selected-reference-validation', () => {
  it('allows local references within the current workspace root', async () => {
    const events: AiRunEvent[] = []
    const result = await validateSelectedReferencesForRun({
      references: [createFileReference('/tmp/ncurator-test-workspace/docs/evidence.txt')],
      workspaceStore: {
        getWorkspaceById: async (id) =>
          id === WORKSPACE_ID ? { id: WORKSPACE_ID, root_path: WORKSPACE_ROOT } : null
      },
      webSourceStore: {
        getWebSourceById: async () => null
      },
      sendEvent: (event) => {
        events.push(event)
      },
      runId: 'run-1',
      pathExists: (targetPath) =>
        targetPath === WORKSPACE_ROOT || targetPath === '/tmp/ncurator-test-workspace/docs/evidence.txt'
    })

    expect(result).toEqual({ ok: true })
    expect(events).toHaveLength(0)
  })

  it('rejects local references outside the current workspace root', async () => {
    const events: AiRunEvent[] = []
    const result = await validateSelectedReferencesForRun({
      references: [createFileReference('/tmp/ncurator-other-workspace/docs/evidence.txt')],
      workspaceStore: {
        getWorkspaceById: async (id) =>
          id === WORKSPACE_ID ? { id: WORKSPACE_ID, root_path: WORKSPACE_ROOT } : null
      },
      webSourceStore: {
        getWebSourceById: async () => null
      },
      sendEvent: (event) => {
        events.push(event)
      },
      runId: 'run-2',
      pathExists: (targetPath) =>
        targetPath === WORKSPACE_ROOT || targetPath === '/tmp/ncurator-other-workspace/docs/evidence.txt'
    })

    expect(result).toEqual({ ok: false, error: 'scope unavailable' })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'runtime_issue',
      runId: 'run-2',
      code: 'scope_unavailable',
      workspaceId: WORKSPACE_ID
    })
  })
})
