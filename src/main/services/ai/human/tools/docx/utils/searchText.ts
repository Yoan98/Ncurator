import { normalizeDocxText } from '../adapters/ooxml/nodeSpec'

export const normalizeDocxSearchText = (value: string): string =>
  normalizeDocxText(String(value || '').normalize('NFKC'))
