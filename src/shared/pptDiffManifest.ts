export type SupportedPptDiffManifest = {
  version: 4
  slides: unknown[]
}

export function assertSupportedPptDiffManifest(
  value: unknown
): asserts value is SupportedPptDiffManifest {
  if (
    !value ||
    typeof value !== 'object' ||
    (value as { version?: unknown }).version !== 4 ||
    !Array.isArray((value as { slides?: unknown }).slides)
  ) {
    throw new Error('PPT 审核内容格式已过期，请重新生成修改记录')
  }
}
