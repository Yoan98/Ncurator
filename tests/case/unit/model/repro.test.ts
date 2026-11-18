import { describe, expect, it } from 'vitest'
import { resolveSelectedWorkbenchModel, normalizeSelectionEffort } from '../../../../src/shared/workbenchModelSelection'

const effort = {
  default: 'high',
  options: [
    { value: 'low', label: 'Low' },
    { value: 'high', label: 'High' },
    { value: 'max', label: 'Max' }
  ]
}

describe('repro: switch model away and back', () => {
  it('shows what happens to a chosen tier', () => {
    // 1. 选 deepseek-flash + max
    let selection = { configId: 'cfg1', modelName: 'm1', effort: 'max' as string | undefined }
    // 2. 切到另一个模型（selectModel 清空 effort）
    selection = { configId: 'cfg1', modelName: 'm2' }
    // 3. 切回来（selectModel 不会恢复档位，因为没历史）
    selection = { configId: 'cfg1', modelName: 'm1' }
    const normalized = normalizeSelectionEffort(selection, effort as never)
    console.log('切回后:', JSON.stringify(normalized))
    console.log('预期保留 max，实际:', normalized?.effort ?? '(丢失 → 会回落到默认 high)')
    expect(normalized?.effort ?? effort.default).toBe('high')  // 证明丢失后回落默认
  })
})
