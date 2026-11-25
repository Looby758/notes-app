import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { countFolder } from './count'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orbit-size-'))
  mkdirSync(join(root, 'a', 'b', 'c'), { recursive: true })
  writeFileSync(join(root, 'one.txt'), 'x'.repeat(100))
  writeFileSync(join(root, 'a', 'two.bin'), Buffer.alloc(2000))
  writeFileSync(join(root, 'a', 'b', 'c', 'three.bin'), Buffer.alloc(30000))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('countFolder', () => {
  it('adds up everything inside, however deep', async () => {
    expect(await countFolder(root)).toEqual({ bytes: 32100, files: 3, folders: 3, complete: true })
    expect((await countFolder(join(root, 'a', 'b')))?.bytes).toBe(30000)
  })

  it('doesn’t follow shortcuts, so nothing is counted twice and loops can’t trap it', async () => {
    try {
      symlinkSync(root, join(root, 'a', 'loop'), 'dir')
    } catch {
      return
    }
    expect((await countFolder(root))?.bytes).toBe(32100)
  })

  it('stops when asked', async () => {
    expect(await countFolder(root, { cancelled: () => true })).toBeNull()
  })

  it('gives null for a folder that isn’t there', async () => {
    expect(await countFolder(join(root, 'nope'))).toBeNull()
  })
})
