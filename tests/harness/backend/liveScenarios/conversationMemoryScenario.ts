import fs from 'node:fs/promises'
import path from 'node:path'
import type { BackendTestRuntime } from '../test-types'

export const CONVERSATION_MEMORY_SHARED_WORKSPACE_FIXTURE_PATH =
  'tests/fixtures/workspace' as const
const CONVERSATION_MEMORY_WORK_FIXTURE_DIR =
  `${CONVERSATION_MEMORY_SHARED_WORKSPACE_FIXTURE_PATH}/工作`

export const CONVERSATION_MEMORY_FIRST_RUN_USER_INPUT =
  '先不要写周报，也不要新建文件。你先基于我工作目录下的真实材料，告诉我本周最关键的风险、负责人、待确认项和下一步。'
export const CONVERSATION_MEMORY_SECOND_RUN_USER_INPUT =
  '沿着刚才那轮继续，不用重写背景，直接告诉我目前最关键的待确认项、应该先找谁、为什么。'

const CONVERSATION_MEMORY_LAST_WEEK_REPORT_FIXTURE_PATH =
  `${CONVERSATION_MEMORY_WORK_FIXTURE_DIR}/上周周报-已发版.docx` as const
const CONVERSATION_MEMORY_CLIENT_MEETING_FIXTURE_PATH =
  `${CONVERSATION_MEMORY_WORK_FIXTURE_DIR}/客户周会纪要.docx` as const
const CONVERSATION_MEMORY_DELIVERY_SYNC_FIXTURE_PATH =
  `${CONVERSATION_MEMORY_WORK_FIXTURE_DIR}/交付合规同步记录.docx` as const
const CONVERSATION_MEMORY_VENDOR_UPDATE_FIXTURE_PATH =
  `${CONVERSATION_MEMORY_WORK_FIXTURE_DIR}/供应商接口补件说明.docx` as const
const CONVERSATION_MEMORY_LEGAL_REVIEW_FIXTURE_PATH =
  `${CONVERSATION_MEMORY_WORK_FIXTURE_DIR}/法务复核意见.docx` as const
const CONVERSATION_MEMORY_TEAM_STANDUP_FIXTURE_PATH =
  `${CONVERSATION_MEMORY_WORK_FIXTURE_DIR}/团队站会记录.docx` as const
const CONVERSATION_MEMORY_Q2_REVIEW_FIXTURE_PATH =
  `${CONVERSATION_MEMORY_WORK_FIXTURE_DIR}/Q2阶段复盘.docx` as const
const CONVERSATION_MEMORY_STYLE_NOTE_FIXTURE_PATH =
  `${CONVERSATION_MEMORY_WORK_FIXTURE_DIR}/对外口径确认.txt` as const
const CONVERSATION_MEMORY_FINANCE_NOTE_FIXTURE_PATH =
  `${CONVERSATION_MEMORY_WORK_FIXTURE_DIR}/财务与付款材料跟进.txt` as const
const CONVERSATION_MEMORY_SCHEDULE_NOTE_FIXTURE_PATH =
  `${CONVERSATION_MEMORY_WORK_FIXTURE_DIR}/本周排期更新.txt` as const

type ConversationMemoryTrackedFile = {
  workspacePath: string
  relativePath: string
  bytes: Uint8Array
}

export type ConversationMemoryWorkspaceSeed = {
  expectedRiskConclusion: string
  expectedOwnerSummary: string
  expectedNextStep: string
  expectedPrimaryPendingItem: string
  trackedDocFiles: ConversationMemoryTrackedFile[]
  relevantDocxRelativePaths: string[]
  relevantTxtRelativePaths: string[]
}

const toWorkspaceRelativePath = (runtime: BackendTestRuntime, absolutePath: string): string =>
  path.relative(runtime.workspaceRoot, absolutePath).split(path.sep).join('/')

const captureWorkspaceFiles = async (
  runtime: BackendTestRuntime,
  fixturePaths: readonly string[]
): Promise<ConversationMemoryTrackedFile[]> =>
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

export const loadConversationMemoryWorkspaceSeed = async (
  runtime: BackendTestRuntime
): Promise<ConversationMemoryWorkspaceSeed> => {
  const expectedRiskConclusion = '在最终合规签署完成前，当前风险状态仍需保持跟进。'
  const expectedOwnerSummary = '最终复核窗口由合规负责人 Alice 牵头。'
  const expectedNextStep = '财务接口人 Bob 本周内补齐付款材料，并在复核前完成附件对齐。'
  const expectedPrimaryPendingItem = '最后一份合规附件仍在内部确认中，需在最终复核前完成版本对齐。'
  const clientMeetingRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(CONVERSATION_MEMORY_CLIENT_MEETING_FIXTURE_PATH)
  )
  const deliverySyncRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(CONVERSATION_MEMORY_DELIVERY_SYNC_FIXTURE_PATH)
  )
  const vendorUpdateRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(CONVERSATION_MEMORY_VENDOR_UPDATE_FIXTURE_PATH)
  )
  const legalReviewRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(CONVERSATION_MEMORY_LEGAL_REVIEW_FIXTURE_PATH)
  )
  const styleNoteRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(CONVERSATION_MEMORY_STYLE_NOTE_FIXTURE_PATH)
  )
  const financeNoteRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(CONVERSATION_MEMORY_FINANCE_NOTE_FIXTURE_PATH)
  )
  const scheduleNoteRelativePath = toWorkspaceRelativePath(
    runtime,
    runtime.getFixtureWorkspacePath(CONVERSATION_MEMORY_SCHEDULE_NOTE_FIXTURE_PATH)
  )
  const trackedDocFiles = await captureWorkspaceFiles(runtime, [
    CONVERSATION_MEMORY_LAST_WEEK_REPORT_FIXTURE_PATH,
    CONVERSATION_MEMORY_CLIENT_MEETING_FIXTURE_PATH,
    CONVERSATION_MEMORY_DELIVERY_SYNC_FIXTURE_PATH,
    CONVERSATION_MEMORY_VENDOR_UPDATE_FIXTURE_PATH,
    CONVERSATION_MEMORY_LEGAL_REVIEW_FIXTURE_PATH,
    CONVERSATION_MEMORY_TEAM_STANDUP_FIXTURE_PATH,
    CONVERSATION_MEMORY_Q2_REVIEW_FIXTURE_PATH
  ])

  return {
    expectedRiskConclusion,
    expectedOwnerSummary,
    expectedNextStep,
    expectedPrimaryPendingItem,
    trackedDocFiles,
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
    ]
  }
}
