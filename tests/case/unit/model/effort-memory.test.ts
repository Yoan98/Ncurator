import { describe, expect, it } from 'vitest'
import { normalizeSelectionEffort } from '../../../../src/shared/workbenchModelSelection'

/**
 * WB-COMPOSER-018-AC3 / AC4：强度与模型一起记住，切换模型后再切回应当恢复。
 *
 * 这里验证「按模型身份记住档位」这条规则本身：
 * 记忆命中时带回原档位，目录不再支持该档时回落到该模型的默认档。
 */

type Selection = { configId: string; modelName: string; effort?: string; manual?: boolean }

/** 与选择器一致的记忆键。 */
const keyOf = (selection: { configId: string; modelName: string }): string =>
  `${selection.configId}\u0000${selection.modelName}`

/** 复刻 WorkbenchModelSelector.selectModel 的档位回填规则。 */
const selectModel = (
  memory: Map<string, string>,
  target: { configId: string; modelName: string }
): Selection => {
  const remembered = memory.get(keyOf(target))
  const selected: Selection = { configId: target.configId, modelName: target.modelName }
  if (remembered) selected.effort = remembered
  return selected
}

const deepseekEffort = {
  default: 'high',
  options: [
    { value: 'low', label: '轻' },
    { value: 'high', label: '高' },
    { value: 'max', label: '极高' }
  ]
}

describe('effort memory across model switches', () => {
  it('restores the tier chosen for that model when switching back', () => {
    const memory = new Map<string, string>()
    const flash = { configId: 'cfg-deepseek', modelName: 'deepseek-flash' }
    const other = { configId: 'cfg-deepseek', modelName: 'deepseek-pro' }

    // 用户在 flash 上选了最高档。
    memory.set(keyOf(flash), 'max')
    // 切到别的模型，再切回 flash。
    const switchedAway = selectModel(memory, other)
    expect(switchedAway.effort).toBeUndefined()
    const switchedBack = selectModel(memory, flash)
    expect(switchedBack.effort).toBe('max')

    // 目录仍支持该档位时，normalize 必须原样保留，不能回落默认。
    const normalized = normalizeSelectionEffort(switchedBack as never, deepseekEffort as never)
    expect(normalized?.effort).toBe('max')
  })

  it('keeps each model memory separate', () => {
    const memory = new Map<string, string>()
    const a = { configId: 'cfg', modelName: 'model-a' }
    const b = { configId: 'cfg', modelName: 'model-b' }
    memory.set(keyOf(a), 'max')
    memory.set(keyOf(b), 'low')
    expect(selectModel(memory, a).effort).toBe('max')
    expect(selectModel(memory, b).effort).toBe('low')
  })

  it('does not leak a tier across configs that share the model name', () => {
    // 同一个 modelName 挂在两个渠道下，档位不能互相串。
    const memory = new Map<string, string>()
    memory.set(keyOf({ configId: 'cfg-1', modelName: 'deepseek-flash' }), 'max')
    expect(selectModel(memory, { configId: 'cfg-2', modelName: 'deepseek-flash' }).effort).toBeUndefined()
  })

  it('falls back to the model default when the remembered tier is no longer offered', () => {
    const memory = new Map<string, string>()
    const target = { configId: 'cfg', modelName: 'deepseek-flash' }
    memory.set(keyOf(target), 'xhigh')
    // 目录把 xhigh 收回去了，只剩 low/high/max。
    const normalized = normalizeSelectionEffort(selectModel(memory, target) as never, deepseekEffort as never)
    expect(normalized?.effort).toBe('high')
  })

  it('uses the model default when nothing was ever chosen', () => {
    const normalized = normalizeSelectionEffort(
      selectModel(new Map(), { configId: 'cfg', modelName: 'never-touched' }) as never,
      deepseekEffort as never
    )
    expect(normalized?.effort).toBe('high')
  })
})
