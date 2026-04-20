import fs from 'node:fs/promises'
import path from 'node:path'
import type { SelectedReference } from '../../../src/shared/types'
import { writeTestDocxFile } from './aiToolHarness'
import type { BackendTestRuntime, SeedKbDocumentInput } from './test-types'

export const HUMAN_FILE_RETENTION_USER_INPUT =
  '我记不清一个细则了。审批没通过的时候，原文件到底要不要保留？你按我刚才选的资料帮我确认一下，直接给我一个明确结论就行。'

export const HUMAN_RISK_REPORT_DRAFT_USER_INPUT =
  '我下午要把本周风险周报发出去。工作区里应该有一份上周用过的 Word 周报模板，但我忘了文件名。你先帮我找到那份模板，再按我刚才选的资料，把本周风险结论和负责人补进去，整理成待确认稿。最后告诉我你改了哪几处，依据分别来自哪里。'

export const DOCX_CROSS_FILE_FIXTURE_PATHS = [
  'tests/fixtures/ai/docx/深度学习.docx',
  'tests/fixtures/ai/docx/图形学.docx'
] as const

export const HUMAN_DOCX_CAUSE_REMEDY_READING_USER_INPUT =
  '我做题老把这两个点混在一起。你就按我刚选的这两份资料，帮我说清楚：过拟合和反走样各自是什么、为什么会出现、一般怎么处理。别补充课外知识，哪份文档没写你就直接说没写。'

export const HUMAN_DOCX_CONTEXTUAL_COMPARISON_DRAFT_USER_INPUT =
  '《图形学》里“反走样”这一节我还是记不住。你参考我刚选的这两份 Word，直接在这一节最后补一小段更好理解的说明，再加个简单对照表，一列写反走样，一列写《深度学习》里的过拟合。直接给我可预览的版本就行，别改原文件，也不用先回我文字草稿。'

export const HUMAN_KB_GUIDED_DOCX_COMPARISON_DRAFT_USER_INPUT =
  '我工作区资料有点多，我忘了是哪份课件在讲反走样了。你先帮我找到那份，再参考讲过拟合的那份资料，直接在“反走样”那一节最后补一段更好记的说明，再加个简单对照表，一列写反走样，一列写过拟合。直接给我可预览的版本就行，别改原文件，也不用先回我文字草稿。'

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

export type KbGuidedDocxWorkspaceSeed = {
  deepLearningPath: string
  deepLearningRelativePath: string
  graphicsPath: string
  graphicsRelativePath: string
  originalDeepLearningBytes: Uint8Array
  originalGraphicsBytes: Uint8Array
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
  fixturePaths: readonly string[] = DOCX_CROSS_FILE_FIXTURE_PATHS
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
  fixturePaths: readonly string[] = DOCX_CROSS_FILE_FIXTURE_PATHS
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

const copyDocxFixtureToWorkspaceRoot = async (input: {
  runtime: BackendTestRuntime
  sourcePath: string
  targetName: string
  summary: string
}): Promise<string> => {
  const absoluteSourcePath = path.resolve(input.sourcePath)
  const targetPath = path.join(input.runtime.workspaceRoot, input.targetName)
  await fs.cp(absoluteSourcePath, targetPath)
  input.runtime.recordSeedWorkspaceFile({
    relativePath: input.targetName,
    absolutePath: targetPath,
    summary: input.summary,
    metadata: {
      format: 'docx'
    }
  })
  return targetPath
}

export const seedKbGuidedDocxWorkspace = async (
  runtime: BackendTestRuntime
): Promise<KbGuidedDocxWorkspaceSeed> => {
  const deepLearningRelativePath = '深度学习.docx'
  const graphicsRelativePath = '图形学.docx'
  const deepLearningPath = await copyDocxFixtureToWorkspaceRoot({
    runtime,
    sourcePath: DOCX_CROSS_FILE_FIXTURE_PATHS[0],
    targetName: deepLearningRelativePath,
    summary: '目标课件：深度学习'
  })
  const graphicsPath = await copyDocxFixtureToWorkspaceRoot({
    runtime,
    sourcePath: DOCX_CROSS_FILE_FIXTURE_PATHS[1],
    targetName: graphicsRelativePath,
    summary: '目标课件：图形学'
  })

  const scheduleRelativePath = '课程安排.docx'
  const schedulePath = await writeTestDocxFile(runtime.workspaceRoot, scheduleRelativePath, [
    {
      type: 'heading',
      text: '课程安排',
      level: 1
    },
    {
      type: 'paragraph',
      text: '这里记录的是考试时间、教室和分组安排。'
    }
  ])
  runtime.recordSeedWorkspaceFile({
    relativePath: scheduleRelativePath,
    absolutePath: schedulePath,
    summary: '干扰项：课程安排',
    metadata: {
      format: 'docx'
    }
  })

  const labNoteRelativePath = '机器学习实验记录.docx'
  const labNotePath = await writeTestDocxFile(runtime.workspaceRoot, labNoteRelativePath, [
    {
      type: 'heading',
      text: '机器学习实验记录',
      level: 1
    },
    {
      type: 'paragraph',
      text: '本周实验主要关注学习率和 batch size 的调参过程。'
    }
  ])
  runtime.recordSeedWorkspaceFile({
    relativePath: labNoteRelativePath,
    absolutePath: labNotePath,
    summary: '干扰项：机器学习实验记录',
    metadata: {
      format: 'docx'
    }
  })

  const readingListRelativePath = '参考书目.md'
  const readingListPath = path.join(runtime.workspaceRoot, readingListRelativePath)
  const readingListText = '- 线性代数导引\n- 计算机图形学基础\n'
  await fs.writeFile(readingListPath, readingListText, 'utf8')
  runtime.recordSeedWorkspaceFile({
    relativePath: readingListRelativePath,
    absolutePath: readingListPath,
    summary: '干扰项：参考书目',
    metadata: {
      format: 'text',
      text: readingListText
    }
  })

  const progressRelativePath = '复习进度.txt'
  const progressPath = path.join(runtime.workspaceRoot, progressRelativePath)
  const progressText = '今天先看图形学，再看深度学习。\n'
  await fs.writeFile(progressPath, progressText, 'utf8')
  runtime.recordSeedWorkspaceFile({
    relativePath: progressRelativePath,
    absolutePath: progressPath,
    summary: '干扰项：复习进度',
    metadata: {
      format: 'text',
      text: progressText
    }
  })

  return {
    deepLearningPath,
    deepLearningRelativePath,
    graphicsPath,
    graphicsRelativePath,
    originalDeepLearningBytes: await fs.readFile(deepLearningPath),
    originalGraphicsBytes: await fs.readFile(graphicsPath)
  }
}

export const seedKbGuidedDocxKb = async (
  runtime: BackendTestRuntime,
  workspaceSeed: KbGuidedDocxWorkspaceSeed
): Promise<string[]> => {
  const kbDocuments: readonly SeedKbDocumentInput[] = [
    {
      id: 'doc-deep-learning',
      name: '深度学习.docx',
      filePath: workspaceSeed.deepLearningPath,
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
      filePath: workspaceSeed.graphicsPath,
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
      id: 'doc-course-schedule',
      name: '课程安排.docx',
      filePath: path.join(runtime.workspaceRoot, '课程安排.docx'),
      chunks: [
        {
          id: 'chunk-course-schedule-1',
          text: '课程安排只记录考试时间、教室和分组信息。'
        }
      ]
    },
    {
      id: 'doc-ml-lab',
      name: '机器学习实验记录.docx',
      filePath: path.join(runtime.workspaceRoot, '机器学习实验记录.docx'),
      chunks: [
        {
          id: 'chunk-ml-lab-1',
          text: '实验记录主要关注学习率和 batch size 的调参过程。'
        }
      ]
    },
    {
      id: 'doc-reading-list',
      name: '参考书目.md',
      filePath: path.join(runtime.workspaceRoot, '参考书目.md'),
      chunks: [
        {
          id: 'chunk-reading-list-1',
          text: '参考书目里只有课程参考资料列表，没有过拟合或反走样的讲解。'
        }
      ]
    }
  ]

  await runtime.seedKb(kbDocuments)
  return kbDocuments.map((document) => document.id)
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
