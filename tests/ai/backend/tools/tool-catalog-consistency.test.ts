import { test } from 'vitest'
import { buildSkillCatalog } from '../../../../src/main/services/ai/human/node/learningNode/skillRegistry'
import { getToolExecutionMeta } from '../../../../src/main/services/ai/human/node/handNode/toolExecutionMeta'
import { getToolPromptSpec } from '../../../../src/main/services/ai/human/prompts/toolPrompts'
import { DOCX_TOOL_PROMPT_SPECS } from '../../../../src/main/services/ai/human/prompts/toolPromptSpecs/docx'
import { KB_TOOL_PROMPT_SPECS } from '../../../../src/main/services/ai/human/prompts/toolPromptSpecs/kb'
import { TERMINAL_TOOL_PROMPT_SPECS } from '../../../../src/main/services/ai/human/prompts/toolPromptSpecs/terminal'
import {
  getToolDescriptor,
  listToolNamesByFamily,
  listToolNamesBySkill,
  TOOL_CATALOG
} from '../../../../src/main/services/ai/human/tools/toolCatalog'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

const sortNames = (values: string[]): string[] =>
  [...values].sort((left, right) => left.localeCompare(right))

test('tool-catalog-consistency', async () => {
  await runBackendCase({
    caseId: 'tool-catalog-consistency',
    caseType: 'basic',
    domain: 'ai',
    layer: 'backend',
    suite: 'tools',
    groups: ['catalog'],
    description:
      'tool catalog should stay aligned with skill bindings, prompt specs, and execution metadata after catalog centralization.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async () => {
      const catalogToolNames = sortNames(TOOL_CATALOG.map((descriptor) => descriptor.name))
      const promptToolNames = sortNames([
        ...Object.keys(DOCX_TOOL_PROMPT_SPECS),
        ...Object.keys(KB_TOOL_PROMPT_SPECS),
        ...Object.keys(TERMINAL_TOOL_PROMPT_SPECS)
      ])
      const skillCatalog = buildSkillCatalog().map((item) => ({
        skillId: item.skillId,
        toolNames: sortNames(item.toolNames)
      }))

      return {
        catalogToolNames,
        promptToolNames,
        skillCatalog,
        promptLookups: catalogToolNames.map((toolName) => ({
          toolName,
          promptSpec: getToolPromptSpec(toolName)
        })),
        promptCloneIntegrity: (() => {
          const firstLookup = getToolPromptSpec('kb_hybrid_search_chunks')
          if (firstLookup) {
            firstLookup.args[0].name = 'mutated-query'
          }
          const secondLookup = getToolPromptSpec('kb_hybrid_search_chunks')
          const descriptor = getToolDescriptor('kb_hybrid_search_chunks')
          return {
            secondLookup,
            descriptor
          }
        })(),
        docxFamilyTools: sortNames(listToolNamesByFamily('docx')),
        terminalReadMeta: getToolExecutionMeta({
          toolName: 'terminal_run_command',
          args: {
            command: 'cat README.md',
            cwd: '.'
          }
        }),
        terminalWriteMeta: getToolExecutionMeta({
          toolName: 'terminal_run_command',
          args: {
            command: 'printf \"hello\" > report.txt',
            cwd: '.'
          }
        }),
        docxDeliverySkillTools: sortNames(listToolNamesBySkill('docx-delivery'))
      }
    },
    assert: async (result, runtime) => {
      runtime.assertThat(
        result.catalogToolNames.join(',') === result.promptToolNames.join(','),
        {
          name: 'tool-catalog-prompt-coverage',
          message:
            'catalog tool names and prompt spec tool names should stay fully aligned with no missing or orphan prompt specs',
          data: result
        }
      )

      runtime.assertThat(
        result.skillCatalog.every(
          (item) =>
            item.toolNames.length > 0 &&
            item.toolNames.join(',') === sortNames(listToolNamesBySkill(item.skillId)).join(',')
        ),
        {
          name: 'tool-catalog-skill-coverage',
          message:
            'every runtime skill should derive its toolNames from the centralized tool catalog after registry refactor',
          data: result.skillCatalog
        }
      )

      runtime.assertThat(result.promptLookups.every((item) => item.promptSpec !== null), {
        name: 'tool-catalog-prompt-lookups',
        message: 'every catalog tool should resolve a prompt spec through the shared lookup helper',
        data: result.promptLookups
      })

      runtime.assertThat(
        result.promptCloneIntegrity.secondLookup?.args[0]?.name === 'queryText' &&
          result.promptCloneIntegrity.descriptor?.promptSpec.args[0]?.name === 'queryText',
        {
          name: 'tool-catalog-prompt-clone-integrity',
          message:
            'prompt lookups should clone from the centralized descriptor without mutating the shared catalog definition',
          data: result.promptCloneIntegrity
        }
      )

      runtime.assertThat(
        result.terminalReadMeta.mutability === 'read_only' &&
          result.terminalReadMeta.parallelSafe &&
          result.terminalWriteMeta.mutability === 'mutating' &&
          !result.terminalWriteMeta.parallelSafe,
        {
          name: 'tool-catalog-execution-meta',
          message:
            'terminal execution metadata should still distinguish read-only and mutating commands after catalog centralization',
          data: {
            terminalReadMeta: result.terminalReadMeta,
            terminalWriteMeta: result.terminalWriteMeta
          }
        }
      )

      runtime.assertThat(
        result.docxFamilyTools.join(',') ===
          'docx_apply_ops,docx_get_block,docx_get_history,docx_open,docx_outline,docx_render_preview,docx_rollback,docx_save,docx_search,docx_validate' &&
          result.docxDeliverySkillTools.join(',') ===
            'docx_render_preview,docx_save,docx_validate',
        {
          name: 'tool-catalog-family-bindings',
          message:
            'family-level and skill-level tool filters should both come from the centralized catalog after the tool metadata refactor',
          data: {
            docxFamilyTools: result.docxFamilyTools,
            docxDeliverySkillTools: result.docxDeliverySkillTools
          }
        }
      )
    }
  })
})
