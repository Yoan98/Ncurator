import fs from 'node:fs/promises'
import path from 'node:path'
import type { SelectedReference } from '../../../src/shared/types'
import { writeTestDocxFile } from './aiToolHarness'
import type { BackendTestRuntime, SeedKbDocumentInput } from './test-types'

export const HUMAN_FILE_RETENTION_USER_INPUT =
  '我记不清一个细则了。审批没通过的时候，原文件到底要不要保留？你按我刚才选的资料帮我确认一下，直接给我一个明确结论就行。'

export const HUMAN_RISK_REPORT_DRAFT_USER_INPUT =
  '我下午要把本周风险周报发出去。工作区里应该有一份上周用过的 Word 周报模板，但我忘了文件名。你先帮我找到那份模板，再按我刚才选的资料，把本周风险结论和负责人补进去，整理成待确认稿。最后告诉我你改了哪几处，依据分别来自哪里。'

export const DOCX_READING_FIXTURE_PATHS = [
  'tests/fixtures/ai/docx/深度学习.docx',
  'tests/fixtures/ai/docx/图形学.docx'
] as const

export const DOCX_MULTI_EDIT_FIXTURE_PATHS = [
  'tests/fixtures/ai/docx/人工智能探究课堂PRD.docx',
  'tests/fixtures/ai/docx/交互式探究学习案例：产业转移.docx'
] as const

export const DOCX_ALL_FIXTURE_PATHS = [
  ...DOCX_READING_FIXTURE_PATHS,
  ...DOCX_MULTI_EDIT_FIXTURE_PATHS,
  'tests/fixtures/ai/docx/sample-edit.docx'
] as const

export const HUMAN_DOCX_CAUSE_REMEDY_READING_USER_INPUT =
  '我这两天复习的时候老把这两个概念混了。你就按我刚选的这两份课件，帮我讲清楚：过拟合和反走样分别是什么、为什么会出现、一般怎么处理。别自己补课外内容，哪份资料没写你就直接告诉我没写。'

export const HUMAN_DOCX_MULTI_DOC_SUPPORTED_EDIT_USER_INPUT =
  '我在整理这版课堂方案，想把主稿里那段交互设计说明写得更落地一点。你参考我刚选的那份案例文档，把对应章节补得更清楚一些，再顺手加一个很短的对照表，方便老师一眼看懂重点。'

export const HUMAN_DOCX_POSITIONED_STRUCTURAL_EDIT_FALLBACK_USER_INPUT =
  '我准备把这份图形学讲义发给同学复习，想把“反走样”这部分补得更容易记一些。你参考我选的那份深度学习资料，在这一节后面补一个类比说明和简短对照表。'

export const HUMAN_KB_GUIDED_DOCX_COMPARISON_DRAFT_USER_INPUT =
  '我工作区里这几份课件和教学材料有点多，你别先靠文件名猜，直接在知识库里帮我找哪两份在讲反走样和过拟合。找到以后先看一遍，再把里面最适合老师讲“概念区分”的内容分别补到课堂 PRD 和交互式案例里，写法尽量像备课备注和课堂引导语，不要像教材摘抄。'

export const HUMAN_KB_GUIDED_DOCX_READING_USER_INPUT =
  '我工作区里应该有两份课件分别讲过过拟合和反走样，但我忘了文件名。你先帮我找出来，再告诉我这两个问题一般怎么处理。'

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

export type SelectedDocxFixture = {
  sourcePath: string
  workspacePath: string
  relativePath: string
  name: string
}

export type TrackedDocxFixtureBytes = SelectedDocxFixture & {
  bytes: Uint8Array
}

export type KbGuidedDocxWorkspaceSeed = {
  sourceDocs: SelectedDocxFixture[]
  targetDocs: SelectedDocxFixture[]
  trackedDocs: TrackedDocxFixtureBytes[]
}

export const seedFileRetentionKb = async (runtime: BackendTestRuntime): Promise<string[]> => {
  await runtime.seedKb(FILE_RETENTION_DOCUMENTS)
  return FILE_RETENTION_DOCUMENTS.map((document) => document.id)
}

export const seedRiskReportKb = async (runtime: BackendTestRuntime): Promise<string[]> => {
  await runtime.seedKb(RISK_REPORT_DOCUMENTS)
  return RISK_REPORT_DOCUMENTS.map((document) => document.id)
}

export const resolveSelectedDocxFixtures = (
  runtime: BackendTestRuntime,
  fixturePaths: readonly string[] = DOCX_READING_FIXTURE_PATHS
): SelectedDocxFixture[] =>
  fixturePaths.map((fixturePath) => {
    const workspacePath = runtime.getFixtureWorkspacePath(fixturePath)
    return {
      sourcePath: fixturePath,
      workspacePath,
      relativePath: path.relative(runtime.workspaceRoot, workspacePath),
      name: path.basename(workspacePath)
    }
  })

export const buildSelectedDocxFixtureReferences = (
  runtime: BackendTestRuntime,
  fixturePaths: readonly string[] = DOCX_READING_FIXTURE_PATHS
): SelectedReference[] =>
  resolveSelectedDocxFixtures(runtime, fixturePaths).map((fixture, index) => ({
    kind: 'file',
    workspaceId: 'test-workspace',
    nodeId: `fixture-docx-${String(index + 1)}`,
    name: fixture.name,
    relativePath: fixture.relativePath,
    absolutePath: fixture.workspacePath,
    fileExt: '.docx',
    kbDocumentIds: [],
    kbAvailability: 'not_indexed'
  }))

export const captureDocxFixtureBytes = async (
  runtime: BackendTestRuntime,
  fixturePaths: readonly string[]
): Promise<TrackedDocxFixtureBytes[]> =>
  await Promise.all(
    resolveSelectedDocxFixtures(runtime, fixturePaths).map(async (fixture) => ({
      ...fixture,
      bytes: await fs.readFile(fixture.workspacePath)
    }))
  )

export const buildKbGuidedDocxWorkspaceSeed = async (
  runtime: BackendTestRuntime
): Promise<KbGuidedDocxWorkspaceSeed> => ({
  sourceDocs: resolveSelectedDocxFixtures(runtime, DOCX_READING_FIXTURE_PATHS),
  targetDocs: resolveSelectedDocxFixtures(runtime, DOCX_MULTI_EDIT_FIXTURE_PATHS),
  trackedDocs: await captureDocxFixtureBytes(runtime, DOCX_ALL_FIXTURE_PATHS)
})

export const seedKbGuidedDocxKb = async (
  runtime: BackendTestRuntime,
  workspaceSeed: KbGuidedDocxWorkspaceSeed
): Promise<string[]> => {
  const kbDocuments: readonly SeedKbDocumentInput[] = [
    {
      id: 'doc-deep-learning',
      name: '深度学习.docx',
      filePath: workspaceSeed.sourceDocs[0]?.workspacePath,
      chunks: [
        {
          id: 'chunk-deep-learning-1',
          text: '过度拟合是模型记住了过多训练数据中的特征值，使训练后的模型只对这部分训练数据有效，不太具有展望性。'
        },
        {
          id: 'chunk-deep-learning-2',
          text: '当训练时间过久时，会逐渐记住过多训练数据中的特征值，从而出现过度拟合。'
        },
        {
          id: 'chunk-deep-learning-3',
          text: '缓解过度拟合的思路包括：使用训练时未使用过的数据做验证，以及通过数据增强把同一图像拆成不同亮度、旋转方向等多张图像来训练。'
        }
      ]
    },
    {
      id: 'doc-graphics',
      name: '图形学.docx',
      filePath: workspaceSeed.sourceDocs[1]?.workspacePath,
      chunks: [
        {
          id: 'chunk-graphics-1',
          text: '反走样出现的原因是采样频率低于信号频率。'
        },
        {
          id: 'chunk-graphics-2',
          text: '由于一个像素可能同时落在图形边界内和边界外，边缘会出现锯齿。'
        },
        {
          id: 'chunk-graphics-3',
          text: '反走样的处理思路包括：在一个像素内模拟多个采样点，或者先把图形转换成信号后做低通滤波。'
        }
      ]
    },
    {
      id: 'doc-ai-prd',
      name: '人工智能探究课堂PRD.docx',
      filePath: workspaceSeed.targetDocs.find((doc) => doc.name === '人工智能探究课堂PRD.docx')
        ?.workspacePath,
      chunks: [
        {
          id: 'chunk-ai-prd-1',
          text: '人工智能探究课堂产品 PRD 支持讲授式、交互探究式和小组协作式三种课堂学习模式。'
        },
        {
          id: 'chunk-ai-prd-2',
          text: '统一设计原则包括：单一页面沉浸式体验、过程可视化、AI 不替代思考、结果可沉淀。'
        }
      ]
    },
    {
      id: 'doc-interactive-case',
      name: '交互式探究学习案例：产业转移.docx',
      filePath: workspaceSeed.targetDocs.find(
        (doc) => doc.name === '交互式探究学习案例：产业转移.docx'
      )?.workspacePath,
      chunks: [
        {
          id: 'chunk-interactive-case-1',
          text: '产业转移探究案例强调情境引入、证据分析、规律归纳、迁移应用，并通过 AI 发起、学生活动、AI 即时反馈来推进环节。'
        },
        {
          id: 'chunk-interactive-case-2',
          text: '案例要求把复杂概念拆成可执行的探究步骤，让学生通过判断、解释和迁移应用学懂知识点。'
        }
      ]
    },
    {
      id: 'doc-sample-edit',
      name: 'sample-edit.docx',
      filePath: resolveSelectedDocxFixtures(runtime, ['tests/fixtures/ai/docx/sample-edit.docx'])[0]
        ?.workspacePath,
      chunks: [
        {
          id: 'chunk-sample-edit-1',
          text: 'sample-edit.docx 只是一个简单编辑样例，不包含过拟合或反走样的课程内容。'
        }
      ]
    }
  ]

  const validDocuments = kbDocuments.filter((document) => typeof document.filePath === 'string')
  await runtime.seedKb(validDocuments)
  return validDocuments.map((document) => document.id)
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
