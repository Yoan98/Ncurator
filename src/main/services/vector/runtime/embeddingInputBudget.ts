import { embeddingInputBudget } from '../../../../shared/embeddingModels'

type TextBoundary = {
  offset: number
  tokens: number
}

const estimateCodePointTokens = (point: string): number =>
  Math.max(
    Buffer.byteLength(point, 'utf8'),
    Buffer.byteLength(point.normalize('NFKD').toLowerCase(), 'utf8')
  )

/**
 * 逐 Unicode 码点取原始 UTF-8 字节数与 NFKD、小写展开后的字节数较大值，再累加为保守估计。
 * 通用远程接口没有标准 tokenizer；此估计不是精确计数，也不保证覆盖任意服务商的分词行为。
 *
 * Sum the larger UTF-8 byte length of each Unicode code point and its NFKD/lowercase expansion
 * as a conservative estimate. Generic remote APIs have no standard tokenizer; this is neither
 * an exact token count nor a guarantee for every provider's tokenization behavior.
 */
export function estimateEmbeddingTokens(text: string): number {
  let tokens = 0
  for (const point of text) tokens += estimateCodePointTokens(point)
  return tokens
}

/**
 * 整批输入在发送前按同一内容预算校验，超限时报告位置和预算，不回显文本、不静默截断。
 *
 * Validate the complete batch against the same content budget before sending it. Report the
 * input position and budget on overflow without echoing text or silently truncating it.
 */
export function assertEmbeddingInputBudget(texts: readonly string[], maxInputTokens: number): void {
  const { reservedTokens, contentTokenBudget } = embeddingInputBudget(maxInputTokens)
  for (let index = 0; index < texts.length; index += 1) {
    const tokens = estimateEmbeddingTokens(texts[index])
    if (tokens > contentTokenBudget) {
      throw new Error(
        `Remote embedding input ${index + 1} exceeds maxInputTokens=${maxInputTokens}: ` +
          `estimated ${tokens} tokens, content budget ${contentTokenBudget} tokens ` +
          `(${reservedTokens} reserved). Split the input before embedding; automatic truncation is disabled.`
      )
    }
  }
}

/**
 * 单遍扫描保留各级最近边界及其累计预算，溢出时优先在段落、句子、空白处切分，否则按完整码点切分。
 * 已扫描的尾部通过累计值继续使用，不回扫、不规范化原文，保持线性复杂度及切片完整拼接。
 * 若单个码点的估计已超过内容预算，则明确报错，因为无法同时满足码点完整与预算上限。
 *
 * Scan once, retaining the latest paragraph, sentence, and whitespace boundaries and their
 * cumulative budgets. Prefer those boundaries on overflow, otherwise split at a complete code
 * point. Reuse scanned suffixes through cumulative totals without rescanning or normalizing
 * the original text, preserving linear complexity and exact reconstruction. Reject a single
 * code point whose estimate exceeds the content budget because it cannot be split safely.
 */
export function splitEmbeddingText(text: string, maxInputTokens: number): string[] {
  const { contentTokenBudget } = embeddingInputBudget(maxInputTokens)
  if (!text) return [text]

  const chunks: string[] = []
  let start = 0
  let startTokens = 0
  let end = 0
  let tokens = 0
  let paragraph: TextBoundary | undefined
  let sentence: TextBoundary | undefined
  let whitespace: TextBoundary | undefined

  for (const point of text) {
    const pointTokens = estimateCodePointTokens(point)
    if (pointTokens > contentTokenBudget) {
      throw new Error(
        `Cannot split embedding input with maxInputTokens=${maxInputTokens}: ` +
          `a Unicode code point requires an estimated ${pointTokens} tokens, ` +
          `exceeding the content budget of ${contentTokenBudget}. Increase maxInputTokens.`
      )
    }
    while (tokens + pointTokens - startTokens > contentTokenBudget) {
      const boundary =
        paragraph && paragraph.offset > start
          ? paragraph
          : sentence && sentence.offset > start
            ? sentence
            : whitespace && whitespace.offset > start
              ? whitespace
              : { offset: end, tokens }
      chunks.push(text.slice(start, boundary.offset))
      start = boundary.offset
      startTokens = boundary.tokens
    }

    end += point.length
    tokens += pointTokens
    const boundary = { offset: end, tokens }
    if (/[\r\n\u2028\u2029]/u.test(point)) paragraph = boundary
    if (/[.!?。！？；;…]/u.test(point)) sentence = boundary
    if (/\s/u.test(point)) whitespace = boundary
  }
  chunks.push(text.slice(start))
  return chunks
}
