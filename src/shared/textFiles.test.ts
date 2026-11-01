import { describe, expect, it } from 'vitest'
import { decodeText, encodeText, isTextFile, jsonProblem, looksLikeText, wrapsLines } from './textFiles'

describe('isTextFile', () => {
  it('knows plain text, data and code files', () => {
    for (const name of ['notes.txt', 'Data/config.JSON', 'a/b.yaml', 'script.py', 'C:\\x\\run.ps1']) expect(isTextFile(name)).toBe(true)
  })
  it('leaves notes, boards, sheets, pictures and unknown files alone', () => {
    for (const name of ['Plan.md', 'Board.canvas', 'list.csv', 'logo.svg', 'photo.png', 'README', '.txt', 'archive.zip']) expect(isTextFile(name)).toBe(false)
  })
  it('wraps prose but not code', () => {
    expect(wrapsLines('a.txt')).toBe(true)
    expect(wrapsLines('a.json')).toBe(false)
  })
})

describe('looksLikeText', () => {
  it('spots binary files by their NUL bytes', () => {
    expect(looksLikeText(new TextEncoder().encode('hello\nworld'))).toBe(true)
    expect(looksLikeText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toBe(false)
  })
})

describe('decodeText / encodeText', () => {
  it('keeps Windows line endings and a byte-order mark when saving', () => {
    const raw = '\uFEFFone\r\ntwo\r\n'
    const { text, format } = decodeText(raw)
    expect(format).toEqual({ bom: true, crlf: true })
    expect(text).toBe('one\ntwo\n')
    // CodeMirror hands back \n line breaks.
    expect(encodeText('one\ntwo\nthree\n', format)).toBe('\uFEFFone\r\ntwo\r\nthree\r\n')
  })
  it('leaves plain files as they are', () => {
    const { text, format } = decodeText('a\nb')
    expect(encodeText(text, format)).toBe('a\nb')
  })
})

describe('jsonProblem', () => {
  it('is null for valid or empty JSON', () => {
    expect(jsonProblem('{"a": [1, 2]}')).toBeNull()
    expect(jsonProblem('  \n')).toBeNull()
  })
  it('says what is wrong', () => {
    expect(jsonProblem('{\n  "a": 1,\n}')).toMatch(/\(line 3\)$/)
    expect(jsonProblem('{"a": 1}\nx')).toBe('Unexpected non-whitespace character after JSON (line 2)')
  })
})
