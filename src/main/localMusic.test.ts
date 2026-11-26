import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// A music folder that can stop answering, like Google Drive on a Mac that's signed out or just woke up.
const root = mkdtempSync(join(tmpdir(), 'orbit-music-'))
const music = join(root, 'Music')
mkdirSync(music)
const never = <T>(): Promise<T> => new Promise<T>(() => undefined)
const state = { rootHangs: false, hangingFile: '' }

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'music' ? music : root) },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  ipcMain: { handle: () => undefined }
}))
vi.mock('chokidar', () => ({ watch: () => ({ on: () => undefined, close: async () => undefined }) }))
vi.mock('./log', () => ({ logError: () => undefined }))
vi.mock('music-metadata', () => ({
  parseFile: (full: string) =>
    full.endsWith(state.hangingFile) && state.hangingFile ? never() : Promise.resolve({ common: { title: 'Real title', artist: 'Real artist' }, format: { duration: 60 } })
}))
vi.mock('fs/promises', () => ({
  readdir: (dir: string) =>
    state.rootHangs && dir === music
      ? never()
      : Promise.resolve(['Artist - One.mp3', 'Artist - Two.mp3'].map((name) => ({ name, isDirectory: () => false, isFile: () => true }))),
  stat: () => Promise.resolve({ mtimeMs: 1000, size: 10 })
}))

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  state.rootHangs = false
  state.hangingFile = ''
  writeFileSync(join(root, 'local-music.json'), '{}')
})
afterEach(() => vi.useRealTimers())

describe('library', () => {
  it('still answers when one song file never finishes reading', async () => {
    state.hangingFile = 'Two.mp3'
    const { library } = await import('./localMusic')
    const answer = library()
    await vi.advanceTimersByTimeAsync(25_000)
    const lib = await answer
    expect(lib.songs.map((s) => s.title).sort()).toEqual(['Real title', 'Two'])
  })

  it('shows the songs from last time when the folder stops answering', async () => {
    let mod = await import('./localMusic')
    await mod.library()
    vi.resetModules()
    state.rootHangs = true
    mod = await import('./localMusic')
    const answer = mod.library()
    await vi.advanceTimersByTimeAsync(7_000)
    expect((await answer).songs).toHaveLength(2)
  })

  it('says the folder isn’t answering when there is nothing from last time', async () => {
    state.rootHangs = true
    const { library } = await import('./localMusic')
    const answer = library()
    const failed = expect(answer).rejects.toThrow(/isn’t answering/)
    await vi.advanceTimersByTimeAsync(16_000)
    await failed
  })
})
