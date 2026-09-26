/**
 * GFM without autolink literals (`https://…`, `www.…`, emails).
 *
 * remark-gfm always enables autolink literals and has no toggle. Bare URLs in
 * assistant markdown should stay plain text so `linkAccess` only applies to
 * explicit `[label](destination)` links, and emphasis like `**https://…**`
 * still parses correctly around Chinese punctuation.
 */

import { combineExtensions } from 'micromark-util-combine-extensions'
import { gfmFootnote } from 'micromark-extension-gfm-footnote'
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough'
import { gfmTable } from 'micromark-extension-gfm-table'
import { gfmTaskListItem } from 'micromark-extension-gfm-task-list-item'
import {
  gfmFootnoteFromMarkdown,
  gfmFootnoteToMarkdown
} from 'mdast-util-gfm-footnote'
import {
  gfmStrikethroughFromMarkdown,
  gfmStrikethroughToMarkdown
} from 'mdast-util-gfm-strikethrough'
import { gfmTableFromMarkdown, gfmTableToMarkdown } from 'mdast-util-gfm-table'
import {
  gfmTaskListItemFromMarkdown,
  gfmTaskListItemToMarkdown
} from 'mdast-util-gfm-task-list-item'

type RemarkPluginData = {
  settings?: object
  micromarkExtensions?: unknown[]
  fromMarkdownExtensions?: unknown[]
  toMarkdownExtensions?: unknown[]
}

export const gfmNoAutolinkMicromarkExtension = combineExtensions([
  gfmFootnote(),
  gfmStrikethrough(),
  gfmTable(),
  gfmTaskListItem()
])

export const gfmNoAutolinkFromMarkdown = [
  gfmFootnoteFromMarkdown(),
  gfmStrikethroughFromMarkdown(),
  gfmTableFromMarkdown(),
  gfmTaskListItemFromMarkdown()
]

const gfmNoAutolinkToMarkdown = {
  extensions: [
    gfmFootnoteToMarkdown(),
    gfmStrikethroughToMarkdown(),
    gfmTableToMarkdown(),
    gfmTaskListItemToMarkdown()
  ]
}

export default function remarkGfmNoAutolink(this: { data: () => RemarkPluginData }): undefined {
  const data = this.data()

  const micromarkExtensions = data.micromarkExtensions || (data.micromarkExtensions = [])
  const fromMarkdownExtensions = data.fromMarkdownExtensions || (data.fromMarkdownExtensions = [])
  const toMarkdownExtensions = data.toMarkdownExtensions || (data.toMarkdownExtensions = [])

  micromarkExtensions.push(gfmNoAutolinkMicromarkExtension)
  fromMarkdownExtensions.push(gfmNoAutolinkFromMarkdown)
  toMarkdownExtensions.push(gfmNoAutolinkToMarkdown)
}
