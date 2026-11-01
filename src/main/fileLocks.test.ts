import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { covers, onRelease, openReads, releaseFiles, serveFile } from './fileLocks'

const folder = mkdtempSync(join(tmpdir(), 'orbit-locks-'))
const file = join(folder, 'film.mp4')
writeFileSync(file, Buffer.alloc(256 * 1024, 7))

describe('covers', () => {
  it('matches the file itself and anything in a folder', () => {
    expect(covers([file], file)).toBe(true)
    expect(covers([folder], file)).toBe(true)
    expect(covers([join(folder, 'film')], file)).toBe(false)
    expect(covers([join(folder, 'other.mp4')], file)).toBe(false)
  })
})

describe('serveFile', () => {
  it('answers a range with just that part', async () => {
    const res = serveFile(file, 'bytes=10-19')
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe(`bytes 10-19/${256 * 1024}`)
    expect(res.headers.get('Content-Type')).toBe('video/mp4')
    expect((await res.arrayBuffer()).byteLength).toBe(10)
  })

  it('refuses a range past the end', () => {
    expect(serveFile(file, `bytes=${256 * 1024}-`).status).toBe(416)
  })

  it('lets go of a file that is still being read when it is released', async () => {
    const before = openReads()
    const res = serveFile(file, null, { 'Access-Control-Allow-Origin': '*' })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    // Read a little and then stop, the way a paused video does.
    const reader = res.body!.getReader()
    await reader.read()
    expect(openReads()).toBe(before + 1)
    await releaseFiles(folder)
    expect(openReads()).toBe(before)
  })
})

describe('releaseFiles', () => {
  it('asks every viewer about the paths given', async () => {
    const asked: boolean[] = []
    onRelease((test) => void asked.push(test(file), test(join(tmpdir(), 'elsewhere.mp4'))))
    await releaseFiles([file])
    expect(asked).toEqual([true, false])
  })
})
