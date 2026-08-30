import { describe, expect, it } from 'vitest'
import { SKILL_DEFINITIONS } from '../../../../src/main/services/ai/human/skills'
import { TEXT_FILE_TOOL_SPECS } from '../../../../src/main/services/ai/human/tools/textFile/toolSpecs'
import {
  TEXT_FILE_EDIT_SCHEMA,
  TEXT_FILE_READ_MAX_BYTES,
  TEXT_FILE_READ_MAX_LINES,
  TEXT_FILE_READ_SCHEMA,
  TEXT_FILE_SEARCH_MAX_MATCHES,
  TEXT_FILE_SEARCH_SCHEMA
} from '../../../../src/main/services/ai/human/tools/textFile/toolSchemas'
import type { TextFileEditOutput } from '../../../../src/main/services/ai/human/tools/textFile/outputTypes'

describe('ai unit text-file tool contract', () => {
  it('binds three tools to the text-file skill', () => {
    expect(TEXT_FILE_TOOL_SPECS.map((spec) => spec.name)).toEqual([
      'text_file_read',
      'text_file_search',
      'text_file_edit'
    ])
    expect(SKILL_DEFINITIONS['text-file'].toolNames).toEqual([
      'text_file_read',
      'text_file_search',
      'text_file_edit'
    ])
    TEXT_FILE_TOOL_SPECS.forEach((spec) => {
      expect(spec.skillIds).toEqual(['text-file'])
      expect(spec.familyId).toBe('text-file')
      expect(typeof spec.modelResult.renderSuccess).toBe('function')
    })
  })

  it('rejects structured document paths', () => {
    ;['report.docx', 'slides.pptx', 'notes.pdf', 'data.xlsx'].forEach((sourcePath) => {
      expect(TEXT_FILE_READ_SCHEMA.safeParse({ sourcePath }).success).toBe(false)
      expect(
        TEXT_FILE_EDIT_SCHEMA.safeParse({
          sourcePath,
          action: 'create',
          content: 'x'
        }).success
      ).toBe(false)
      expect(TEXT_FILE_SEARCH_SCHEMA.safeParse({ sourcePath, query: 'x' }).success).toBe(false)
    })
    expect(TEXT_FILE_READ_SCHEMA.safeParse({ sourcePath: 'notes.md' }).success).toBe(true)
  })

  it('keeps read pagination limits in schema', () => {
    expect(TEXT_FILE_READ_MAX_LINES).toBe(2_000)
    expect(TEXT_FILE_READ_MAX_BYTES).toBe(51_200)
    expect(
      TEXT_FILE_READ_SCHEMA.safeParse({
        sourcePath: 'notes.md',
        startLine: 1,
        lineCount: TEXT_FILE_READ_MAX_LINES
      }).success
    ).toBe(true)
    expect(
      TEXT_FILE_READ_SCHEMA.safeParse({
        sourcePath: 'notes.md',
        lineCount: TEXT_FILE_READ_MAX_LINES + 1
      }).success
    ).toBe(false)
  })

  it('accepts search literal and regex modes', () => {
    expect(
      TEXT_FILE_SEARCH_SCHEMA.safeParse({
        sourcePath: 'notes.md',
        query: 'hello'
      }).success
    ).toBe(true)
    expect(
      TEXT_FILE_SEARCH_SCHEMA.safeParse({
        sourcePath: 'notes.md',
        query: 'h\\w+',
        mode: 'regex'
      }).success
    ).toBe(true)
    expect(TEXT_FILE_SEARCH_MAX_MATCHES).toBe(10)
  })

  it('accepts four edit actions and empty edit output', () => {
    expect(
      TEXT_FILE_EDIT_SCHEMA.safeParse({
        sourcePath: 'notes.md',
        action: 'create',
        content: 'new'
      }).success
    ).toBe(true)
    expect(
      TEXT_FILE_EDIT_SCHEMA.safeParse({
        sourcePath: 'notes.md',
        action: 'rewrite',
        content: 'all new'
      }).success
    ).toBe(true)
    expect(
      TEXT_FILE_EDIT_SCHEMA.safeParse({
        sourcePath: 'notes.md',
        action: 'edit',
        edits: [{ oldText: 'a', newText: 'b' }]
      }).success
    ).toBe(true)
    expect(
      TEXT_FILE_EDIT_SCHEMA.safeParse({
        sourcePath: 'notes.md',
        action: 'replaceAll',
        oldText: 'a',
        newText: 'b'
      }).success
    ).toBe(true)

    const editOutput = {} satisfies TextFileEditOutput
    expect(editOutput).toEqual({})
  })
})
