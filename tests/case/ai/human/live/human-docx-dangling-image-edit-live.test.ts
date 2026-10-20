import { assertRunFileReviews } from '../../../../harness/backend/fileReviewAssertions'
import fs from 'node:fs/promises'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import JSZip from 'jszip'
import { describe, it } from 'vitest'
import {
  buildDocumentNodeIndex,
  loadDocxBundle
} from '../../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/nodeIndex'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { createAiServiceTestRunner } from '../../../../harness/backend/aiServiceHarness'
import { buildSelectedDocxFixtureReferences } from '../../../../harness/backend/aiLiveTestData'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

// 原件来源：https://www.fzcl.gov.cn/xjwz/ztzl/jczwgk/sdly/bzxzf/gkqk/fgzc/202503/t20250326_4994804.htm
const FIXTURE_PATH = 'tests/fixtures/workspace/申请公租房“高效办成一件事”操作指引.docx' as const
const USER_INPUT =
  '请阅读这份 申请公租房“高效办成一件事”操作指引及其中的实际截图。在文末追加一节“实施工时估算”，用表格分别评估用户登录、主题引导、条件预检、材料上传、办件进度查询这五项功能的实现时间，每行明确使用人天、人日、工作日、小时或天作为单位，并简述依据。保留全部原文和原有表格。最后说明实际可读取的截图展示了什么操作流程。'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const REQUIREMENTS = ['用户登录', '主题引导', '条件预检', '材料上传', '办件进度查询']

const readDocxContents = async (filePath: string) => {
  const bundle = await loadDocxBundle(await fs.readFile(filePath))
  const paragraphs = buildDocumentNodeIndex(bundle)
    .outline.filter((node) => node.type === 'paragraph' && node.text.trim())
    .map((node) => node.text)
  const rows = Array.from(bundle.documentDom.getElementsByTagNameNS(WORD_NS, 'tr')).map((row) =>
    Array.from(row.getElementsByTagNameNS(WORD_NS, 't'))
      .map((text) => text.textContent || '')
      .join(' ')
  )
  return { text: paragraphs.join('\n'), paragraphs, rows }
}

const countDurationEstimates = (text: string): number =>
  text.match(/\d+(?:\.\d+)?(?:\s*[-~至到]\s*\d+(?:\.\d+)?)?\s*(?:人天|人日|工作日|小时|天)/g)
    ?.length || 0

const damageImageRelationship = async (filePath: string): Promise<string> => {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath))
  const part = 'word/_rels/document.xml.rels'
  const xml = await zip.file(part)?.async('text')
  if (!xml) throw new Error('The source document has no image relationships')
  const dom = new DOMParser().parseFromString(xml, 'application/xml')
  const relationship = Array.from(dom.getElementsByTagName('Relationship')).find((item) =>
    item.getAttribute('Type')?.endsWith('/image')
  )
  const originalTarget = relationship?.getAttribute('Target')
  if (!relationship || !originalTarget) throw new Error('The source document has no image')
  relationship.setAttribute('Target', 'NULL')
  zip.file(part, new XMLSerializer().serializeToString(dom))
  await fs.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }))
  return originalTarget
}

describe('ai human live backend', () => {
  it('human-docx-dangling-image-edit-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-docx-dangling-image-edit-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '验证 live 模型可处理操作手册副本中的 NULL 图片关系，并根据真实流程追加工时表。',
        fixtures: [FIXTURE_PATH],
        runMode: 'single',
        execute: async (runtime) => {
          const primaryConfig = loadLiveLlmConfigFromEnv()
          await runtime.seedLlmConfig(primaryConfig)
          const reference = buildSelectedDocxFixtureReferences(runtime, [FIXTURE_PATH])[0]!
          const filePath = reference.absolutePath || ''
          const damagedImageTarget = await damageImageRelationship(filePath)
          const source = await readDocxContents(filePath)
          const runner = await createAiServiceTestRunner(runtime, {
            selectedReferences: [reference],
            streamingModeOverride: 'force_non_stream',
            userInput: USER_INPUT
          })
          const output = await runner.run()
          await assertRunFileReviews(runtime, output)
          const applyRecord = (
            await runtime.storageService.aiFileChange.listRecords({ runId: runtime.runId })
          ).items.find((item) => item.path === reference.absolutePath && item.status === 'applied')
          const applied = applyRecord
            ? await readDocxContents(filePath)
            : { text: '', paragraphs: [], rows: [] }
          return {
            output,
            events: runtime.eventCollector.snapshot(),
            source,
            applied,
            damagedImageTarget
          }
        },
        assert: async (result, runtime) => {
          const events = result.events
          const toolStarts = filterAiRunEventsByType(events, 'tool_call_started')
          const toolNames = toolStarts.map((event) => event.toolName)
          const docxEditSucceeded = filterAiRunEventsByType(events, 'tool_call_result').some(
            (event) => event.toolName === 'docx_content_edit' && event.result?.ok === true
          )
          const estimatedRequirements = REQUIREMENTS.filter((requirement) =>
            result.applied.rows.some(
              (row) =>
                row.replace(/\s+/g, '').includes(requirement) && countDurationEstimates(row) > 0
            )
          )
          const sourcePreserved = result.source.paragraphs.every((paragraph) =>
            result.applied.text.includes(paragraph)
          )

          runtime.assertThat(
            result.output?.status === 'completed' &&
              toolNames.includes('docx_read_outline') &&
              toolNames.some((name) => name === 'docx_read_nodes' || name === 'docx_search') &&
              toolNames.includes('read_image') &&
              docxEditSucceeded &&
              result.output?.finalArtifacts?.some(
                (item) => item.kind === 'file' && item.capability === 'docx'
              ) === true &&
              result.applied.text.includes('实施工时估算') &&
              estimatedRequirements.length === REQUIREMENTS.length &&
              sourcePreserved,
            {
              name: 'human-live-edits-dangling-image-docx-with-all-estimates',
              message:
                'live human 应容忍副本中的损坏图片，读取其余真实截图，保留原文并追加五项功能的有效工时表。',
              data: {
                toolNames,
                docxEditSucceeded,
                sourcePreserved,
                damagedImageTarget: result.damagedImageTarget,
                estimatedRequirements,
                artifacts: result.output?.finalArtifacts
              }
            }
          )
        }
      })
    })
  }, 1_800_000)
})
