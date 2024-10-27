import * as tf from '@tensorflow/tfjs';
/**
 *  Returns the cosine similarity between two vectors.
 * @param a
 * @param b
 * @returns
 */
export function cosineSimilarity(a: tf.Tensor1D, b: tf.Tensor1D): number {

    return tf.tidy(() => {

        const dotProduct = a.dot(b);

        const normA = tf.norm(a);
        const normB = tf.norm(b);
        return dotProduct.div(normA.mul(normB).maximum(tf.scalar(1e-9))).arraySync() as number;
    });
}