import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseReleaseTag } from './tag.mjs'

const parseNotes = (content) => {
  const notes = String(content || '')
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/gu, '\n')
    .trim()
  const headings = [...notes.matchAll(/^##[\t ]+(中文|English)[\t ]*$/gmu)]
  if (
    headings.length !== 2 ||
    headings[0][1] !== '中文' ||
    headings[1][1] !== 'English' ||
    headings[0].index !== 0
  ) {
    throw new Error('release notes require exactly one ## 中文 section followed by ## English')
  }
  const chinese = notes.slice(headings[0][0].length, headings[1].index).trim()
  const english = notes.slice(headings[1].index + headings[1][0].length).trim()
  for (const [language, body, text] of [
    ['中文', chinese, /\p{Script=Han}/u],
    ['English', english, /[a-zA-Z]{3,}/u]
  ]) {
    const changes = body.match(/^[-*+]\s+\S.*$/gmu) || []
    if (!changes.some((change) => text.test(change))) {
      throw new Error(`release notes ${language} section requires a non-empty change bullet`)
    }
  }
  return { notes: `${notes}\n`, chinese, english }
}

export const validateReleaseNotes = (content) => parseNotes(content).notes

export const readReleaseNotes = async ({ notes, notesFile, root = process.cwd() }) => {
  if (Boolean(notes) === Boolean(notesFile)) {
    throw new Error(
      'provide exactly one of --notes <text> or --notes-file <path> with bilingual changes'
    )
  }
  return validateReleaseNotes(
    notesFile ? await readFile(path.resolve(root, notesFile), 'utf8') : notes
  )
}

export const renderGitHubReleaseNotes = ({ tag, notes, repositoryUrl }) => {
  const { chinese, english } = parseNotes(notes)
  const { family } = parseReleaseTag(tag)
  const platform = family === 'windows' ? 'Windows x64' : 'macOS arm64'
  const extension = family === 'windows' ? 'EXE' : 'DMG'
  const sourceUrl = `${repositoryUrl}/tree/${tag}`
  return [
    '## 中文',
    '',
    chinese,
    '',
    '### 下载',
    '',
    `平台：${platform}。请下载下方的 ${extension} 安装包。`,
    'SHA256SUMS 提供安装包的 SHA-256 校验值。',
    '',
    `[对应源码](${sourceUrl}) · [官网更新日志](https://www.guanzhangai.cn/zh/changelog)`,
    '',
    '## English',
    '',
    english,
    '',
    '### Download',
    '',
    `Platform: ${platform}. Download the ${extension} installer below.`,
    'SHA256SUMS contains the SHA-256 checksum of the installer.',
    '',
    `[Source code](${sourceUrl}) · [Website changelog](https://www.ncurator.com/en/changelog)`,
    ''
  ].join('\n')
}
