import fs from 'node:fs/promises'
import path from 'node:path'
import type { BackendTestRuntime } from '../test-types'

export const CONTEXT_COMPACTION_SHARED_WORKSPACE_FIXTURE_PATH = 'tests/fixtures/workspace' as const
const CONTEXT_COMPACTION_WORK_FIXTURE_DIR =
  `${CONTEXT_COMPACTION_SHARED_WORKSPACE_FIXTURE_PATH}/工作`

export const HUMAN_CONTEXT_COMPACTION_USER_INPUT =
  '帮我写下这周的工作周报文件，基于我工作目录下的所有文件信息，记得参考我上周写的周报风格来哦'

export const HUMAN_CONTEXT_COMPACTION_RUN2_USER_INPUT =
  '对照刚写好的本周周报和上周周报，补一节与上周风险对照，把标题改为「九月第一周」，并核对法务口径有没有写进周报。不要从空白模板整份重填周报。'

const CONTEXT_COMPACTION_LAST_WEEK_REPORT_FIXTURE_PATH =
  `${CONTEXT_COMPACTION_WORK_FIXTURE_DIR}/上周周报-已发版.docx` as const
const CONTEXT_COMPACTION_CLIENT_MEETING_FIXTURE_PATH =
  `${CONTEXT_COMPACTION_WORK_FIXTURE_DIR}/客户周会纪要.docx` as const
const CONTEXT_COMPACTION_DELIVERY_SYNC_FIXTURE_PATH =
  `${CONTEXT_COMPACTION_WORK_FIXTURE_DIR}/交付合规同步记录.docx` as const
const CONTEXT_COMPACTION_VENDOR_UPDATE_FIXTURE_PATH =
  `${CONTEXT_COMPACTION_WORK_FIXTURE_DIR}/供应商接口补件说明.docx` as const
const CONTEXT_COMPACTION_LEGAL_REVIEW_FIXTURE_PATH =
  `${CONTEXT_COMPACTION_WORK_FIXTURE_DIR}/法务复核意见.docx` as const
const CONTEXT_COMPACTION_TEAM_STANDUP_FIXTURE_PATH =
  `${CONTEXT_COMPACTION_WORK_FIXTURE_DIR}/团队站会记录.docx` as const
const CONTEXT_COMPACTION_Q2_REVIEW_FIXTURE_PATH =
  `${CONTEXT_COMPACTION_WORK_FIXTURE_DIR}/Q2阶段复盘.docx` as const
const CONTEXT_COMPACTION_STYLE_NOTE_FIXTURE_PATH =
  `${CONTEXT_COMPACTION_WORK_FIXTURE_DIR}/对外口径确认.txt` as const
const CONTEXT_COMPACTION_FINANCE_NOTE_FIXTURE_PATH =
  `${CONTEXT_COMPACTION_WORK_FIXTURE_DIR}/财务与付款材料跟进.txt` as const
const CONTEXT_COMPACTION_SCHEDULE_NOTE_FIXTURE_PATH =
  `${CONTEXT_COMPACTION_WORK_FIXTURE_DIR}/本周排期更新.txt` as const

type ContextCompactionTrackedFile = {
  workspacePath: string
  relativePath: string
  bytes: Uint8Array
}

export type ContextCompactionWorkspaceSeed = {
  lastWeekReportRelativePath: string
  expectedRiskConclusion: string
  expectedOwnerSummary: string
  expectedNextStep: string
  relevantDocxRelativePaths: string[]
  relevantTxtRelativePaths: string[]
  preexistingDocxRelativePaths: string[]
  trackedDocFiles: ContextCompactionTrackedFile[]
}

const toWorkspaceRelativePath = (runtime: BackendTestRuntime, absolutePath: string): string =>
  path.relative(runtime.workspaceRoot, absolutePath).split(path.sep).join('/')

const captureWorkspaceFiles = async (
  runtime: BackendTestRuntime,
  fixturePaths: readonly string[]
): Promise<ContextCompactionTrackedFile[]> =>
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

export const loadContextCompactionWorkspaceSeed = async (
  runtime: BackendTestRuntime
): Promise<ContextCompactionWorkspaceSeed> => {
  const expectedRiskConclusion = '在最终合规签署完成前，当前风险状态仍需保持跟进。'
  const expectedOwnerSummary = '最终复核窗口由合规负责人 Alice 牵头。'
  const expectedNextStep = '财务接口人 Bob 本周内补齐付款材料，并在复核前完成附件对齐。'
  const lastWeekReportRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(CONTEXT_COMPACTION_LAST_WEEK_REPORT_FIXTURE_PATH)
  )
  const clientMeetingRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(CONTEXT_COMPACTION_CLIENT_MEETING_FIXTURE_PATH)
  )
  const deliverySyncRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(CONTEXT_COMPACTION_DELIVERY_SYNC_FIXTURE_PATH)
  )
  const vendorUpdateRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(CONTEXT_COMPACTION_VENDOR_UPDATE_FIXTURE_PATH)
  )
  const legalReviewRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(CONTEXT_COMPACTION_LEGAL_REVIEW_FIXTURE_PATH)
  )
  const styleNoteRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(CONTEXT_COMPACTION_STYLE_NOTE_FIXTURE_PATH)
  )
  const financeNoteRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(CONTEXT_COMPACTION_FINANCE_NOTE_FIXTURE_PATH)
  )
  const scheduleNoteRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(CONTEXT_COMPACTION_SCHEDULE_NOTE_FIXTURE_PATH)
  )
  const teamStandupRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(CONTEXT_COMPACTION_TEAM_STANDUP_FIXTURE_PATH)
  )
  const q2ReviewRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(CONTEXT_COMPACTION_Q2_REVIEW_FIXTURE_PATH)
  )
  const preexistingDocxRelativePaths = [
    lastWeekReportRelativePath,
    clientMeetingRelativePath,
    deliverySyncRelativePath,
    vendorUpdateRelativePath,
    legalReviewRelativePath,
    teamStandupRelativePath,
    q2ReviewRelativePath
  ]
  const trackedDocFiles = await captureWorkspaceFiles(runtime, [
    CONTEXT_COMPACTION_LAST_WEEK_REPORT_FIXTURE_PATH,
    CONTEXT_COMPACTION_CLIENT_MEETING_FIXTURE_PATH,
    CONTEXT_COMPACTION_DELIVERY_SYNC_FIXTURE_PATH,
    CONTEXT_COMPACTION_VENDOR_UPDATE_FIXTURE_PATH,
    CONTEXT_COMPACTION_LEGAL_REVIEW_FIXTURE_PATH,
    CONTEXT_COMPACTION_TEAM_STANDUP_FIXTURE_PATH,
    CONTEXT_COMPACTION_Q2_REVIEW_FIXTURE_PATH
  ])

  return {
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
    trackedDocFiles
  }
}
