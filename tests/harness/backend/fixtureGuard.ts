import { access } from 'node:fs/promises'

export const findMissingFixtures = async (paths: readonly string[]): Promise<string[]> => {
  const missing: string[] = []
  for (const item of paths) {
    try {
      await access(item)
    } catch {
      missing.push(item)
    }
  }
  return missing
}

export const assertRequiredFixtures = async (paths: readonly string[]): Promise<void> => {
  const missing = await findMissingFixtures(paths)
  if (missing.length === 0) return

  throw new Error(
    [
      '缺少测试前置文件，请先准备后再执行：',
      ...missing.map((item) => `- ${item}`),
      '准备完成后重新执行新的测试 runner 或指定 suite 命令。'
    ].join('\n')
  )
}
