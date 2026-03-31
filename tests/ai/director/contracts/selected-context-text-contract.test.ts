import { describe, it } from 'vitest'
import { buildHumanBrainPrompt } from '../../../../src/main/services/ai/human/prompts/brain'
import { buildSelectedContextText } from '../../../../src/main/services/ai/utils/runContext'
import type { SelectedReference } from '../../../../src/shared/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

const SELECTED_REFERENCES: SelectedReference[] = [
  {
    kind: 'directory',
    workspaceId: 'workspace-1',
    nodeId: 'dir-prd',
    name: 'PRD',
    relativePath: 'docs/prd',
    absolutePath: '/tmp/ncurator/docs/prd',
    kbDocumentIds: ['doc-a'],
    kbAvailability: 'partial',
    indexedFileCount: 1,
    notIndexedFileCount: 1
  },
  {
    kind: 'file',
    workspaceId: 'workspace-1',
    nodeId: 'file-a',
    name: 'a.docx',
    relativePath: 'docs/prd/a.docx',
    absolutePath: '/tmp/ncurator/docs/prd/a.docx',
    fileExt: 'docx',
    kbDocumentIds: [],
    kbAvailability: 'not_indexed'
  },
  {
    kind: 'web',
    webSourceId: 'web-1',
    name: '发布规范',
    url: 'https://example.com/release-guide',
    kbDocumentIds: ['web-doc-1'],
    kbAvailability: 'indexed'
  }
]

describe('ai director contracts backend', () => {
  it('selected-context-text-contract', async () => {
    await runBackendCase({
      caseId: 'selected-context-text-contract',
      domain: 'ai',
      suite: 'director',
      groups: ['contracts'],
      description: '验证 selectedContextText 的固定结构，以及 brain prompt 直接复用该文本而不再拼旧的范围摘要。',
      fixtures: [],
      runMode: 'single',
      execute: async () => {
        const explicitSelectedContextText = buildSelectedContextText({
          workspace: {
            workspaceId: 'workspace-1',
            workspaceName: 'NCurator',
            rootPath: '/tmp/ncurator'
          },
          selectedReferences: SELECTED_REFERENCES,
          usesWorkspaceDefaultKbScope: false
        })

        const workspaceDefaultSelectedContextText = buildSelectedContextText({
          workspace: {
            workspaceId: 'workspace-1',
            workspaceName: 'NCurator',
            rootPath: '/tmp/ncurator'
          },
          selectedReferences: undefined,
          usesWorkspaceDefaultKbScope: true
        })

        const prompt = buildHumanBrainPrompt({
          userInput: '请基于当前资料整理结果。',
          memorySnapshotText: 'none',
          selectedContextText: explicitSelectedContextText,
          skillContextText: 'none',
          recentToolResultsText: 'none',
          recentDecisionHistoryText: 'none',
          watchHintText: 'none'
        })

        return {
          explicitSelectedContextText,
          workspaceDefaultSelectedContextText,
          promptUser: prompt.user
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.explicitSelectedContextText.includes(
            '当前工作区：NCurator（本地工作目录），后续本地文件路径都相对于这个工作区理解。'
          ) &&
            result.explicitSelectedContextText.includes('参考资料类型说明：') &&
            result.explicitSelectedContextText.includes('1. [本地目录] docs/prd') &&
            result.explicitSelectedContextText.includes('2. [本地文件] docs/prd/a.docx') &&
            result.explicitSelectedContextText.includes('3. [网页资料] 发布规范') &&
            result.explicitSelectedContextText.includes('知识库可用性：部分可检索') &&
            result.explicitSelectedContextText.includes('知识库可用性：未索引') &&
            result.explicitSelectedContextText.includes('知识库可用性：已索引'),
          {
            name: 'selected-context-text-includes-workspace-types-and-user-selection',
            message:
              'selectedContextText 应固定包含工作区背景、参考资料类型说明和当前用户选择列表，并使用 kbAvailability 的产品文案。',
            data: {
              explicitSelectedContextText: result.explicitSelectedContextText
            }
          }
        )

        runtime.assertThat(
          result.workspaceDefaultSelectedContextText.includes(
            '当前用户选择：未显式选择目录、文件或网页资料；本轮默认使用当前工作区中已索引文件作为本地检索范围。'
          ),
          {
            name: 'workspace-only-mode-explains-default-local-kb-scope',
            message:
              '方案 B 下，当用户只绑定工作区但未显式选择 reference 时，selectedContextText 应明确表达默认使用当前工作区已索引文件。',
            data: {
              workspaceDefaultSelectedContextText: result.workspaceDefaultSelectedContextText
            }
          }
        )

        runtime.assertThat(
          result.promptUser.includes('<selected_context>') &&
            result.promptUser.includes(result.explicitSelectedContextText) &&
            !result.promptUser.includes('<run_constraints>'),
          {
            name: 'brain-prompt-reuses-selected-context-text-directly',
            message:
              'brain prompt 应直接复用统一的 selectedContextText，不再额外拼旧的 run constraints 或范围摘要标签。',
            data: {
              promptUser: result.promptUser
            }
          }
        )
      }
    })
  })
})
