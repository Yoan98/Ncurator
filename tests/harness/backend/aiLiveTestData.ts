import fs from 'node:fs/promises'
import path from 'node:path'
import type { SelectedReference } from '../../../src/shared/types'
import { writeTestDocxFile } from './aiToolHarness'
import type { BackendTestRuntime, SeedKbDocumentInput } from './test-types'

export const HUMAN_RISK_REPORT_DRAFT_USER_INPUT =
  '我下午要把本周风险周报发出去。工作区里应该有一份上周用过的 Word 周报模板，但我忘了文件名。你先帮我找到那份模板，再根据工作区里的现有材料，把本周风险结论和负责人补进去，整理成待确认稿。最后告诉我你改了哪几处，依据分别来自哪里。'

export const DOCX_READING_FIXTURE_PATHS = [
  'tests/fixtures/ai/docx/深度学习.docx',
  'tests/fixtures/ai/docx/图形学.docx'
] as const

export const DOCX_POSITIONED_FIXTURE_PATHS = ['tests/fixtures/ai/docx/图形学.docx'] as const

export const DOCX_MULTI_EDIT_FIXTURE_PATHS = [
  'tests/fixtures/ai/docx/人工智能探究课堂PRD.docx',
  'tests/fixtures/ai/docx/交互式探究学习案例：产业转移.docx'
] as const

export const DOCX_CROSS_SOURCE_SUMMARY_FIXTURE_PATHS = DOCX_READING_FIXTURE_PATHS

export const DOCX_CROSS_SOURCE_SUMMARY_REPORT_RELATIVE_PATH = '深度学习与图形学复习总结.docx'

export const DOCX_ALL_FIXTURE_PATHS = [
  ...DOCX_READING_FIXTURE_PATHS,
  ...DOCX_MULTI_EDIT_FIXTURE_PATHS,
  'tests/fixtures/ai/docx/sample-edit.docx'
] as const

export const HUMAN_DOCX_CAUSE_REMEDY_READING_USER_INPUT =
  '我这两天复习的时候老把这两个概念混了。你就按我刚选的这两份课件，帮我讲清楚：过拟合和反走样分别是什么、为什么会出现、一般怎么处理。别自己补课外内容，哪份资料没写你就直接告诉我没写。'

export const HUMAN_DOCX_MULTI_DOC_SUPPORTED_EDIT_USER_INPUT =
  '我在整理这版课堂方案，想把主稿里那段交互设计说明写得更落地一点。你参考我刚选的那份案例文档，把对应章节补得更清楚一些，再顺手加一个很短的对照表，方便老师一眼看懂重点。'

export const HUMAN_DOCX_CROSS_SOURCE_SUMMARY_USER_INPUT =
  '帮我基于我刚选的这两个文件，生成一个给同学复习用的总结文件。里面把关键概念、出现原因和常见处理方式整理清楚。'

export const HUMAN_DOCX_POSITIONED_STRUCTURAL_EDIT_FALLBACK_USER_INPUT =
  '我准备把这份图形学讲义发给同学复习，想把“反走样”这一节补得更容易记一些。你直接在这一节后面加一段更通俗的说明，再加一个很短的总结表，帮助大家快速区分两种常见做法。'

export const HUMAN_KB_GUIDED_DOCX_COMPARISON_DRAFT_USER_INPUT =
  '我想把反走样和过拟合有关的内容整理进两份教学文档里，将适合老师讲“概念区分”的内容分别补到课堂 PRD 和交互式案例里，写法尽量像备课备注和课堂引导语，不要像教材摘抄。'

export const HUMAN_KB_GUIDED_DOCX_READING_USER_INPUT =
  '我工作区里应该有两份课件分别讲过过拟合和反走样，但我忘了文件名。你先帮我找出来，再告诉我这两个问题一般怎么处理。'

export type RiskReportWorkspaceSeed = {
  templatePath: string
  templateRelativePath: string
  riskSummaryRelativePath: string
  ownerNoteRelativePath: string
  expectedRiskConclusion: string
  expectedOwnerSummary: string
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

export const buildSelectedDocxReferences = (
  fixtures: readonly SelectedDocxFixture[]
): SelectedReference[] =>
  fixtures.map((fixture, index) => ({
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

export const buildSelectedDocxFixtureReferences = (
  runtime: BackendTestRuntime,
  fixturePaths: readonly string[] = DOCX_READING_FIXTURE_PATHS
): SelectedReference[] =>
  buildSelectedDocxReferences(resolveSelectedDocxFixtures(runtime, fixturePaths))

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
  const expectedRiskConclusion = '在合规签署前，风险状态保持为“待跟进”。'
  const expectedOwnerSummary = '最终复核窗口由合规负责人 Alice 牵头。'
  const templateBlocks = [
    {
      type: 'heading' as const,
      text: '本周风险周报',
      level: 1
    },
    {
      type: 'paragraph' as const,
      text: '适用场景：每周对外同步项目交付风险，提交前请按最新材料补齐结论和责任人。'
    },
    {
      type: 'heading' as const,
      text: '一、风险概览',
      level: 2
    },
    {
      type: 'paragraph' as const,
      text: '本周风险结论：RISK_TODO'
    },
    {
      type: 'paragraph' as const,
      text: '补充说明：如状态仍未收口，请保留一句话解释当前卡点。'
    },
    {
      type: 'heading' as const,
      text: '二、责任人与动作',
      level: 2
    },
    {
      type: 'paragraph' as const,
      text: '负责人说明：OWNER_TODO'
    },
    {
      type: 'paragraph' as const,
      text: '下一步动作：请在发出前确认责任人和最终复核窗口表述一致。'
    },
    {
      type: 'heading' as const,
      text: '三、备注',
      level: 2
    },
    {
      type: 'paragraph' as const,
      text: '备注：本模板用于每周固定汇报，归档前请勿删除历史说明。'
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
      text: '今天同步了供应商接口、法务签署和预算排期。'
    },
    {
      type: 'paragraph' as const,
      text: '这里只记录会议纪要，不是周报模板，也不作为最终口径。'
    }
  ]
  const archivedReportBlocks = [
    {
      type: 'heading' as const,
      text: '上周已发版风险周报（归档）',
      level: 1
    },
    {
      type: 'paragraph' as const,
      text: '说明：本文件为上周已发送版本，仅供归档回看，不要直接复用。'
    },
    {
      type: 'paragraph' as const,
      text: '本周风险结论：供应商接口风险已解除。'
    },
    {
      type: 'paragraph' as const,
      text: '负责人说明：由交付经理 Kevin 完成收口。'
    }
  ]

  const templateRelativePath = 'weekly-risk-report-template.docx'
  const archivedReportRelativePath = 'weekly-risk-report-2026-04-18-final.docx'
  const notesRelativePath = 'team-sync-notes.docx'
  const riskSummaryRelativePath = 'weekly-risk-summary.md'
  const ownerNoteRelativePath = 'owner-note.md'
  const summaryHintRelativePath = 'weekly-risk-summary.txt'
  const milestonesRelativePath = 'project-milestones.md'
  const vendorFollowupRelativePath = 'vendor-followup.txt'

  const riskSummaryText = `# 本周风险结论整理

背景：
- 合规签署尚未完成，供应商仍在补充最后一版附件。
- 对外口径需要和法务、交付两侧保持一致，不能提前写成“已解除”。

建议写法：
- 本周风险结论：${expectedRiskConclusion}
- 备注建议：强调当前卡点仍在合规签署完成前的最终确认。
`
  const ownerNoteText = `# 负责人说明

请在周报中使用以下责任人口径：
- ${expectedOwnerSummary}
- 财务接口人 Bob 负责补齐付款材料，但不作为最终 owner 对外同步。

补充：
- 如需说明动作分工，可以把 Bob 写在下一步动作，不要写进负责人主句。
`
  const summaryHintText = '请在找到正式模板后再补全文档内容。\n'
  const milestonesText = `# 项目里程碑追踪

- 05/02：完成供应商补件
- 05/03：安排合规复核窗口
- 05/05：准备周报外发
`
  const vendorFollowupText = `供应商跟进记录：
- 已补齐接口清单
- 待补最后一份合规附件
- 该文件仅用于内部追踪，不直接作为周报结论
`

  const writeWorkspaceTextFile = async (
    relativePath: string,
    text: string,
    summary: string
  ): Promise<string> => {
    const absolutePath = path.join(runtime.workspaceRoot, relativePath)
    await fs.writeFile(absolutePath, text, 'utf8')
    runtime.recordSeedWorkspaceFile({
      relativePath,
      absolutePath,
      summary,
      metadata: {
        format: 'text',
        text
      }
    })
    return absolutePath
  }

  const templatePath = await writeTestDocxFile(
    runtime.workspaceRoot,
    templateRelativePath,
    templateBlocks
  )
  runtime.recordSeedWorkspaceFile({
    relativePath: templateRelativePath,
    absolutePath: templatePath,
    summary: '风险周报模板 docx',
    metadata: {
      format: 'docx',
      blocks: templateBlocks
    }
  })

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

  const archivedReportPath = await writeTestDocxFile(
    runtime.workspaceRoot,
    archivedReportRelativePath,
    archivedReportBlocks
  )
  runtime.recordSeedWorkspaceFile({
    relativePath: archivedReportRelativePath,
    absolutePath: archivedReportPath,
    summary: '上周已发送的风险周报归档版',
    metadata: {
      format: 'docx',
      blocks: archivedReportBlocks
    }
  })

  await writeWorkspaceTextFile(
    riskSummaryRelativePath,
    riskSummaryText,
    '本周风险结论来源 markdown'
  )
  await writeWorkspaceTextFile(
    ownerNoteRelativePath,
    ownerNoteText,
    '负责人说明来源 markdown'
  )
  await writeWorkspaceTextFile(summaryHintRelativePath, summaryHintText, '风险摘要提示文本')
  await writeWorkspaceTextFile(milestonesRelativePath, milestonesText, '项目里程碑干扰项')
  await writeWorkspaceTextFile(vendorFollowupRelativePath, vendorFollowupText, '供应商跟进干扰项')

  const originalTemplateBytes = await fs.readFile(templatePath)

  return {
    templatePath,
    templateRelativePath,
    riskSummaryRelativePath,
    ownerNoteRelativePath,
    expectedRiskConclusion,
    expectedOwnerSummary,
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
