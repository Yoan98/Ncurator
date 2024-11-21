import * as math from 'mathjs';
/**
 *  Returns the cosine similarity between two vectors.
 * @param a
 * @param b
 * @returns
 */
export function cosineSimilarity(a: number[], b: number[]): number {
    // 计算点积
    const dotProduct = math.dot(a, b);

    // 计算向量范数（模长）
    const normA = math.norm(a) as number;
    const normB = math.norm(b) as number;

    // 避免除以零，保证分母最小值为 1e-9
    const denominator = Math.max(normA * normB, 1e-9);

    // 计算余弦相似度
    return math.divide(dotProduct, denominator) || 0;
}