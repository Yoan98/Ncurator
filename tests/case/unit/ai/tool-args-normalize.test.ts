import { describe, expect, it } from 'vitest'
import { normalizeToolCallArgs } from '../../../../src/main/services/ai/human/shared/toolArgsNormalize'

describe('ai unit tool args normalize', () => {
  it('expands stringified arrays and objects at any depth', () => {
    const normalized = normalizeToolCallArgs({
      type: 'insert_slide',
      defaults: JSON.stringify({ fontFamily: 'Microsoft YaHei', color: '#FFFFFF' }),
      elements: JSON.stringify([
        {
          type: 'text',
          text: 'Hello',
          bounds: { x: 72, y: 86, width: 200, height: 24 },
          style: { fontSize: 14 }
        }
      ]),
      notes: '普通备注保持字符串'
    })

    expect(normalized.notes).toBe('普通备注保持字符串')
    expect(normalized.defaults).toEqual({ fontFamily: 'Microsoft YaHei', color: '#FFFFFF' })
    expect(normalized.elements).toEqual([
      {
        type: 'text',
        text: 'Hello',
        bounds: { x: 72, y: 86, width: 200, height: 24 },
        style: { fontSize: 14 }
      }
    ])
  })

  it('expands stringified items inside already-parsed arrays and objects', () => {
    const normalized = normalizeToolCallArgs({
      operations: [
        {
          type: 'add_element',
          element: JSON.stringify({
            type: 'shape',
            shape: 'rect',
            bounds: { x: 0, y: 0, width: 10, height: 10 }
          })
        }
      ]
    })

    expect(normalized.operations).toEqual([
      {
        type: 'add_element',
        element: {
          type: 'shape',
          shape: 'rect',
          bounds: { x: 0, y: 0, width: 10, height: 10 }
        }
      }
    ])
  })

  it('unwraps multi-encoded JSON strings up to the depth limit', () => {
    const inner = [{ type: 'text', text: 'x', bounds: { x: 1, y: 1, width: 2, height: 3 } }]
    const once = JSON.stringify(inner)
    const twice = JSON.stringify(once)

    expect(normalizeToolCallArgs({ elements: twice }).elements).toEqual(inner)
  })

  it('leaves ordinary strings, paths, and invalid JSON containers unchanged', () => {
    const args = {
      sourcePath: 'C:\\Users\\Admin\\deck.pptx',
      command: 'echo hello',
      query: '查找 {todo} 与 [draft]',
      broken: '{not-json',
      numberLike: '42',
      boolLike: 'true'
    }
    const normalized = normalizeToolCallArgs(args)
    expect(normalized.sourcePath).toBe(args.sourcePath)
    expect(normalized.command).toBe(args.command)
    expect(normalized.query).toBe(args.query)
    expect(normalized.numberLike).toBe('42')
    expect(normalized.boolLike).toBe('true')
    expect(normalized.broken).toBe('{not-json')
  })

  it('repairs mildly broken nested JSON containers via jsonrepair', () => {
    const normalized = normalizeToolCallArgs({
      // trailing comma — common model slip inside an already-stringified payload
      elements: '[{"type":"text","text":"ok","bounds":{"x":1,"y":1,"width":2,"height":3}},]'
    })
    expect(normalized.elements).toEqual([
      { type: 'text', text: 'ok', bounds: { x: 1, y: 1, width: 2, height: 3 } }
    ])
  })
})
