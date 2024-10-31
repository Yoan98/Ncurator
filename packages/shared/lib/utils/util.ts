/**
   * 分割句子
   * @param text
   * @returns
   */
// todo 按照最大chunk使用迭代器取出句子,避免内存溢出
export const extractSentence = (text: string) => {
    const segmenter = new Intl.Segmenter(['CN', 'en'], { granularity: 'sentence' });
    const segments = Array.from(segmenter.segment(text));
    return segments
}