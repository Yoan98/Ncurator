import path from 'node:path'
import { describe, test } from 'vitest'
import { buildDocxCapabilityTools } from '../../../../src/main/services/ai/tools/docx/docxTools'
import { recordAssertion } from '../../../harness/main/assertions'
import { runCapabilityCase } from '../../../harness/main/capabilityCase'

const FIXTURE_SOURCE = path.resolve(process.cwd(), 'tests/fixtures/main/docx/sample-edit.docx')

type JsonRecord = Record<string, unknown>

const asRecord = (value: unknown): JsonRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as JsonRecord
}

const asString = (value: unknown): string => {
  return String(value || '')
}

const asBoolean = (value: unknown): boolean => {
  return value === true
}

describe('capability/docx', () => {
  test('docx_apply_ops replace_text should update content', async () => {
    await runCapabilityCase({
      caseId: 'docx-apply-ops-replace-text',
      description:
        '验证 docx 打开、搜索、replace_text、保存、校验的组合链路，并输出结构化报告。',
      expectedOutcome: 'success',
      scenarioTags: ['docx', 'edit-flow', 'replace-text'],
      requiredFixtures: [FIXTURE_SOURCE],
      fixtureCopies: [{ from: FIXTURE_SOURCE, to: 'input.docx' }],
      buildExecutionOutcome: (result) => {
        const save = asRecord(result.saveResult)
        const validate = asRecord(result.validateResult)
        const validateCode = asString(validate.code)
        const saveCode = asString(save.code)
        const resultCode = validateCode || saveCode || 'unknown'
        return {
          status: resultCode === 'ok' ? 'completed' : 'failed',
          resultCode,
          summary: `save=${saveCode || 'unknown'}, validate=${validateCode || 'unknown'}`
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

        const getTool = (name: string) => {
          const found = built.tools.find((item) => String(item.name) === name)
          if (!found) throw new Error(`tool not found: ${name}`)
          return found
        }

        const openResult = asRecord(await getTool('docx_open').invoke({ sourcePath: 'input.docx' }))
        const docId = asString(openResult.docId)

        const beforeSearch = asRecord(
          await getTool('docx_search').invoke({
            docId,
            query: 'Hello',
            mode: 'literal'
          })
        )
        const applyResult = asRecord(
          await getTool('docx_apply_ops').invoke({
            docId,
            ops: [
              {
                type: 'replace_text',
                query: 'Hello',
                replace: 'Hi',
                replaceAll: true
              }
            ]
          })
        )
        const newDocId = asString(applyResult.newDocId)
        const afterSearch = asRecord(
          await getTool('docx_search').invoke({
            docId: newDocId,
            query: 'Hi',
            mode: 'literal'
          })
        )
        const saveResult = asRecord(
          await getTool('docx_save').invoke({
            docId: newDocId,
            outPath: 'output.docx'
          })
        )
        const validateResult = asRecord(await getTool('docx_validate').invoke({ docId: newDocId }))

        return {
          openResult,
          beforeSearch,
          applyResult,
          afterSearch,
          saveResult,
          validateResult
        }
      },
      assert: async (result, runtime) => {
        const beforeMatches = asRecord(result.beforeSearch).matches
        const afterMatches = asRecord(result.afterSearch).matches
        const problems = asRecord(result.validateResult).problems

        recordAssertion(runtime.assertions, {
          id: 'open.ok',
          pass: asBoolean(result.openResult.ok),
          details: asString(result.openResult.error)
        })
        recordAssertion(runtime.assertions, {
          id: 'search.before.has-match',
          pass: Array.isArray(beforeMatches) && beforeMatches.length > 0,
          details: `before match count: ${Array.isArray(beforeMatches) ? beforeMatches.length : 0}`
        })
        recordAssertion(runtime.assertions, {
          id: 'apply.ok',
          pass: asBoolean(result.applyResult.ok),
          details: asString(result.applyResult.error)
        })
        recordAssertion(runtime.assertions, {
          id: 'search.after.has-match',
          pass: Array.isArray(afterMatches) && afterMatches.length > 0,
          details: `after match count: ${Array.isArray(afterMatches) ? afterMatches.length : 0}`
        })
        recordAssertion(runtime.assertions, {
          id: 'save.ok',
          pass: asBoolean(result.saveResult.ok),
          details: asString(result.saveResult.error)
        })
        recordAssertion(runtime.assertions, {
          id: 'validate.ok',
          pass: asBoolean(result.validateResult.ok),
          details: Array.isArray(problems) ? `problems: ${problems.length}` : 'validate problems missing'
        })
      }
    })
  })
})
