import { describe, expect, it } from 'vitest'
import { deriveHandFollowupSignals } from '../../../src/main/services/ai/human/node/handNode/followupSignals'
import { DOCX_POSITIONED_LAYOUT_PROTECTION_MESSAGE } from '../../../src/main/services/ai/human/tools/docx/constants'

describe('ai unit hand followup signals', () => {
  it('derives positioned write decision hint and delivery guidance from protected docx writes', () => {
    const signals = deriveHandFollowupSignals({
      toolUsePlan: {
        mode: 'serial',
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
        ]
      },
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

  it('passes through halted batch write decision hint from docx batch results', () => {
    const signals = deriveHandFollowupSignals({
      toolUsePlan: {
        mode: 'serial',
        calls: [
          {
            toolName: 'docx_paragraph_edit',
            args: {
              sourcePath: 'report.docx',
              action: 'replace_text',
              blockId: 'b:1',
              text: 'updated'
            }
          }
        ]
      },
      results: [
        {
          toolName: 'docx_paragraph_edit',
          ok: false,
          code: 'invalid_input',
          data: {
            ok: false,
            code: 'invalid_input',
            error: 'cannot safely resolve target after earlier mutations',
            decisionHint: {
              code: 'hand_docx_batch_write_halted',
              detail: {
                sourcePath: 'report.docx',
                lastSafeRevisionRef: 'v3',
                haltedAtCallIndex: 0,
                completedCallCount: 1,
                totalCallCount: 2,
                haltReason: 'locator_confidence_too_low',
                haltSummary: 'cannot safely resolve target after earlier mutations',
                completedItems: ['docx_paragraph_edit#1'],
                pendingItems: ['docx_paragraph_edit#2'],
                failedItem: 'docx_paragraph_edit#2',
                recoveryContext: '当前工作稿已停在 v3；已完成写入保留，未完成写入未执行。'
              }
            }
          },
          diagnostic: {
            message: 'cannot safely resolve target after earlier mutations'
          }
        }
      ]
    })

    expect(signals.decisionHint).toEqual({
      code: 'hand_docx_batch_write_halted',
      detail: {
        sourcePath: 'report.docx',
        lastSafeRevisionRef: 'v3',
        haltedAtCallIndex: 0,
        completedCallCount: 1,
        totalCallCount: 2,
        haltReason: 'locator_confidence_too_low',
        haltSummary: 'cannot safely resolve target after earlier mutations',
        completedItems: ['docx_paragraph_edit#1'],
        pendingItems: ['docx_paragraph_edit#2'],
        failedItem: 'docx_paragraph_edit#2',
        recoveryContext: '当前工作稿已停在 v3；已完成写入保留，未完成写入未执行。'
      }
    })
  })
})
