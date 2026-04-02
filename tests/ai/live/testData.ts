import fs from 'node:fs/promises'
import path from 'node:path'
import { writeTestDocxFile } from '../../harness/backend/aiToolHarness'
import type { BackendTestRuntime, SeedKbDocumentInput } from '../../harness/backend/test-types'

export const HUMAN_FILE_RETENTION_USER_INPUT =
  '我记不清一个细则了。审批没通过的时候，原文件到底要不要保留？你按我刚才选的资料帮我确认一下，直接给我一个明确结论就行。'

export const DIRECTOR_APPROVAL_REPLY_USER_INPUT =
  '同事刚来问我：审批没通过时原文件该怎么处理。你按我刚才选的资料，直接帮我整理一段两三句话的回复，我转给他就行。'

export const HUMAN_RISK_REPORT_DRAFT_USER_INPUT =
  '我下午要把本周风险周报发出去。工作区里应该有一份上周用过的 Word 周报模板，但我忘了文件名。你先帮我找到那份模板，再按我刚才选的资料，把本周风险结论和负责人补进去，给我一个可预览的版本，先别覆盖原文件。最后告诉我你改了哪几处，依据分别来自哪里。'

export const DIRECTOR_RISK_REPORT_DELIVERY_USER_INPUT =
  '我要把本周风险周报发给老板。你帮我把这件事做完：先根据我刚才选的资料整理出本周风险结论和负责人说明，再在工作区里找到上周那份 Word 周报模板补进去，生成一个可预览版本，最后给我一段交付说明，告诉我预览在哪、你改了什么、依据是什么。原文件先别覆盖。'

export const FILE_RETENTION_DOCUMENTS: readonly SeedKbDocumentInput[] = [
  {
    id: 'doc-retention',
    name: 'Approval Policy.md',
    chunks: [
      {
        id: 'chunk-retention-1',
        text: '审批被拒绝时必须保留现有文件不变。'
      }
    ]
  }
]

export const RISK_REPORT_DOCUMENTS: readonly SeedKbDocumentInput[] = [
  {
    id: 'doc-risk-summary',
    name: 'Weekly Risk Summary.md',
    chunks: [
      {
        id: 'chunk-risk-summary-1',
        text: '本周风险结论：在合规签署前，风险状态保持为“待跟进”。'
      }
    ]
  },
  {
    id: 'doc-risk-owner',
    name: 'Owner Note.md',
    chunks: [
      {
        id: 'chunk-risk-owner-1',
        text: '负责人说明：最终复核窗口由合规负责人 Alice 牵头。'
      }
    ]
  }
]

export type RiskReportWorkspaceSeed = {
  templatePath: string
  templateRelativePath: string
  originalTemplateBytes: Uint8Array
}

export const seedFileRetentionKb = async (runtime: BackendTestRuntime): Promise<string[]> => {
  await runtime.seedKb(FILE_RETENTION_DOCUMENTS)
  return FILE_RETENTION_DOCUMENTS.map((document) => document.id)
}

export const seedRiskReportKb = async (runtime: BackendTestRuntime): Promise<string[]> => {
  await runtime.seedKb(RISK_REPORT_DOCUMENTS)
  return RISK_REPORT_DOCUMENTS.map((document) => document.id)
}

export const seedRiskReportWorkspace = async (
  runtime: BackendTestRuntime
): Promise<RiskReportWorkspaceSeed> => {
  const templateRelativePath = 'weekly-risk-report-template.docx'
  const templatePath = await writeTestDocxFile(runtime.workspaceRoot, templateRelativePath, [
    {
      type: 'heading',
      text: '本周风险周报',
      level: 1
    },
    {
      type: 'paragraph',
      text: '本周风险结论：RISK_TODO'
    },
    {
      type: 'paragraph',
      text: '负责人说明：OWNER_TODO'
    },
    {
      type: 'paragraph',
      text: '备注：本模板用于每周固定汇报。'
    }
  ])

  await writeTestDocxFile(runtime.workspaceRoot, 'team-sync-notes.docx', [
    {
      type: 'heading',
      text: '团队同步纪要',
      level: 1
    },
    {
      type: 'paragraph',
      text: '这里只记录会议纪要，不是周报模板。'
    }
  ])

  await fs.writeFile(
    path.join(runtime.workspaceRoot, 'weekly-risk-summary.txt'),
    '请在找到正式模板后再补全文档内容。\n',
    'utf8'
  )

  const originalTemplateBytes = await fs.readFile(templatePath)

  return {
    templatePath,
    templateRelativePath,
    originalTemplateBytes
  }
}

export const hasUnchangedFileBytes = async (
  filePath: string,
  expectedBytes: Uint8Array
): Promise<boolean> => {
  const currentBytes = await fs.readFile(filePath)
  return Buffer.compare(currentBytes, Buffer.from(expectedBytes)) === 0
}
