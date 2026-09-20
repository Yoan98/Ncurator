import { describe, expect, it } from 'vitest'
import { prepareWorkspacesSequentially } from '../../../../../src/shared/prepareWorkspacesSequentially'

describe('prepareWorkspacesSequentially', () => {
  it('starts the next workspace only after the previous prepare settles', async () => {
    const events: string[] = []
    const results = await prepareWorkspacesSequentially(['ws-a', 'ws-b', 'ws-c'], async (workspaceId) => {
      events.push(`start:${workspaceId}`)
      await Promise.resolve()
      events.push(`end:${workspaceId}`)
      return workspaceId
    })

    expect(results).toEqual(['ws-a', 'ws-b', 'ws-c'])
    expect(events).toEqual([
      'start:ws-a',
      'end:ws-a',
      'start:ws-b',
      'end:ws-b',
      'start:ws-c',
      'end:ws-c'
    ])
  })
})
