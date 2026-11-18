import type { LlmEffort, LlmEffortOption } from './llmPresets'

/**
 * 思考强度目录解析。目录结构不合法时一律按“该模型不提供强度选择”处理。
 *
 * 上限放宽到 7：上游单个模型最多能开 6 档（如馆长渠道），旧上限 4 会把
 * 合法配置整份丢掉，表现就是“后台配了但桌面不显示”。
 */
const MAX_OPTIONS = 7
const MAX_LABEL_LENGTH = 24

export const parseEffort = (value: unknown): LlmEffort | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  const fallback = row.default
  if (typeof fallback !== 'string' || !fallback) return undefined
  if (!Array.isArray(row.options) || row.options.length === 0 || row.options.length > MAX_OPTIONS) return undefined
  const options: LlmEffortOption[] = []
  for (const item of row.options) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined
    const { value: rawValue, label } = item as Record<string, unknown>
    if (typeof rawValue !== 'string' || !rawValue) return undefined
    if (options.some((option) => option.value === rawValue)) return undefined
    /*
     * label 缺失或为 null 时不能整份丢弃，退回 value 本身。
     *
     * 后端曾经在运营没填展示名时下发 "label": null，而这里把 label 当必填，
     * 结果一个 null 就让整份档位配置失效——后台配了强度、桌面却完全不显示。
     * 展示名只是文案，缺失时用 value 兜底比丢掉整个能力合理得多。
     */
    const rawLabel = typeof label === 'string' ? label.trim() : ''
    if (rawLabel.length > MAX_LABEL_LENGTH) return undefined
    options.push({ value: rawValue, label: rawLabel || rawValue })
  }
  return options.some((option) => option.value === fallback) ? { default: fallback, options } : undefined
}

/** 目录里的强度配置描述的是当前模型，切换模型后旧档位不可继续沿用。 */
export const resolveEffort = (effort: LlmEffort | undefined, value: string | undefined): string | undefined => {
  if (!effort) return undefined
  return value && effort.options.some((option) => option.value === value) ? value : effort.default
}
