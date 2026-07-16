import fs from 'node:fs/promises'
import path from 'node:path'
import type { SelectedReference } from '../../../src/shared/types'
import type { BackendTestRuntime, WorkspaceKbSeedResult } from './test-types'

export const SHARED_WORKSPACE_FIXTURE_PATH = 'tests/fixtures/workspace' as const
const WORKSPACE_LEARNING_FIXTURE_DIR = `${SHARED_WORKSPACE_FIXTURE_PATH}/学习笔记`

export const DOCX_READING_FIXTURE_PATHS = [
  `${WORKSPACE_LEARNING_FIXTURE_DIR}/深度学习.docx`,
  `${WORKSPACE_LEARNING_FIXTURE_DIR}/图形学.docx`
] as const

export const DOCX_POSITIONED_FIXTURE_PATHS = [
  `${WORKSPACE_LEARNING_FIXTURE_DIR}/图形学.docx`
] as const

export const PDF_READING_FIXTURE_PATH = `${WORKSPACE_LEARNING_FIXTURE_DIR}/深度学习.pdf` as const

export const HUMAN_PDF_VISUAL_READING_USER_INPUT =
  '请只根据我选中的《深度学习.pdf》回答两个问题：1. 用通俗的话说明第1页流程图里 inputs、parameters、architecture、predictions、labels、loss 和 update 是怎么形成训练闭环的；2. 结合第9页 Proper fit 和 Overfit 对比图，说明两条曲线有什么直观区别，以及为什么右边属于过度拟合。'

export const DOCX_MULTI_EDIT_FIXTURE_PATHS = [
  `${SHARED_WORKSPACE_FIXTURE_PATH}/人工智能探究课堂PRD.docx`,
  `${SHARED_WORKSPACE_FIXTURE_PATH}/交互式探究学习案例：产业转移.docx`
] as const

export const DOCX_ALL_FIXTURE_PATHS = [
  ...DOCX_READING_FIXTURE_PATHS,
  ...DOCX_MULTI_EDIT_FIXTURE_PATHS,
  `${SHARED_WORKSPACE_FIXTURE_PATH}/sample-edit.docx`
] as const

export const HUMAN_DOCX_POSITIONED_STRUCTURAL_EDIT_FALLBACK_USER_INPUT =
  '我准备把这份图形学讲义发给同学复习，想把“反走样”这一节补得更容易记一些。你直接在这一节后面加一段更通俗的说明，再加一个很短的总结表，帮助大家快速区分两种常见做法。'

export const HUMAN_KB_GUIDED_DOCX_COMPARISON_DRAFT_USER_INPUT =
  '我工作区里课件和教学材料有点多，我忘了哪两份课件专门讲过反走样和过拟合。你先在工作区知识库里搜索并缩小资料范围，只能依据工作区里实际写到的内容，再把适合老师讲“概念区分”的内容分别补到工作区根目录的“人工智能探究课堂PRD.docx”和“交互式探究学习案例：产业转移.docx”里。两个目标文件不需要从知识库查找，写法尽量像备课备注和课堂引导语，不要像教材摘抄。'

export const buildHumanWebCrawlMultiHopCrossDomainUserInput = (entryUrl: string): string =>
  `帮我基于这个网站整理杭州灵活就业补贴的申请说明：${entryUrl}。我需要知道谁可以申请、需要哪些材料、截止时间和线上办理方式。`

export const HUMAN_WEB_CRAWL_URL_INFERENCE_USER_INPUT =
  '帮我基于 pandas 官网文档分别看下 read_csv 和 DataFrame.to_csv 这两个条目，说明它们分别是做什么的，以及最直接的使用区别。不要用终端命令，也不要打开浏览器操作。'

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

export const buildSelectedPdfFixtureReference = (
  runtime: BackendTestRuntime,
  fixturePath: string = PDF_READING_FIXTURE_PATH
): SelectedReference => {
  const workspacePath = runtime.getFixtureWorkspacePath(fixturePath)
  const relativePath = path.relative(runtime.workspaceRoot, workspacePath).split(path.sep).join('/')
  return {
    kind: 'file',
    workspaceId: 'test-workspace',
    nodeId: 'fixture-pdf-1',
    name: path.basename(workspacePath),
    relativePath,
    absolutePath: workspacePath,
    fileExt: '.pdf',
    kbDocumentIds: [],
    kbAvailability: 'not_indexed'
  }
}

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
