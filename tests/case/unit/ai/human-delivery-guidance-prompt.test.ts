import { describe, expect, it } from 'vitest'
import { renderDeliveryGuidanceForMouth } from '../../../../src/main/services/ai/human/prompts/deliveryGuidance'

describe('ai unit human delivery guidance prompt', () => {
  it('renders positioned docx guidance for mouth from error', () => {
    const guidance = renderDeliveryGuidanceForMouth({
      code: 'hand_docx_positioned_write_blocked',
      detail: {
        toolName: 'docx_edit',
        sourcePath: '/workspace/学习笔记/图形学.docx',
        error: '当前命中复杂定位排版区域：包含“达到反走样。”的区域，暂不支持自动编辑。'
      }
    })

    expect(guidance).toBe(
      '最终交付时必须说明：图形学.docx 中该区域因使用 DOCX 绝对定位或锚定定位布局而无法安全自动编辑，所以没有自动修改该区域（命中区域：“达到反走样。”）；该区域需要用户手动处理，可继续处理其他非定位区域。'
    )
  })

  it('omits positioned region text when the tool error has no region', () => {
    const guidance = renderDeliveryGuidanceForMouth({
      code: 'hand_docx_positioned_write_blocked',
      detail: {
        toolName: 'docx_edit',
        sourcePath: '/workspace/report.docx',
        error: '当前命中复杂定位排版区域，暂不支持自动编辑。'
      }
    })

    expect(guidance).toContain('report.docx 中该区域因使用 DOCX 绝对定位或锚定定位布局')
    expect(guidance).not.toContain('命中区域：')
  })

  it('renders tool limit exceeded guidance for mouth', () => {
    const guidance = renderDeliveryGuidanceForMouth({
      code: 'hand_tool_limit_exceeded',
      detail: {
        toolCallCount: 11,
        limit: 10
      }
    })

    expect(guidance).toContain('工具调用次数已经超过上限')
    expect(guidance).toContain('当前为 11')
    expect(guidance).toContain('上限为 10')
    expect(guidance).toContain('工具调用预算耗尽')
  })

  it('does not render guidance for unrelated decision hints', () => {
    const guidance = renderDeliveryGuidanceForMouth({
      code: 'hand_tool_limit_near_exhausted',
      detail: {
        toolCallCount: 9,
        limit: 10
      }
    })

    expect(guidance).toBeUndefined()
  })
})
