import { describe, expect, it } from 'vitest'
import { deriveHandFollowupSignals } from '../../../src/main/services/ai/human/node/handNode/followupSignals'
import { DOCX_POSITIONED_LAYOUT_PROTECTION_MESSAGE } from '../../../src/main/services/ai/human/tools/docx/constants'

describe('ai unit hand followup signals', () => {
  it('passes through hand_tool_result_too_large using the shared decision hint contract', () => {
    const signals = deriveHandFollowupSignals({
      calls: [
        {
          toolName: 'docx_outline',
          args: {
            sourcePath: 'oversized.docx',
            ranges: [{ type: 'percent', fromPercent: 0, toPercent: 100 }]
          }
        }
      ],
      results: [
        {
          toolName: 'docx_outline',
          ok: false,
          data: {
            error: 'docx result too large',
            decisionHint: {
              code: 'hand_tool_result_too_large',
              detail: {
                toolName: 'docx_outline',
                estimatedTokens: 6049,
                limit: 6000
              }
            }
          }
        }
      ]
    })

    expect(signals.decisionHint).toEqual({
      code: 'hand_tool_result_too_large',
      detail: {
        toolName: 'docx_outline',
        estimatedTokens: 6049,
        limit: 6000
      }
    })
    expect(signals.deliveryGuidance).toBeUndefined()
  })

  it('derives positioned write decision hint and delivery guidance from protected docx writes', () => {
    const signals = deriveHandFollowupSignals({
      calls: [
        {
          toolName: 'docx_table_edit',
          args: {
            sourcePath: 'graphics.docx',
            action: 'insert_after',
            anchorBlockId: 'b:26',
            rows: [['方法', '说明']]
          }
        }
      ],
      results: [
        {
          toolName: 'docx_table_edit',
          ok: false,
          data: {
            error: DOCX_POSITIONED_LAYOUT_PROTECTION_MESSAGE
          },
          diagnostic: {
            message: DOCX_POSITIONED_LAYOUT_PROTECTION_MESSAGE
          }
        }
      ]
    })

    expect(signals.decisionHint).toEqual({
      code: 'hand_docx_positioned_write_blocked',
      detail: {
        targetDescription: '在 graphics.docx 中，你刚才尝试插入表格的那处位置',
        sourcePath: 'graphics.docx'
      }
    })
    expect(signals.deliveryGuidance).toContain('在 graphics.docx 中，你刚才尝试插入表格的那处位置')
    expect(signals.deliveryGuidance).toContain('按系统设计，这类定位区域不会被自动修改')
    expect(signals.deliveryGuidance).toContain('没有生成对应的审阅稿')
  })
})
