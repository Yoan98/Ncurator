import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxHistoryResult, DocxOutlineResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-read-then-history-upgrades-to-replay-session', async () => {
    await runBackendCase({
      caseId: 'docx-read-then-history-upgrades-to-replay-session',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证纯读后调用 docx_history 会升级到 replay session，但仍只返回初始修订。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'history-upgrade.docx', [
          { type: 'paragraph', text: '只有一段原始内容。' }
        ])
        const harness = createDocxToolHarness(runtime)
        try {
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'history-upgrade.docx'
          })
          const history = await harness.invoke<DocxHistoryResult>('docx_history', {
            sourcePath: 'history-upgrade.docx',
            limit: 10
          })
          return {
            outline,
            history,
            readSessionCount: harness.state.readSessionBySourcePath.size,
            replaySessionCount: harness.state.replaySessionBySourcePath.size
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.outline.currentRevisionRef === 'v1' &&
            result.history.currentRevisionRef === 'v1' &&
            result.history.revisions.length === 1 &&
            result.history.revisions[0]?.revisionRef === 'v1' &&
            result.readSessionCount === 0 &&
            result.replaySessionCount === 1,
          {
            name: 'docx-history-upgrades-read-session-without-new-revision',
            message: 'docx_history 在纯读场景下应升级为 replay session，释放旧 read session，但不应伪造额外修订。',
            data: result
          }
        )
      }
    })
  })
})
