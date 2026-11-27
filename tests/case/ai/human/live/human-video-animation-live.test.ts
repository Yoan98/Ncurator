import path from 'node:path'
import { describe, it } from 'vitest'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { runElectronMediaScenario } from '../../../../harness/backend/mediaRuntimeRunner'

const CASE_ID = 'human-video-animation-live'
describe('AI media', () => {
  it(
    CASE_ID,
    async () => {
      await runBackendCase({
        caseId: CASE_ID,
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        harnessMode: 'live',
        knowledge: 'none',
        description: '真实生产工具、来源、媒体编码与 Electron 绘图宿主。',
        fixtures: ['tests/fixtures/workspace/media'],
        outputFiles: ['electron-host/evidence.zip', 'electron-host/result.json'],
        runMode: 'single',
        execute: async (runtime) => {
          const result = await runElectronMediaScenario(
            CASE_ID,
            path.join(runtime.workspaceRoot, 'electron-host'),
            runtime.runId,
            path.join(runtime.workspaceRoot, 'media')
          )
          result.events.forEach((event) => runtime.eventCollector.add(event))
          return result
        },
        assert: async (result, runtime) => {
          for (const [name, passed] of Object.entries(result.checks))
            runtime.assertThat(passed, {
              name,
              message: name,
              data: { outputs: result.outputs, diagnostics: result.diagnostics }
            })
        }
      })
    },
    1500000
  )
})
