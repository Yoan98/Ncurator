import { describe, it } from 'vitest'
import type { LLMConfig } from '../../../src/shared/types'
import { runBackendCase } from '../../harness/backend/run-backend-case'

const MODEL_FIXTURES: readonly LLMConfig[] = [
  {
    id: 'model-active',
    name: '当前模型',
    providerKind: 'openai',
    base_url: 'https://api.openai.com/v1',
    model_name: 'gpt-4o',
    api_key: 'sk-active',
    is_active: true
  },
  {
    id: 'model-standby',
    name: '备用模型',
    providerKind: 'openai',
    base_url: 'https://api.openai.com/v1',
    model_name: 'gpt-4o-mini',
    api_key: 'sk-standby',
    is_active: false
  }
]

describe('settings model backend', () => {
  it('model-config-list-contract', async () => {
    await runBackendCase({
      caseId: 'model-config-list-contract',
      harnessMode: 'tool-real',
      domain: 'settings',
      suite: 'model',
      description: '模型配置列表查询可返回全部配置，并唯一识别当前激活配置。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        for (const config of MODEL_FIXTURES) {
          await runtime.storageService.llm.save(config)
        }

        const list = await runtime.storageService.llm.list()
        const activeConfig = await runtime.storageService.llm.getActive()

        return {
          listIds: list.map((item) => item.id).sort(),
          activeIds: list.filter((item) => item.is_active).map((item) => item.id),
          activeConfigId: activeConfig?.id || null,
          activeConfigModel: activeConfig?.model_name || null,
          providerKinds: list.map((item) => item.providerKind).sort()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          JSON.stringify(result.listIds) ===
            JSON.stringify(MODEL_FIXTURES.map((item) => item.id).sort()),
          {
            name: 'model-config-list-includes-all-configs',
            message:
              '模型配置查询应返回全部配置，不需要额外刷新即可支撑首屏初始化，对齐 SET-MODEL-001-AC1。',
            data: result
          }
        )

        runtime.assertThat(
          JSON.stringify(result.providerKinds) === JSON.stringify(['openai', 'openai']),
          {
            name: 'model-config-list-preserves-provider-kind',
            message:
              '模型配置查询应保留 providerKind，用于选择服务商适配和缓存命中统计。',
            data: result
          }
        )

        runtime.assertThat(
          result.activeIds.length === 1 &&
            result.activeIds[0] === 'model-active' &&
            result.activeConfigId === 'model-active' &&
            result.activeConfigModel === 'gpt-4o',
          {
            name: 'model-config-list-identifies-single-active-config',
            message:
              '配置列表中应存在唯一当前激活配置，并能直接支撑摘要当前态识别，对齐 SET-MODEL-001-AC2。',
            data: result
          }
        )
      }
    })
  })
})
