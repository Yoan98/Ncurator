import { normalizeDocxText } from '../adapters/ooxml/blockSpec'

export const normalizeDocxSearchText = (value: string): string =>
  normalizeDocxText(String(value || '').normalize('NFKC'))
