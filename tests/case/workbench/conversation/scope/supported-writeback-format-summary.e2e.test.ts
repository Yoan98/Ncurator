import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  navigateToWorkbench,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'supported-writeback-format-summary'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['scope'],
        description: '验证右侧空面板明确展示当前支持直接写回的文件格式。',
        fixtures: [],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToWorkbench(page, { waitForSessionListText: false })
          const panelToggle = getWorkbenchLocator(page, workbenchSelectors.contentPanelToggle)
          if ((await panelToggle.getAttribute('aria-label')) === '展开右侧栏') {
            await panelToggle.click()
          }
          const summary = getWorkbenchLocator(page, workbenchSelectors.supportedWritebackSummary)
          await summary.waitFor({ state: 'visible' })
          return ((await summary.textContent()) || '').trim()
        },
        assert: async (summary, runtime) => {
          await runtime.assertThat(
            summary.includes('DOCX') &&
              summary.includes('PPTX') &&
              summary.includes('XLSX') &&
              summary.includes('PNG') &&
              summary.includes('JPEG') &&
              summary.includes('WebP') &&
              summary.includes('UTF-8 文本') &&
              !summary.includes('GIF') &&
              !summary.includes('SVG'),
            {
              name: 'workbench-supported-writeback-format-summary-visible',
              message:
                'Workbench 应明确展示支持直接写回的格式，并且不把 GIF、SVG 等非目标产物列为可直接写回格式，对齐 WB-CORE-003。',
              data: { summary }
            }
          )
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS
  )
})
