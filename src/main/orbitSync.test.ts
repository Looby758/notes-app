import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
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
const { whichVersionText } = await import('./orbitSync')

interface Computer {
  userData: string
  value: unknown
  themes: string
  sync: Sync
}

let dir: string
let notes: string

async function computer(name: string, readOnly = false): Promise<Computer> {
  vi.resetModules()
  const sync = await import('./orbitSync')
  const c: Computer = { userData: join(dir, name), value: null, themes: join(dir, name, 'themes'), sync }
  mkdirSync(c.userData, { recursive: true })
  env.userData = c.userData
  sync.setupOrbitSync({
    root: () => notes,
    enabled: () => true,
    window: () => null,
    readOnly,
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

/** Everything in the notes folder's sync files, to check nothing there changed. */
function notesFolderSnapshot(): string {
  const orbit = join(notes, '.notesapp', 'orbit')
  if (!existsSync(orbit)) return ''
  const out: string[] = []
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name)
      if (e.isDirectory()) walk(full)
      else out.push(`${full}:${readFileSync(full, 'base64')}`)
    }
  }
  walk(orbit)
  return out.sort().join('\n')
}

describe('a test copy of Orbit', () => {
  it('never writes to the notes folder, even with nothing synced there yet', async () => {
    const test = await computer('test-copy', true)
    test.value = { editorFontSize: 99 }
    mkdirSync(join(test.themes, 'blank'), { recursive: true })
    writeFileSync(join(test.themes, 'blank', 'theme.json'), '{}')
    await run(test)
    expect(existsSync(join(notes, '.notesapp'))).toBe(false)
  })

  it('takes in your real settings, but its own changes never replace them', async () => {
    const pc = await computer('pc')
    pc.value = { editorFontSize: 18 }
    mkdirSync(join(pc.themes, 'ocean'), { recursive: true })
    writeFileSync(join(pc.themes, 'ocean', 'theme.json'), '{"name":"Ocean"}')
    await run(pc)
    const before = notesFolderSnapshot()

    const test = await computer('test-copy', true)
    await run(test)
    expect(test.value).toEqual({ editorFontSize: 18 })
    expect(readFileSync(join(test.themes, 'ocean', 'theme.json'), 'utf8')).toBe('{"name":"Ocean"}')

    // Changed in the test copy: stays there, the notes folder is untouched.
    test.value = { editorFontSize: 40 }
    rmSync(join(test.themes, 'ocean'), { recursive: true })
    await run(test)
    expect(notesFolderSnapshot()).toBe(before)

    // The real Orbit sees nothing new.
    await run(pc)
    expect(pc.value).toEqual({ editorFontSize: 18 })
    expect(existsSync(join(pc.themes, 'ocean'))).toBe(true)
    expect(env.asked).toBe(0)
  })

  it('never asks "which version?", so "Keep this computer’s" can’t overwrite your real settings', async () => {
    const pc = await computer('pc')
    pc.value = { editorFontSize: 18 }
    await run(pc)
    const before = notesFolderSnapshot()

    // A test copy with settings of its own, first time syncing: a real Orbit would ask here.
    const test = await computer('test-copy', true)
    test.value = { editorFontSize: 12 }
    env.answer = 0 // "Keep this computer's", if it were asked
    await run(test)
    await run(test)
    expect(env.asked).toBe(0)
    expect(test.value).toEqual({ editorFontSize: 12 })
    expect(notesFolderSnapshot()).toBe(before)
  })
})

describe('the "which version?" question', () => {
  it('names the other computer when it is one', () => {
    const t = whichVersionText('Settings', { device: 'MACBOOK' }, 'Mon 23 Nov', 'DESKTOP-6QLESM9')
    expect(t.message).toBe('Settings changed on this computer and on MACBOOK.')
    expect(t.buttons).toEqual(['Keep this computer’s', 'Keep MACBOOK’s', 'Decide later'])
  })

  it('never calls this same computer "another computer"', () => {
    const t = whichVersionText('Settings', { device: 'DESKTOP-6QLESM9' }, 'Mon 23 Nov', 'desktop-6qlesm9')
    expect(t.message).toBe('Settings changed here and in another copy of Orbit on this computer.')
    expect(`${t.message} ${t.detail} ${t.buttons.join(' ')}`).not.toContain('DESKTOP-6QLESM9')
    expect(t.buttons).toEqual(['Keep this copy’s', 'Keep the other copy’s', 'Decide later'])
  })
})
