import fs from 'node:fs/promises'
import path from 'node:path'
import type { SelectedReference } from '../../../src/shared/types'
import type { BackendTestRuntime, WorkspaceKbSeedResult } from './test-types'

export const HUMAN_RISK_REPORT_DRAFT_USER_INPUT =
  '帮我写下这周的周报，基于这个周报模版和我的工作文档信息,主要放在工作目录下,只要和工作相关的文件你都需要参考下，记得参考我上周写的周报风格来哦'

export const SHARED_WORKSPACE_FIXTURE_PATH = 'tests/fixtures/workspace' as const
const WORKSPACE_LEARNING_FIXTURE_DIR = `${SHARED_WORKSPACE_FIXTURE_PATH}/学习笔记`
const WORKSPACE_WORK_FIXTURE_DIR = `${SHARED_WORKSPACE_FIXTURE_PATH}/工作`

export const RISK_REPORT_TEMPLATE_FIXTURE_PATH =
  `${WORKSPACE_WORK_FIXTURE_DIR}/周报模板-项目对外同步版.docx` as const
export const RISK_REPORT_LAST_WEEK_REPORT_FIXTURE_PATH =
  `${WORKSPACE_WORK_FIXTURE_DIR}/上周周报-已发版.docx` as const
export const RISK_REPORT_CLIENT_MEETING_FIXTURE_PATH =
  `${WORKSPACE_WORK_FIXTURE_DIR}/客户周会纪要.docx` as const
export const RISK_REPORT_DELIVERY_SYNC_FIXTURE_PATH =
  `${WORKSPACE_WORK_FIXTURE_DIR}/交付合规同步记录.docx` as const
export const RISK_REPORT_VENDOR_UPDATE_FIXTURE_PATH =
  `${WORKSPACE_WORK_FIXTURE_DIR}/供应商接口补件说明.docx` as const
export const RISK_REPORT_LEGAL_REVIEW_FIXTURE_PATH =
  `${WORKSPACE_WORK_FIXTURE_DIR}/法务复核意见.docx` as const
export const RISK_REPORT_TEAM_STANDUP_FIXTURE_PATH =
  `${WORKSPACE_WORK_FIXTURE_DIR}/团队站会记录.docx` as const
export const RISK_REPORT_Q2_REVIEW_FIXTURE_PATH =
  `${WORKSPACE_WORK_FIXTURE_DIR}/Q2阶段复盘.docx` as const
export const RISK_REPORT_STYLE_NOTE_FIXTURE_PATH =
  `${WORKSPACE_WORK_FIXTURE_DIR}/对外口径确认.txt` as const
export const RISK_REPORT_FINANCE_NOTE_FIXTURE_PATH =
  `${WORKSPACE_WORK_FIXTURE_DIR}/财务与付款材料跟进.txt` as const
export const RISK_REPORT_SCHEDULE_NOTE_FIXTURE_PATH =
  `${WORKSPACE_WORK_FIXTURE_DIR}/本周排期更新.txt` as const
export const RISK_REPORT_TEMP_NOTE_FIXTURE_PATH =
  `${WORKSPACE_WORK_FIXTURE_DIR}/临时备注.txt` as const

const toWorkspaceRelativePath = (runtime: BackendTestRuntime, absolutePath: string): string =>
  path.relative(runtime.workspaceRoot, absolutePath).split(path.sep).join('/')

export const DOCX_READING_FIXTURE_PATHS = [
  `${WORKSPACE_LEARNING_FIXTURE_DIR}/深度学习.docx`,
  `${WORKSPACE_LEARNING_FIXTURE_DIR}/图形学.docx`
] as const

export const DOCX_POSITIONED_FIXTURE_PATHS = [
  `${WORKSPACE_LEARNING_FIXTURE_DIR}/图形学.docx`
] as const

export const DOCX_MULTI_EDIT_FIXTURE_PATHS = [
  `${SHARED_WORKSPACE_FIXTURE_PATH}/人工智能探究课堂PRD.docx`,
  `${SHARED_WORKSPACE_FIXTURE_PATH}/交互式探究学习案例：产业转移.docx`
] as const

export const DOCX_CROSS_SOURCE_SUMMARY_FIXTURE_PATHS = DOCX_READING_FIXTURE_PATHS

export const DOCX_CROSS_SOURCE_SUMMARY_REPORT_RELATIVE_PATH = '深度学习与图形学复习总结.docx'

export const DOCX_ALL_FIXTURE_PATHS = [
  ...DOCX_READING_FIXTURE_PATHS,
  ...DOCX_MULTI_EDIT_FIXTURE_PATHS,
  `${SHARED_WORKSPACE_FIXTURE_PATH}/sample-edit.docx`
] as const

export const HUMAN_DOCX_CAUSE_REMEDY_READING_USER_INPUT =
  '我这两天复习的时候老把这两个概念混了。你就按我刚选的这两份课件，帮我讲清楚：过拟合和反走样分别是什么、为什么会出现、一般怎么处理。别自己补课外内容，哪份资料没写你就直接告诉我没写。'

export const HUMAN_DOCX_CROSS_SOURCE_SUMMARY_USER_INPUT =
  '帮我基于我刚选的这两个文件，生成一个给同学复习用的总结文件。按照关键概念、出现原因和常见处理方式整理清楚。'

export const HUMAN_DOCX_POSITIONED_STRUCTURAL_EDIT_FALLBACK_USER_INPUT =
  '我准备把这份图形学讲义发给同学复习，想把“反走样”这一节补得更容易记一些。你直接在这一节后面加一段更通俗的说明，再加一个很短的总结表，帮助大家快速区分两种常见做法。'

export const HUMAN_KB_GUIDED_DOCX_COMPARISON_DRAFT_USER_INPUT =
  '我工作区里课件和教学材料有点多，我忘了哪两份课件专门讲过反走样和过拟合。你先把相关资料找出来看一遍，只能依据工作区里实际写到的内容，再把适合老师讲“概念区分”的内容分别补到课堂 PRD 和交互式案例里，写法尽量像备课备注和课堂引导语，不要像教材摘抄。'

export const HUMAN_KB_GUIDED_DOCX_READING_USER_INPUT =
  '我工作区里应该有两份课件分别讲过过拟合和反走样，但我忘了文件名。你先帮我找出来，再告诉我这两个问题一般怎么处理。'

type RiskReportTrackedFile = {
  workspacePath: string
  relativePath: string
  bytes: Uint8Array
}

export type RiskReportWorkspaceSeed = {
  templatePath: string
  templateRelativePath: string
  lastWeekReportRelativePath: string
  expectedRiskConclusion: string
  expectedOwnerSummary: string
  expectedNextStep: string
  relevantDocxRelativePaths: string[]
  relevantTxtRelativePaths: string[]
  preexistingDocxRelativePaths: string[]
  trackedDocFiles: RiskReportTrackedFile[]
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

const buildKbLookup = (
  indexedFiles: readonly WorkspaceKbSeedResult[]
): Map<string, WorkspaceKbSeedResult> =>
  new Map(indexedFiles.map((indexedFile) => [indexedFile.relativePath, indexedFile] as const))

export const resolveSelectedDocxFixtures = (
  runtime: BackendTestRuntime,
  fixturePaths: readonly string[] = DOCX_READING_FIXTURE_PATHS
): SelectedDocxFixture[] =>
  fixturePaths.map((fixturePath) => {
    const workspacePath = runtime.getFixtureWorkspacePath(fixturePath)
    return {
      sourcePath: fixturePath,
      workspacePath,
      relativePath: path.relative(runtime.workspaceRoot, workspacePath).split(path.sep).join('/'),
      name: path.basename(workspacePath)
    }
  })

export const buildSelectedDocxReferences = (
  fixtures: readonly SelectedDocxFixture[],
  indexedFiles: readonly WorkspaceKbSeedResult[] = []
): SelectedReference[] => {
  const kbLookup = buildKbLookup(indexedFiles)
  return fixtures.map((fixture, index) => {
    const indexedState = kbLookup.get(fixture.relativePath)
    return {
      kind: 'file',
      workspaceId: 'test-workspace',
      nodeId: `fixture-docx-${String(index + 1)}`,
      name: fixture.name,
      relativePath: fixture.relativePath,
      absolutePath: fixture.workspacePath,
      fileExt: '.docx',
      kbDocumentIds: indexedState?.kbDocumentIds || [],
      kbAvailability: indexedState?.kbAvailability || 'not_indexed'
    }
  })
}

export const buildSelectedDocxFixtureReferences = (
  runtime: BackendTestRuntime,
  fixturePaths: readonly string[] = DOCX_READING_FIXTURE_PATHS,
  indexedFiles: readonly WorkspaceKbSeedResult[] = []
): SelectedReference[] =>
  buildSelectedDocxReferences(resolveSelectedDocxFixtures(runtime, fixturePaths), indexedFiles)

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

const captureWorkspaceFiles = async (
  runtime: BackendTestRuntime,
  fixturePaths: readonly string[]
): Promise<RiskReportTrackedFile[]> =>
  await Promise.all(
    fixturePaths.map(async (fixturePath) => {
      const workspacePath = runtime.getFixtureWorkspacePath(fixturePath)
      return {
        workspacePath,
        relativePath: toWorkspaceRelativePath(runtime, workspacePath),
        bytes: await fs.readFile(workspacePath)
      }
    })
  )

export const loadRiskReportWorkspaceSeed = async (
  runtime: BackendTestRuntime
): Promise<RiskReportWorkspaceSeed> => {
  const expectedRiskConclusion = '在最终合规签署完成前，当前风险状态仍需保持跟进。'
  const expectedOwnerSummary = '最终复核窗口由合规负责人 Alice 牵头。'
  const expectedNextStep = '财务接口人 Bob 本周内补齐付款材料，并在复核前完成附件对齐。'
  const templatePath = runtime.getFixtureWorkspacePath(RISK_REPORT_TEMPLATE_FIXTURE_PATH)
  const templateRelativePath = toWorkspaceRelativePath(runtime, templatePath)
  const lastWeekReportRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(RISK_REPORT_LAST_WEEK_REPORT_FIXTURE_PATH)
  )
  const clientMeetingRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(RISK_REPORT_CLIENT_MEETING_FIXTURE_PATH)
  )
  const deliverySyncRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(RISK_REPORT_DELIVERY_SYNC_FIXTURE_PATH)
  )
  const vendorUpdateRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(RISK_REPORT_VENDOR_UPDATE_FIXTURE_PATH)
  )
  const legalReviewRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(RISK_REPORT_LEGAL_REVIEW_FIXTURE_PATH)
  )
  const styleNoteRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(RISK_REPORT_STYLE_NOTE_FIXTURE_PATH)
  )
  const financeNoteRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(RISK_REPORT_FINANCE_NOTE_FIXTURE_PATH)
  )
  const scheduleNoteRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(RISK_REPORT_SCHEDULE_NOTE_FIXTURE_PATH)
  )
  const teamStandupRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(RISK_REPORT_TEAM_STANDUP_FIXTURE_PATH)
  )
  const q2ReviewRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(RISK_REPORT_Q2_REVIEW_FIXTURE_PATH)
  )
  const originalTemplateBytes = await fs.readFile(templatePath)
  const preexistingDocxRelativePaths = [
    templateRelativePath,
    lastWeekReportRelativePath,
    clientMeetingRelativePath,
    deliverySyncRelativePath,
    vendorUpdateRelativePath,
    legalReviewRelativePath,
    teamStandupRelativePath,
    q2ReviewRelativePath
  ]
  const trackedDocFiles = await captureWorkspaceFiles(runtime, [
    RISK_REPORT_TEMPLATE_FIXTURE_PATH,
    RISK_REPORT_LAST_WEEK_REPORT_FIXTURE_PATH,
    RISK_REPORT_CLIENT_MEETING_FIXTURE_PATH,
    RISK_REPORT_DELIVERY_SYNC_FIXTURE_PATH,
    RISK_REPORT_VENDOR_UPDATE_FIXTURE_PATH,
    RISK_REPORT_LEGAL_REVIEW_FIXTURE_PATH,
    RISK_REPORT_TEAM_STANDUP_FIXTURE_PATH,
    RISK_REPORT_Q2_REVIEW_FIXTURE_PATH
  ])

  return {
    templatePath,
    templateRelativePath,
    lastWeekReportRelativePath,
    expectedRiskConclusion,
    expectedOwnerSummary,
    expectedNextStep,
    relevantDocxRelativePaths: [
      clientMeetingRelativePath,
      deliverySyncRelativePath,
      vendorUpdateRelativePath,
      legalReviewRelativePath
    ],
    relevantTxtRelativePaths: [
      styleNoteRelativePath,
      financeNoteRelativePath,
      scheduleNoteRelativePath
    ],
    preexistingDocxRelativePaths,
    trackedDocFiles,
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
