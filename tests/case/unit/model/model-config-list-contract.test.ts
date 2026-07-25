import { describe, it } from 'vitest'
import type { LLMConfig } from '../../../../src/shared/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

const MODEL_FIXTURES: readonly LLMConfig[] = [
  {
    id: 'model-openai',
    name: '公司 OpenAI',
    providerKind: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key: 'sk-openai'
  },
  {
    id: 'model-deepseek',
    name: 'DeepSeek 配置',
    providerKind: 'deepseek',
    base_url: 'https://api.deepseek.com',
    api_key: 'sk-deepseek'
  }
]

describe('settings model backend', () => {
  it('model-config-list-contract', async () => {
    await runBackendCase({
      caseId: 'model-config-list-contract',
      harnessMode: 'tool-real',
      domain: 'unit',
      suite: 'model',
      description: '模型连接配置列表查询可返回全部可用服务配置。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        for (const config of MODEL_FIXTURES) {
          await runtime.storageService.llm.save(config)
        }

        const list = await runtime.storageService.llm.list()

        return {
          listIds: list.map((item) => item.id).sort(),
          names: list.map((item) => item.name).sort(),
          baseUrls: list.map((item) => item.base_url).sort(),
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
              '模型连接配置查询应返回全部配置，不需要额外刷新即可支撑首屏初始化，对齐 SET-MODEL-001-AC1。',
            data: result
          }
        )

        runtime.assertThat(
          JSON.stringify(result.providerKinds) === JSON.stringify(['deepseek', 'openai']) &&
            result.baseUrls.includes('https://api.openai.com/v1') &&
            result.baseUrls.includes('https://api.deepseek.com'),
          {
            name: 'model-config-list-preserves-connection-fields',
            message:
              '模型连接配置查询应保留模型服务和地址信息，用于 Settings 列表和运行时连接选择。',
            data: result
          }
        )

        runtime.assertThat(
          JSON.stringify(result.names) === JSON.stringify(['DeepSeek 配置', '公司 OpenAI']),
          {
            name: 'model-config-list-preserves-config-names',
            message: '配置列表应保留用户填写的配置名称，用于工作台模型选择按配置分组。',
            data: result
          }
        )
      }
    })
  })
})
