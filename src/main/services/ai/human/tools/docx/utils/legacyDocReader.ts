import WordExtractor from 'word-extractor'

export const extractLegacyDocBody = async (source: string | Buffer): Promise<string> => {
  const extractor = new WordExtractor()
  const document = await extractor.extract(source)
  return document.getBody({ filterUnicode: false })
}

export const splitLegacyDocParagraphs = (body: string): string[] => {
  const normalized = String(body || '')
    .split(String.fromCharCode(0))
    .join('')
    .replace(/\r\n?/g, '\n')
    .split(String.fromCharCode(11))
    .join('\n')
    .split(String.fromCharCode(12))
    .join('\n')
  if (!normalized) return []
  return normalized.split('\n')
}
