import fs from 'node:fs/promises'
import path from 'node:path'
import type { SelectedReference } from '../../../src/shared/types'
import type { BackendTestRuntime, WorkspaceKbSeedResult } from './test-types'

export const HUMAN_RISK_REPORT_DRAFT_USER_INPUT =
  '我下午要把本周风险周报发出去。工作区里应该有一份上周用过的 Word 周报模板，但我忘了文件名。你先帮我找到那份模板，再根据工作区里的现有材料，把本周风险结论和负责人补进去，整理成待确认稿。最后告诉我你改了哪几处，依据分别来自哪里。'

export const SHARED_WORKSPACE_FIXTURE_PATH = 'tests/fixtures/workspace' as const
const WORKSPACE_LEARNING_FIXTURE_DIR = `${SHARED_WORKSPACE_FIXTURE_PATH}/学习笔记`
const WORKSPACE_WORK_FIXTURE_DIR = `${SHARED_WORKSPACE_FIXTURE_PATH}/工作`

export const RISK_REPORT_TEMPLATE_FIXTURE_PATH =
  `${WORKSPACE_WORK_FIXTURE_DIR}/weekly-risk-report-template.docx` as const
export const RISK_REPORT_SUMMARY_FIXTURE_PATH =
  `${WORKSPACE_WORK_FIXTURE_DIR}/weekly-risk-summary.md` as const
export const RISK_REPORT_OWNER_NOTE_FIXTURE_PATH =
  `${WORKSPACE_WORK_FIXTURE_DIR}/owner-note.md` as const

export const DOCX_READING_FIXTURE_PATHS = [
  `${WORKSPACE_LEARNING_FIXTURE_DIR}/深度学习.docx`,
  `${WORKSPACE_LEARNING_FIXTURE_DIR}/图形学.docx`
] as const

export const DOCX_POSITIONED_FIXTURE_PATHS = [`${WORKSPACE_LEARNING_FIXTURE_DIR}/图形学.docx`] as const

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
  '帮我基于我刚选的这两个文件，生成一个给同学复习用的总结文件。里面把关键概念、出现原因和常见处理方式整理清楚。'

export const HUMAN_DOCX_POSITIONED_STRUCTURAL_EDIT_FALLBACK_USER_INPUT =
  '我准备把这份图形学讲义发给同学复习，想把“反走样”这一节补得更容易记一些。你直接在这一节后面加一段更通俗的说明，再加一个很短的总结表，帮助大家快速区分两种常见做法。'

export const HUMAN_KB_GUIDED_DOCX_COMPARISON_DRAFT_USER_INPUT =
  '我工作区里课件和教学材料有点多，我忘了哪两份课件专门讲过反走样和过拟合。你先把相关资料找出来看一遍，只能依据工作区里实际写到的内容，再把适合老师讲“概念区分”的内容分别补到课堂 PRD 和交互式案例里，写法尽量像备课备注和课堂引导语，不要像教材摘抄。'

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

const buildKbLookup = (
  indexedFiles: readonly WorkspaceKbSeedResult[]
): Map<string, WorkspaceKbSeedResult> =>
  new Map(
    indexedFiles.map((indexedFile) => [indexedFile.relativePath, indexedFile] as const)
  )

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
): SelectedReference[] =>
  {
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

export const loadRiskReportWorkspaceSeed = async (
  runtime: BackendTestRuntime
): Promise<RiskReportWorkspaceSeed> => {
  const expectedRiskConclusion = '在合规签署前，风险状态保持为“待跟进”。'
  const expectedOwnerSummary = '最终复核窗口由合规负责人 Alice 牵头。'
  const templatePath = runtime.getFixtureWorkspacePath(RISK_REPORT_TEMPLATE_FIXTURE_PATH)
  const templateRelativePath = path.relative(runtime.workspaceRoot, templatePath)
  const riskSummaryRelativePath = path.relative(
    runtime.workspaceRoot,
    runtime.getFixtureWorkspacePath(RISK_REPORT_SUMMARY_FIXTURE_PATH)
  )
  const ownerNoteRelativePath = path.relative(
    runtime.workspaceRoot,
    runtime.getFixtureWorkspacePath(RISK_REPORT_OWNER_NOTE_FIXTURE_PATH)
  )

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
