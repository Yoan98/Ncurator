import { describe, expect, it } from 'vitest'
import { deriveHandFollowupSignals } from '../../../../src/main/services/ai/human/node/handNode/followupSignals'

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

  it('derives unified docx_edit failure decision hint from failed docx writes', () => {
    const signals = deriveHandFollowupSignals({
      calls: [
        {
          toolName: 'docx_edit',
          args: {
            sourcePath: 'graphics.docx',
            actions: [{
              type: 'insert_blocks',
              position: 'after',
              anchorBlockId: 'b:26',
              blocks: [{ type: 'table', rows: [['方法', '说明']] }]
            }]
          }
        }
      ],
      results: [
        {
          toolName: 'docx_edit',
          ok: false,
          data: {
            error: 'cannot resolve anchorBlockId=b:26 in current active snapshot'
          },
          diagnostic: {
            message: 'cannot resolve anchorBlockId=b:26 in current active snapshot'
          }
        }
      ]
    })

    expect(signals.decisionHint).toEqual({
      code: 'hand_docx_edit_failed',
      detail: {
        toolName: 'docx_edit',
        sourcePath: 'graphics.docx',
        action: 'insert_blocks',
        error: 'cannot resolve anchorBlockId=b:26 in current active snapshot',
        diagnostic: undefined
      }
    })
    expect(signals.deliveryGuidance).toBeUndefined()
  })

  it('derives positioned docx decision hint before generic docx_edit failure', () => {
    const signals = deriveHandFollowupSignals({
      calls: [
        {
          toolName: 'docx_edit',
          args: {
            sourcePath: 'graphics.docx',
            actions: [{
              type: 'insert_blocks',
              position: 'after',
              anchorBlockId: 'b:26',
              blocks: [{ type: 'paragraph', text: '补充说明' }]
            }]
          }
        }
      ],
      results: [
        {
          toolName: 'docx_edit',
          ok: false,
          data: {
            error: '当前命中复杂定位排版区域，暂不支持自动编辑，以避免预览修订和版式叠加导致错位；你可以手动按建议内容调整该处。'
          },
          diagnostic: {
            message: '当前命中复杂定位排版区域，暂不支持自动编辑，以避免预览修订和版式叠加导致错位；你可以手动按建议内容调整该处。'
          }
        }
      ]
    })

    expect(signals.decisionHint).toEqual({
      code: 'hand_docx_positioned_write_blocked',
      detail: {
        toolName: 'docx_edit',
        sourcePath: 'graphics.docx',
        action: 'insert_blocks',
        diagnostic: '当前命中复杂定位排版区域，暂不支持自动编辑，以避免预览修订和版式叠加导致错位；你可以手动按建议内容调整该处。'
      }
    })
    expect(signals.deliveryGuidance).toBeUndefined()
  })

  it('preserves positioned docx diagnostic from tool result decision hint', () => {
    const signals = deriveHandFollowupSignals({
      calls: [
        {
          toolName: 'docx_edit',
          args: {
            sourcePath: 'graphics.docx',
            actions: [{
              type: 'insert_blocks',
              position: 'after',
              anchorBlockId: 'b:26',
              blocks: [{ type: 'paragraph', text: '补充说明' }]
            }]
          }
        }
      ],
      results: [
        {
          toolName: 'docx_edit',
          ok: false,
          data: {
            error: '当前命中复杂定位排版区域，暂不支持自动编辑，以避免预览修订和版式叠加导致错位；你可以手动按建议内容调整该处。',
            decisionHint: {
              code: 'hand_docx_positioned_write_blocked',
              detail: {
                toolName: 'docx_edit',
                sourcePath: 'graphics.docx',
                diagnostic: '当前命中复杂定位排版区域：包含“达到反走样。”的区域，暂不支持自动编辑，以避免预览修订和版式叠加导致错位；你可以手动按建议内容调整该处。'
              }
            }
          },
          diagnostic: {
            message: '当前命中复杂定位排版区域，暂不支持自动编辑，以避免预览修订和版式叠加导致错位；你可以手动按建议内容调整该处。'
          }
        }
      ]
    })

    expect(signals.decisionHint).toEqual({
      code: 'hand_docx_positioned_write_blocked',
      detail: {
        toolName: 'docx_edit',
        sourcePath: 'graphics.docx',
        diagnostic: '当前命中复杂定位排版区域：包含“达到反走样。”的区域，暂不支持自动编辑，以避免预览修订和版式叠加导致错位；你可以手动按建议内容调整该处。'
      }
    })
    expect(signals.deliveryGuidance).toBeUndefined()
  })
})
