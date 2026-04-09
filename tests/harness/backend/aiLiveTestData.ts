import fs from 'node:fs/promises'
import path from 'node:path'
import { writeTestDocxFile } from './aiToolHarness'
import type { BackendTestRuntime, SeedKbDocumentInput } from './test-types'

export const HUMAN_FILE_RETENTION_USER_INPUT =
  '我记不清一个细则了。审批没通过的时候，原文件到底要不要保留？你按我刚才选的资料帮我确认一下，直接给我一个明确结论就行。'

export const HUMAN_RISK_REPORT_DRAFT_USER_INPUT =
  '我下午要把本周风险周报发出去。工作区里应该有一份上周用过的 Word 周报模板，但我忘了文件名。你先帮我找到那份模板，再按我刚才选的资料，把本周风险结论和负责人补进去，给我一个可预览的版本，先别覆盖原文件。最后告诉我你改了哪几处，依据分别来自哪里。'

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
  const templateBlocks = [
    {
      type: 'heading' as const,
      text: '本周风险周报',
      level: 1
    },
    {
      type: 'paragraph' as const,
      text: '本周风险结论：RISK_TODO'
    },
    {
      type: 'paragraph' as const,
      text: '负责人说明：OWNER_TODO'
    },
    {
      type: 'paragraph' as const,
      text: '备注：本模板用于每周固定汇报。'
    }
  ]
  const notesBlocks = [
    {
      type: 'heading' as const,
      text: '团队同步纪要',
      level: 1
    },
    {
      type: 'paragraph' as const,
      text: '这里只记录会议纪要，不是周报模板。'
    }
  ]
  const summaryRelativePath = 'weekly-risk-summary.txt'
  const summaryText = '请在找到正式模板后再补全文档内容。\n'
  const templateRelativePath = 'weekly-risk-report-template.docx'
  const templatePath = await writeTestDocxFile(runtime.workspaceRoot, templateRelativePath, templateBlocks)
  runtime.recordSeedWorkspaceFile({
    relativePath: templateRelativePath,
    absolutePath: templatePath,
    summary: '风险周报模板 docx',
    metadata: {
      format: 'docx',
      blocks: templateBlocks
    }
  })

  const notesRelativePath = 'team-sync-notes.docx'
  const notesPath = await writeTestDocxFile(runtime.workspaceRoot, notesRelativePath, notesBlocks)
  runtime.recordSeedWorkspaceFile({
    relativePath: notesRelativePath,
    absolutePath: notesPath,
    summary: '干扰项会议纪要 docx',
    metadata: {
      format: 'docx',
      blocks: notesBlocks
    }
  })

  const summaryPath = path.join(runtime.workspaceRoot, summaryRelativePath)
  await fs.writeFile(summaryPath, summaryText, 'utf8')
  runtime.recordSeedWorkspaceFile({
    relativePath: summaryRelativePath,
    absolutePath: summaryPath,
    summary: '风险摘要提示文本',
    metadata: {
      format: 'text',
      text: summaryText
    }
  })

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
