import { test } from 'vitest'
import { aiRunStateContractSchema } from '../../../../src/main/services/ai/schema'
import { createDirectorRunStateSchema } from '../../../../src/main/services/ai/director/state/schema'
import { createInitialAiRunState, createDefaultAiRunStateFields } from '../../../../src/main/services/ai/utils/state'
import { createHumanRunStateSchema } from '../../../../src/main/services/ai/human/state/schema'
import {
  applyOpsSchema,
  docOpSchema,
  paragraphSpecSchema
} from '../../../../src/main/services/ai/human/tools/docx/schemas'
import type {
  DocxOp,
  DocxParagraphSpec
} from '../../../../src/main/services/ai/human/tools/docx/types'
import { humanStateContractSchema } from '../../../../src/main/services/ai/human/schema'
import type { HumanState } from '../../../../src/main/services/ai/human/types'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/utils/state'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

type DirectorSchemaFields = {
  status: { parse: (value: unknown) => string }
  directorStage: { parse: (value: unknown) => string }
  contextRounds: { parse: (value: unknown) => number }
  contextEvidence: { parse: (value: unknown) => string[] }
  plan: { parse: (value: unknown) => unknown[] }
  dispatchCursor: { parse: (value: unknown) => number }
  finalArtifacts: { parse: (value: unknown) => unknown[] }
}

type HumanSchemaFields = {
  task: { parse: (value: unknown) => HumanState['task'] }
  runtime: { parse: (value: unknown) => HumanState['runtime'] }
  brainMemory: { parse: (value: unknown) => HumanState['brainMemory'] }
  trace: { parse: (value: unknown) => HumanState['trace'] }
}

test('contract-alignment', async () => {
  await runBackendCase({
    caseId: 'contract-alignment',
    caseType: 'basic',
    domain: 'ai',
    layer: 'backend',
    suite: 'human',
    description:
      'AI run contract, human contract, schema defaults, and docx input contracts stay aligned after schema-centralized refactor.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      const directorDefaults = createDefaultAiRunStateFields()
      const directorSchemaFields = Reflect.get(
        createDirectorRunStateSchema(),
        'fields'
      ) as DirectorSchemaFields
      const humanSchemaFields = Reflect.get(
        createHumanRunStateSchema(),
        'fields'
      ) as HumanSchemaFields

      const aiState = createInitialAiRunState({
        runId: runtime.runId,
        sessionId: 'test-session',
        input: '验证 AI contract 对齐'
      })
      const humanState = createInitialHumanState({
        taskId: runtime.taskId,
        userInput: '验证 human contract 对齐'
      })

      const paragraph: DocxParagraphSpec = {
        kind: 'paragraph',
        runs: [{ text: '段落内容' }]
      }
      const op: DocxOp = {
        type: 'insert_after',
        anchorBlockId: 'block-1',
        content: [paragraph]
      }

      return {
        directorDefaults,
        directorSchemaDefaults: {
          status: directorSchemaFields.status.parse(undefined),
          directorStage: directorSchemaFields.directorStage.parse(undefined),
          contextRounds: directorSchemaFields.contextRounds.parse(undefined),
          contextEvidence: directorSchemaFields.contextEvidence.parse(undefined),
          plan: directorSchemaFields.plan.parse(undefined),
          dispatchCursor: directorSchemaFields.dispatchCursor.parse(undefined),
          finalArtifacts: directorSchemaFields.finalArtifacts.parse(undefined)
        },
        humanSchemaDefaults: {
          task: humanSchemaFields.task.parse(undefined),
          runtime: humanSchemaFields.runtime.parse(undefined),
          brainMemory: humanSchemaFields.brainMemory.parse(undefined),
          trace: humanSchemaFields.trace.parse(undefined)
        },
        parsedAiState: aiRunStateContractSchema.parse(aiState),
        parsedHumanState: humanStateContractSchema.parse(humanState),
        parsedParagraph: paragraphSpecSchema.parse(paragraph),
        parsedDocOp: docOpSchema.parse(op),
        parsedApplyOps: applyOpsSchema.parse({
          docId: 'doc-1',
          ops: [op]
        })
      }
    },
    assert: async (result, runtime) => {
      runtime.assertThat(
        result.directorSchemaDefaults.status === result.directorDefaults.status &&
          result.directorSchemaDefaults.directorStage === result.directorDefaults.directorStage &&
          result.directorSchemaDefaults.contextRounds === result.directorDefaults.contextRounds &&
          result.directorSchemaDefaults.contextEvidence.length ===
            result.directorDefaults.contextEvidence.length &&
          result.directorSchemaDefaults.plan.length === result.directorDefaults.plan.length &&
          result.directorSchemaDefaults.dispatchCursor === result.directorDefaults.dispatchCursor &&
          result.directorSchemaDefaults.finalArtifacts.length ===
            result.directorDefaults.finalArtifacts.length,
        {
          name: 'director-contract-defaults',
          message:
            'director schema defaults should stay aligned with the shared AI run state factory defaults',
          data: {
            directorDefaults: result.directorDefaults,
            directorSchemaDefaults: result.directorSchemaDefaults
          }
        }
      )

      runtime.assertThat(
        result.humanSchemaDefaults.task.taskId === '' &&
          result.humanSchemaDefaults.runtime.stage === 'brain' &&
          result.humanSchemaDefaults.runtime.status === 'running' &&
          result.humanSchemaDefaults.brainMemory.outside.skillCatalog.length > 0 &&
          result.humanSchemaDefaults.trace.steps.length === 0,
        {
          name: 'human-contract-defaults',
          message:
            'human schema defaults should still match the shared initial state shape after schema centralization',
          data: result.humanSchemaDefaults
        }
      )

      runtime.assertThat(
        result.parsedAiState.runId === runtime.runId &&
          result.parsedHumanState.task.taskId === runtime.taskId,
        {
          name: 'contract-schema-parse',
          message: 'AI run and human contract schemas should parse the shared factory states',
          data: {
            parsedAiState: result.parsedAiState,
            parsedHumanState: result.parsedHumanState
          }
        }
      )

      runtime.assertThat(
        result.parsedParagraph.runs[0]?.text === '段落内容' &&
          result.parsedDocOp.type === 'insert_after' &&
          result.parsedApplyOps.ops.length === 1,
        {
          name: 'docx-contract-parse',
          message:
            'docx paragraph and operation contracts should stay aligned between exported types and input schemas',
          data: {
            parsedParagraph: result.parsedParagraph,
            parsedDocOp: result.parsedDocOp,
            parsedApplyOps: result.parsedApplyOps
          }
        }
      )
    }
  })
})
