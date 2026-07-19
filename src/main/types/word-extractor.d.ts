declare module 'word-extractor' {
  export type WordExtractorDocument = {
    getBody(options?: { filterUnicode?: boolean }): string
  }

  export default class WordExtractor {
    extract(source: string | Buffer): Promise<WordExtractorDocument>
  }
}
