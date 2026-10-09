import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  configureLiveModelThroughSettingsUi,
  createPartnerThroughWorkbenchUi,
  navigateToWorkbench,
  selectWorkbenchModel,
  sendWorkbenchMessage,
  waitForWorkbenchAiRunCompletion,
  loadWorkbenchLiveModelEnv
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'chat-without-knowledge-model'

describe('workbench conversation', () => {
  it(
    CASE_ID,
    async () => {
      const modelsPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-chat-empty-models-'))
      try {
        await runE2ECase({
          caseId: CASE_ID,
          domain: 'workbench',
          suite: 'conversation',
          groups: ['composer'],
          description: '无工作空间、无向量模型仍可完成真实聊天，且不下载或启动 embedding。',
          fixtures: [],
          serviceMode: 'real',
          execution: 'live',
          windowMode: 'background',
          runMode: 'single',
          extraEnv: { NCURATOR_MODELS_PATH: modelsPath },
          execute: async (runtime) => {
            const { page } = runtime
            const target = loadWorkbenchLiveModelEnv()
            await configureLiveModelThroughSettingsUi(page, target)
            await navigateToWorkbench(page)
            await createPartnerThroughWorkbenchUi(page, '普通聊天')
            await selectWorkbenchModel(page, target.modelName)
            const startedAt = Date.now()
            await sendWorkbenchMessage(page, '你好，请用一句话回复我。')
            const evidence = await waitForWorkbenchAiRunCompletion(
              runtime,
              startedAt,
              target.modelName
            )
            const state = await page.evaluate(async () => ({
              embedding: await window.api.getEmbeddingStatus(),
              download: await window.api.getActiveDownload()
            }))
            return {
              state,
              files: await fs.readdir(modelsPath, { recursive: true }),
              completed: evidence.events.some((event) => event.type === 'run_completed')
            }
          },
          assert: async (result, runtime) => {
            await runtime.assertThat(
              result.completed &&
                result.files.length === 0 &&
                result.state.download === null &&
                result.state.embedding.status === 'uninitialized' &&
                result.state.embedding.pid === null,
              {
                name: 'chat-without-knowledge-model',
                message:
                  '真实聊天完成，空模型目录未变化、无下载任务或 embedding 进程，对齐 WB-COMPOSER-001-AC5。',
                data: result
              }
            )
          }
        })
      } finally {
        await fs.rm(modelsPath, { recursive: true, force: true })
      }
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
