import { describe, expect, it } from 'vitest'
import { deriveHandFollowupSignals } from '../../../src/main/services/ai/human/node/handNode/followupSignals'
import { DOCX_POSITIONED_LAYOUT_PROTECTION_MESSAGE } from '../../../src/main/services/ai/human/tools/docx/constants'

describe('ai unit hand followup signals', () => {
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
          code: 'invalid_input',
          data: {
            ok: false,
            code: 'invalid_input',
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
        targetDescription: '你刚才尝试插入表格的那处位置'
      }
    })
    expect(signals.deliveryGuidance).toContain('你刚才尝试插入表格的那处位置')
    expect(signals.deliveryGuidance).toContain('没有生成对应的审阅稿')
  })
})
