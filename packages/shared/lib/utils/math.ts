import * as tf from '@tensorflow/tfjs';
/**
 *  Returns the cosine similarity between two vectors.
 * @param a
 * @param b
 * @returns
 */
export function cosineSimilarity(a: number[] | tf.Tensor1D, b: number[] | tf.Tensor1D): number {

    return tf.tidy(() => {
        const tensorA = Array.isArray(a) ? tf.tensor1d(a) : a;
        const tensorB = Array.isArray(b) ? tf.tensor1d(b) : b;

        const dotProduct = tensorA.dot(tensorB);

        const normA = tf.norm(tensorA);
        const normB = tf.norm(tensorB);
        return dotProduct.div(normA.mul(normB).maximum(tf.scalar(1e-9))).arraySync() as number;
    });
}