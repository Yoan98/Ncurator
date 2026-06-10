import readline from 'node:readline'
import { load } from 'cheerio'

const MAX_VISITED_PAGES = 3
const MAX_FOLLOW_LINKS = 2

class MockCrawlError extends Error {
  constructor(message, data) {
    super(message)
    this.name = 'MockCrawlError'
    this.data = data
  }
}

const readString = (value) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined

const tokenizeTopic = (value) => {
  if (typeof value !== 'string' || !value.trim()) return new Set()
  const words = value.toLowerCase().match(/[\u4e00-\u9fff]+|[a-z0-9_]+/g) || []
  const tokens = new Set(words)
  for (const word of words) {
    if (/^[\u4e00-\u9fff]+$/.test(word) && word.length > 1) {
      for (let index = 0; index < word.length - 1; index += 1) {
        tokens.add(word.slice(index, index + 2))
      }
    }
  }
  return tokens
}

const scoreText = (text, tokens) => {
  if (!text || tokens.size === 0) return 0
  const lowered = String(text).toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (lowered.includes(token)) score += 1
  }
  return score
}

const sameOrigin = (left, right) => {
  const leftUrl = new URL(left)
  const rightUrl = new URL(right)
  return leftUrl.origin === rightUrl.origin
}

const extractPage = async (url) => {
  const response = await fetch(url)
  const html = await response.text()
  const finalUrl = response.url || url
  if (!response.ok) {
    throw new MockCrawlError(`网页请求失败：${response.status}`, {
      url,
      final_url: finalUrl,
      status_code: response.status
    })
  }
  const $ = load(html)
  const title = $('title').first().text().trim() || undefined
  const publishedAt =
    $('meta[property="article:published_time"]').attr('content')
    || $('meta[name="publishdate"]').attr('content')
    || $('time').first().attr('datetime')
    || undefined
  const markdown = $('main').text().trim() || $('article').text().trim() || $('body').text().trim()
  const links = $('a[href]')
    .toArray()
    .map((node) => {
      const href = readString($(node).attr('href'))
      if (!href) return null
      return {
        href: new URL(href, finalUrl).toString(),
        ...(readString($(node).text()) ? { text: readString($(node).text()) } : {})
      }
    })
    .filter(Boolean)

  return {
    url,
    final_url: finalUrl,
    title,
    markdown,
    links: {
      internal: links.filter((link) => sameOrigin(finalUrl, link.href)),
      external: links.filter((link) => !sameOrigin(finalUrl, link.href))
    },
    metadata: publishedAt ? { published_time: publishedAt } : {}
  }
}

const flattenLinks = (raw) => {
  const groups = raw?.links
  if (!groups || typeof groups !== 'object') return []
  const internal = Array.isArray(groups.internal) ? groups.internal : []
  const external = Array.isArray(groups.external) ? groups.external : []
  return [...internal, ...external]
}

const scorePage = (raw, tokens) =>
  scoreText(`${raw?.title || ''}\n${raw?.markdown || ''}`, tokens)

const scoreLink = (link, tokens) => scoreText(`${link?.href || ''} ${link?.text || ''}`, tokens)

const handleCrawl = async ({ url, topic }) => {
  const topicTokens = tokenizeTopic(topic)
  const visitedResults = []
  const seedResult = await extractPage(url)
  visitedResults.push(seedResult)

  let selectedResult = seedResult
  let bestScore = scorePage(seedResult, topicTokens)

  if (topicTokens.size > 0) {
    const candidates = flattenLinks(seedResult)
      .filter((link) => sameOrigin(seedResult.final_url, link.href))
      .sort((left, right) => scoreLink(right, topicTokens) - scoreLink(left, topicTokens))
      .slice(0, MAX_FOLLOW_LINKS)

    for (const candidate of candidates) {
      if (visitedResults.length >= MAX_VISITED_PAGES) break
      if (visitedResults.some((item) => item.final_url === candidate.href)) continue
      const nextResult = await extractPage(candidate.href)
      visitedResults.push(nextResult)
      const nextScore = scorePage(nextResult, topicTokens)
      if (nextScore > bestScore) {
        selectedResult = nextResult
        bestScore = nextScore
      }
    }
  }

  return {
    selected_result: selectedResult,
    visited_results: visitedResults
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
})

rl.on('line', async (line) => {
  if (!line.trim()) return
  let request
  try {
    request = JSON.parse(line)
    if (request.action !== 'crawl') {
      throw new Error(`unsupported action: ${String(request.action || '')}`)
    }
    const data = await handleCrawl(request.input || {})
    process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, data })}\n`)
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        id: request?.id || '',
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof MockCrawlError && error.data ? { data: error.data } : {})
      })}\n`
    )
  }
})
