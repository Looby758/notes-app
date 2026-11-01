import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Each "computer" has its own settings folder; the answer to "which version?" is set per test.
const env = vi.hoisted(() => ({ userData: '', answer: 0, asked: 0 }))
vi.mock('electron', () => ({
  app: { getPath: () => env.userData, on: () => undefined },
  dialog: {
    showMessageBox: async () => {
      env.asked++
      return { response: env.answer }
    }
  },
  BrowserWindow: class {}
}))

type Sync = typeof import('./orbitSync')

interface Computer {
  userData: string
  value: unknown
  themes: string
  sync: Sync
}

let dir: string
let notes: string

async function computer(name: string): Promise<Computer> {
  vi.resetModules()
  const sync = await import('./orbitSync')
  const c: Computer = { userData: join(dir, name), value: null, themes: join(dir, name, 'themes'), sync }
  mkdirSync(c.userData, { recursive: true })
  env.userData = c.userData
  sync.setupOrbitSync({
    root: () => notes,
    enabled: () => true,
    window: () => null,
    parts: {
      settings: { kind: 'value', read: () => c.value, write: (v) => (c.value = v) },
      themes: { kind: 'folder', folder: () => c.themes, reload: () => undefined }
    }
  })
  return c
}

async function run(c: Computer): Promise<void> {
  env.userData = c.userData
  await c.sync.syncOrbit()
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orbit-sync-'))
  notes = join(dir, 'notes')
  mkdirSync(notes)
  env.answer = 0
  env.asked = 0
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('Orbit synced between two computers', () => {
  it('takes settings and themes from one computer to the other, and changes back again', async () => {
    const pc = await computer('pc')
    pc.value = { editorFontSize: 18 }
    mkdirSync(join(pc.themes, 'walking-dead', 'pictures'), { recursive: true })
    writeFileSync(join(pc.themes, 'walking-dead', 'theme.json'), '{"name":"TWD"}')
    writeFileSync(join(pc.themes, 'walking-dead', 'pictures', 'daryl.jpg'), Buffer.from([1, 2, 3]))
    await run(pc)

    const mac = await computer('mac')
    await run(mac)
    expect(mac.value).toEqual({ editorFontSize: 18 })
    expect(readFileSync(join(mac.themes, 'walking-dead', 'theme.json'), 'utf8')).toBe('{"name":"TWD"}')
    expect([...readFileSync(join(mac.themes, 'walking-dead', 'pictures', 'daryl.jpg'))]).toEqual([1, 2, 3])

    // Changed on the Mac: the PC takes it in, without asking.
    mac.value = { editorFontSize: 20 }
    rmSync(join(mac.themes, 'walking-dead'), { recursive: true })
    await run(mac)
    await run(pc)
    expect(pc.value).toEqual({ editorFontSize: 20 })
    expect(existsSync(join(pc.themes, 'walking-dead'))).toBe(false)
    expect(env.asked).toBe(0)
  })

  it('asks which version to keep when both changed, and keeps the one you pick', async () => {
    const pc = await computer('pc')
    pc.value = { editorFontSize: 18 }
    await run(pc)
    const mac = await computer('mac')
    await run(mac)

    pc.value = { editorFontSize: 22 }
    await run(pc)
    mac.value = { editorFontSize: 14 }
    env.answer = 1 // "Keep the PC's"
    await run(mac)
    expect(env.asked).toBe(1)
    expect(mac.value).toEqual({ editorFontSize: 22 })

    // Settled: nobody is asked again.
    await run(pc)
    await run(mac)
    expect(env.asked).toBe(1)
  })

  it('"Decide later" leaves both alone and doesn’t ask again until something changes', async () => {
    const pc = await computer('pc')
    pc.value = { a: 1 }
    await run(pc)
    const mac = await computer('mac')
    mac.value = { a: 2 }
    env.answer = 2
    await run(mac)
    await run(mac)
    expect(env.asked).toBe(1)
    expect(mac.value).toEqual({ a: 2 })
    expect(pc.value).toEqual({ a: 1 })
  })

  it('waits for a folder’s files if Google Drive hasn’t finished downloading them', async () => {
    const pc = await computer('pc')
    mkdirSync(join(pc.themes, 'ocean'), { recursive: true })
    writeFileSync(join(pc.themes, 'ocean', 'theme.json'), '{}')
    await run(pc)
    const blobs = join(notes, '.notesapp', 'orbit', 'files')
    const moved = join(dir, 'blobs-later')
    // Drive has the list but not the files yet.
    rmSync(moved, { recursive: true, force: true })
    renameSync(blobs, moved)

    const mac = await computer('mac')
    await run(mac)
    expect(existsSync(join(mac.themes, 'ocean'))).toBe(false)

    renameSync(moved, blobs)
    await run(mac)
    expect(readFileSync(join(mac.themes, 'ocean', 'theme.json'), 'utf8')).toBe('{}')
  })
})
