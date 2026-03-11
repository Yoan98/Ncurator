import path from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { describe, expect, test } from 'vitest'
import { buildDocxCapabilityTools } from '../../../../src/main/services/ai/tools/docx/docxTools'
import { recordAssertion } from '../../../harness/main/assertions'
import { runCapabilityCase } from '../../../harness/main/capabilityCase'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const FIXTURE_SOURCE = path.resolve(process.cwd(), 'tests/fixtures/main/docx/sample-edit.docx')

const SEMANTIC_CASE_ID = 'docx-search-semantic-explicit-gap'
const PREVIEW_CASE_ID = 'docx-preview-format-explicit-gap'

type JsonScalar = string | number | boolean | null

type JsonValue = JsonScalar | JsonRecord | JsonValue[]

type JsonRecord = {
  [key: string]: JsonValue
}

const asRecord = (value: JsonValue | undefined): JsonRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as JsonRecord
}

const asString = (value: JsonValue | undefined): string => {
  return String(value || '')
}

const asBoolean = (value: JsonValue | undefined): boolean => {
  return value === true
}

const asStringArray = (value: JsonValue | undefined): string[] => {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === 'string').map((item) => String(item))
}

const getToolByName = (tools: StructuredToolInterface[], name: string): StructuredToolInterface => {
  const found = tools.find((item) => String(item.name) === name)
  if (!found) throw new Error(`tool not found: ${name}`)
  return found
}

describe('capability/docx explicit gap', () => {
  test('docx_search semantic mode should be tracked as explicit capability gap', async () => {
    await runCapabilityCase({
      caseId: SEMANTIC_CASE_ID,
      description: '验证 docx_search semantic 模式未实现时输出显式能力缺口证据。',
      expectedOutcome: 'explicit_gap',
      scenarioTags: ['docx', 'explicit-gap', 'semantic-search'],
      requiredFixtures: [FIXTURE_SOURCE],
      fixtureCopies: [{ from: FIXTURE_SOURCE, to: 'input.docx' }],
      buildExecutionOutcome: (result) => {
        const code = asString(asRecord(result.semanticSearchResult).code) || 'unknown'
        return {
          status: code === 'ok' ? 'completed' : 'failed',
          resultCode: code,
          summary: asString(asRecord(result.semanticSearchResult).error)
        }
      },
      execute: async (runtime) => {
        const built = buildDocxCapabilityTools({
          ctx: runtime.ctx,
          runId: runtime.runId,
          taskId: runtime.taskId,
          workspaceRootPath: runtime.workspaceRoot,
          safePreviewChars: 1400,
          emitActivity: (activity) => {
            runtime.ctx.sendEvent({
              type: 'activity',
              runId: runtime.runId,
              taskId: runtime.taskId,
              activityId: `activity-${Date.now().toString(36)}`,
              actionType: activity.actionType,
              status: activity.status,
              summary: activity.summary,
              createdAt: Date.now()
            })
          }
        })

        const openTool = getToolByName(built.tools, 'docx_open')
        const searchTool = getToolByName(built.tools, 'docx_search')

        const openResult = asRecord((await openTool.invoke({ sourcePath: 'input.docx' })) as JsonValue)
        const docId = asString(openResult.docId)
        const semanticSearchResult = asRecord(
          (await searchTool.invoke({
            docId,
            query: 'semantic test',
            mode: 'semantic'
          })) as JsonValue
        )

        return {
          openResult,
          semanticSearchResult
        }
      },
      assert: async (result, runtime) => {
        const warnings = asStringArray(asRecord(result.semanticSearchResult).warnings)
        recordAssertion(runtime.assertions, {
          id: 'docx.semantic.open-ok',
          pass: asBoolean(asRecord(result.openResult).ok),
          details: asString(asRecord(result.openResult).error)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.semantic.mode-invalid-input',
          pass:
            asBoolean(asRecord(result.semanticSearchResult).ok) === false &&
            asString(asRecord(result.semanticSearchResult).code) === 'invalid_input',
          details: JSON.stringify(asRecord(result.semanticSearchResult))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.semantic.mode-warning-present',
          pass: warnings.some((warning) => warning.includes('future release')),
          details: warnings.join('; ')
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-capability', SEMANTIC_CASE_ID)
    expect(report.assertions.caseStatus).toBe('passed')
    expect(report.metrics.executionStatus).toBe('failed')
    expect(report.metrics.executionResultCode).toBe('invalid_input')
    expect(report.signals.expectedOutcome).toBe('explicit_gap')
  })

  test('docx_render_preview png/pdf should be tracked as explicit capability gap', async () => {
    await runCapabilityCase({
      caseId: PREVIEW_CASE_ID,
      description: '验证 docx_render_preview 对 png/pdf 的受限行为，并标记显式能力缺口。',
      expectedOutcome: 'explicit_gap',
      scenarioTags: ['docx', 'explicit-gap', 'preview-format'],
      requiredFixtures: [FIXTURE_SOURCE],
      fixtureCopies: [{ from: FIXTURE_SOURCE, to: 'input.docx' }],
      buildExecutionOutcome: (result) => {
        const pngCode = asString(asRecord(result.pngPreviewResult).code) || 'unknown'
        return {
          status: pngCode === 'ok' ? 'completed' : 'failed',
          resultCode: pngCode,
          summary: `png=${pngCode}, pdf=${asString(asRecord(result.pdfPreviewResult).code) || 'unknown'}`
        }
      },
      execute: async (runtime) => {
        const built = buildDocxCapabilityTools({
          ctx: runtime.ctx,
          runId: runtime.runId,
          taskId: runtime.taskId,
          workspaceRootPath: runtime.workspaceRoot,
          safePreviewChars: 1400,
          emitActivity: (activity) => {
            runtime.ctx.sendEvent({
              type: 'activity',
              runId: runtime.runId,
              taskId: runtime.taskId,
              activityId: `activity-${Date.now().toString(36)}`,
              actionType: activity.actionType,
              status: activity.status,
              summary: activity.summary,
              createdAt: Date.now()
            })
          }
        })

        const openTool = getToolByName(built.tools, 'docx_open')
        const previewTool = getToolByName(built.tools, 'docx_render_preview')

        const openResult = asRecord((await openTool.invoke({ sourcePath: 'input.docx' })) as JsonValue)
        const docId = asString(openResult.docId)
        const pngPreviewResult = asRecord(
          (await previewTool.invoke({
            docId,
            format: 'png'
          })) as JsonValue
        )
        const pdfPreviewResult = asRecord(
          (await previewTool.invoke({
            docId,
            format: 'pdf'
          })) as JsonValue
        )

        return {
          openResult,
          pngPreviewResult,
          pdfPreviewResult
        }
      },
      assert: async (result, runtime) => {
        recordAssertion(runtime.assertions, {
          id: 'docx.preview-gap.open-ok',
          pass: asBoolean(asRecord(result.openResult).ok),
          details: asString(asRecord(result.openResult).error)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.preview-gap.png-invalid-input',
          pass:
            asBoolean(asRecord(result.pngPreviewResult).ok) === false &&
            asString(asRecord(result.pngPreviewResult).code) === 'invalid_input' &&
            asString(asRecord(result.pngPreviewResult).error).includes('not implemented'),
          details: JSON.stringify(asRecord(result.pngPreviewResult))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.preview-gap.pdf-invalid-input',
          pass:
            asBoolean(asRecord(result.pdfPreviewResult).ok) === false &&
            asString(asRecord(result.pdfPreviewResult).code) === 'invalid_input' &&
            asString(asRecord(result.pdfPreviewResult).error).includes('not implemented'),
          details: JSON.stringify(asRecord(result.pdfPreviewResult))
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-capability', PREVIEW_CASE_ID)
    expect(report.assertions.caseStatus).toBe('passed')
    expect(report.metrics.executionResultCode).toBe('invalid_input')
    expect(report.signals.expectedOutcome).toBe('explicit_gap')
    expect(report.metrics.fileArtifactCount).toBe(0)
  })
})
