import { describe, expect, it } from 'vitest'
import { parseEffort } from '../../../../src/shared/llmEffort'

/**
 * 后端公开目录下发的 effort 载荷解析。
 *
 * 这里的用例来自真实事故：后台运营没填档位展示名时，目录接口下发
 * "label": null，而解析层把 label 当必填，导致整份档位配置被丢弃——
 * 表现就是「后台配了强度、桌面切换自定义模型却不显示强度」。
 */
describe('backend effort payload', () => {
  it('parses the deepseek template the backend sends', () => {
    const parsed = parseEffort({
      default: 'high',
      options: [
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' },
        { value: 'max', label: 'Max' }
      ]
    })
    expect(parsed).toEqual({
      default: 'high',
      options: [
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' },
        { value: 'max', label: 'Max' }
      ]
    })
  })

  it('keeps the whole config when the backend sends a null label', () => {
    const parsed = parseEffort({
      default: 'high',
      options: [
        { value: 'low', label: null },
        { value: 'high', label: null },
        { value: 'max', label: null }
      ]
    })
    // 整份配置必须保留，否则界面完全不显示强度。
    expect(parsed?.default).toBe('high')
    expect(parsed?.options.map((option) => option.value)).toEqual(['low', 'high', 'max'])
    // label 缺失时退回 value，保证仍有可读文案。
    expect(parsed?.options.map((option) => option.label)).toEqual(['low', 'high', 'max'])
  })

  it('parses the qwen template with its own tier names', () => {
    const parsed = parseEffort({
      default: 'xhigh',
      options: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'xhigh', label: 'XHigh' }
      ]
    })
    expect(parsed?.default).toBe('xhigh')
    expect(parsed?.options).toHaveLength(3)
  })

  it('still drops a payload whose structure is genuinely broken', () => {
    expect(parseEffort(null)).toBeUndefined()
    expect(parseEffort({})).toBeUndefined()
    expect(parseEffort({ default: 'high', options: [] })).toBeUndefined()
    expect(parseEffort({ default: 'high', options: 'nope' })).toBeUndefined()
    expect(parseEffort({ default: 'high', options: [{ value: '', label: 'x' }] })).toBeUndefined()
    // 默认档不在选项里同样视为坏配置。
    expect(parseEffort({ default: 'max', options: [{ value: 'low', label: 'L' }] })).toBeUndefined()
  })

  it('treats a model without effort as having no tiers', () => {
    // 后台把型号能力设成空数组时，压根不会有 effort 字段。
    expect(parseEffort(undefined)).toBeUndefined()
  })
})
