import { buildRetrievalTools } from '../../../../src/main/services/ai/human/tools/kb/retrievalTools'
import { docxToolFamily } from '../../../../src/main/services/ai/human/tools/docx'
import { terminalToolFamily } from '../../../../src/main/services/ai/human/tools/terminal'
import { test } from 'vitest'
import { getToolExecutionMeta } from '../../../../src/main/services/ai/human/node/handNode/toolExecutionMeta'
import {
  DOCX_SAVE_TOOL_SPEC,
  DOCX_TOOL_SPECS,
  getDocxToolSpec
} from '../../../../src/main/services/ai/human/tools/docx/toolSpecs'
import {
  buildSkillCatalog,
  getToolContract,
  getToolDescriptor,
  getToolPromptSpec,
  listToolNamesByFamily,
  listToolNamesBySkill,
  TOOL_CATALOG
} from '../../../../src/main/services/ai/human/tools/catalog'
import { DOCX_TOOL_DEFINITIONS } from '../../../../src/main/services/ai/human/tools/catalog/toolDescriptors/docx'
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
    execute: async (runtime) => {
      const ctx = runtime.createAiRunContext()
      const terminalTools = terminalToolFamily.buildTools({
        ctx,
        runId: runtime.runId,
        taskId: runtime.taskId
      })
      const docxTools = docxToolFamily.buildTools({
        ctx,
        runId: runtime.runId,
        taskId: runtime.taskId
      })
      const kbTools = buildRetrievalTools({
        ctx: {
          runId: ctx.runId,
          checkCancelled: ctx.checkCancelled,
          sendEvent: ctx.sendEvent,
          selectedDocumentIds: ctx.selectedDocumentIds,
          documentsStore: ctx.documentsStore,
          embeddingService: ctx.embeddingService
        },
        runId: runtime.runId,
        taskId: runtime.taskId
      })

      const catalogToolNames = sortNames(TOOL_CATALOG.map((descriptor) => descriptor.name))
      const familyToolNames = sortNames([
        ...listToolNamesByFamily('terminal'),
        ...listToolNamesByFamily('kb'),
        ...listToolNamesByFamily('docx')
      ])
      const skillCatalog = buildSkillCatalog().map((item) => ({
        skillId: item.skillId,
        toolNames: sortNames(item.toolNames)
      }))
      const docxSaveMetaArgs = {
        docId: 'doc-save-spec',
        outPath: 'docs/output.docx'
      }

      return {
        catalogToolNames,
        familyToolNames,
        skillCatalog,
        docxSpecNames: sortNames(DOCX_TOOL_SPECS.map((spec) => spec.name)),
        docxDefinitionNames: sortNames(DOCX_TOOL_DEFINITIONS.map((definition) => definition.name)),
        docxSharedSpecLookups: {
          save: getDocxToolSpec('docx_save') === DOCX_SAVE_TOOL_SPEC
        },
        docxSaveSpecContractAlignment: {
          schemaShared: getToolContract('docx_save')?.schema === DOCX_SAVE_TOOL_SPEC.schema,
          promptShared: getToolContract('docx_save')?.promptSpec === DOCX_SAVE_TOOL_SPEC.promptSpec,
          skillIds: [...DOCX_SAVE_TOOL_SPEC.skillIds],
          executionMeta: getToolExecutionMeta({
            toolName: 'docx_save',
            args: docxSaveMetaArgs
          }),
          expectedExecutionMeta: {
            mutability: DOCX_SAVE_TOOL_SPEC.executionMeta.mutability,
            parallelSafe: DOCX_SAVE_TOOL_SPEC.executionMeta.parallelSafe,
            resourceKey:
              DOCX_SAVE_TOOL_SPEC.executionMeta.getResourceKey?.(docxSaveMetaArgs) ||
              DOCX_SAVE_TOOL_SPEC.executionMeta.defaultResourceKey
          }
        },
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
        representativePromptContracts: {
          kbHybridSearch: getToolPromptSpec('kb_hybrid_search_chunks'),
          terminalRun: getToolPromptSpec('terminal_run_command'),
          docxSave: getToolPromptSpec('docx_save')
        },
        representativeToolContracts: {
          kbHybridSearch: getToolContract('kb_hybrid_search_chunks'),
          terminalRun: getToolContract('terminal_run_command'),
          docxSave: getToolContract('docx_save')
        },
        representativeRuntimeSchemas: {
          kbHybridSearch: Reflect.get(
            kbTools.find((tool) => String(tool.name || '').trim() === 'kb_hybrid_search_chunks')!,
            'schema'
          ),
          terminalRun: Reflect.get(
            terminalTools.find((tool) => String(tool.name || '').trim() === 'terminal_run_command')!,
            'schema'
          ),
          docxSave: Reflect.get(
            docxTools.find((tool) => String(tool.name || '').trim() === 'docx_save')!,
            'schema'
          )
        },
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
      runtime.assertThat(result.catalogToolNames.join(',') === result.familyToolNames.join(','), {
        name: 'tool-catalog-family-coverage',
        message:
          'catalog tool names should stay fully aligned with the names exposed through family-level lookups',
        data: result
      })

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

      runtime.assertThat(
        result.docxSpecNames.join(',') === result.docxDefinitionNames.join(',') &&
          result.docxDefinitionNames.join(',') === result.docxFamilyTools.join(',') &&
          result.docxSharedSpecLookups.save,
        {
          name: 'tool-catalog-docx-spec-derivation',
          message:
            'docx catalog definitions should derive directly from the shared docx tool spec source of truth',
          data: {
            docxSpecNames: result.docxSpecNames,
            docxDefinitionNames: result.docxDefinitionNames,
            docxFamilyTools: result.docxFamilyTools,
            docxSharedSpecLookups: result.docxSharedSpecLookups
          }
        }
      )

      runtime.assertThat(
        result.docxSaveSpecContractAlignment.schemaShared &&
          result.docxSaveSpecContractAlignment.promptShared &&
          result.docxSaveSpecContractAlignment.skillIds.join(',') === 'docx-delivery' &&
          JSON.stringify(result.docxSaveSpecContractAlignment.executionMeta) ===
            JSON.stringify(result.docxSaveSpecContractAlignment.expectedExecutionMeta),
        {
          name: 'tool-catalog-docx-save-spec-alignment',
          message:
            'docx_save contract metadata should stay sourced from the shared docx tool spec after the refactor',
          data: result.docxSaveSpecContractAlignment
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
        result.representativePromptContracts.kbHybridSearch?.args[0]?.name === 'queryText' &&
          result.representativePromptContracts.kbHybridSearch?.examples?.[0]?.args.queryText ===
            'approval denied terminal artifact requirement' &&
          result.representativePromptContracts.terminalRun?.args[0]?.name === 'command' &&
          result.representativePromptContracts.docxSave?.args.some(
            (arg) => arg.name === 'outPath' && arg.required
          ),
        {
          name: 'tool-catalog-prompt-contract-drift',
          message:
            'representative prompt specs should keep required args and example payloads aligned with the centralized catalog contract',
          data: result.representativePromptContracts
        }
      )

      runtime.assertThat(
        result.representativeToolContracts.kbHybridSearch?.schema ===
          result.representativeRuntimeSchemas.kbHybridSearch &&
          result.representativeToolContracts.terminalRun?.schema ===
            result.representativeRuntimeSchemas.terminalRun &&
          result.representativeToolContracts.docxSave?.schema ===
            result.representativeRuntimeSchemas.docxSave,
        {
          name: 'tool-catalog-runtime-schema-source',
          message:
            'representative runtime tools should expose the same schema objects stored on the centralized tool contracts',
          data: {
            representativeToolContracts: result.representativeToolContracts,
            representativeRuntimeSchemas: result.representativeRuntimeSchemas
          }
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
