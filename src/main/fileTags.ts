import { app, BrowserWindow, ipcMain } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { rename, writeFile } from 'fs/promises'
import { join } from 'path'
import { cleanTagStore, copyInStore, isTagColour, moveInStore, setTag, type FileTagStore } from '@shared/fileTags'

/** Colour tags and favourite folders for the Files tab, kept in file-tags.json (see shared/fileTags.ts). */

let store: FileTagStore | null = null
const fileOf = (): string => join(app.getPath('userData'), 'file-tags.json')

function load(): FileTagStore {
  if (store) return store
  try {
    store = existsSync(fileOf()) ? cleanTagStore(JSON.parse(readFileSync(fileOf(), 'utf8'))) : cleanTagStore({})
  } catch {
    store = cleanTagStore({})
  }
  return store
}

let saving: Promise<void> = Promise.resolve()
function update(next: FileTagStore): void {
  if (next === store) return
  store = next
  const text = JSON.stringify(next, null, 1)
  const write = async (): Promise<void> => {
    const tmp = `${fileOf()}.tmp`
    await writeFile(tmp, text)
    await rename(tmp, fileOf())
  }
  saving = saving.then(write, write).catch(() => undefined)
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('tags:changed', next)
}

/** Orbit renamed or moved something: its tags (and anything inside it) go with it. */
export function moveTags(from: string, to: string): void {
  update(moveInStore(load(), from, to))
}

/** Orbit copied something: the copy gets the same tags. */
export function copyTags(from: string, to: string): void {
  update(copyInStore(load(), from, to))
}

/** Everything with this colour. */
export function taggedPaths(colour: string): string[] {
  if (!isTagColour(colour)) return []
  return Object.entries(load().items)
    .filter(([, list]) => list.includes(colour))
    .map(([p]) => p)
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

export function setupFileTags(): void {
  ipcMain.handle('tags:get', () => load())
  ipcMain.handle('tags:set', (_e, paths: unknown, colour: unknown, on: unknown) => {
    if (!isTagColour(colour)) throw new Error('That isn’t a tag colour.')
    update(setTag(load(), strings(paths), colour, !!on))
  })
  ipcMain.handle('tags:label', (_e, colour: unknown, label: unknown) => {
    if (!isTagColour(colour)) throw new Error('That isn’t a tag colour.')
    const name = typeof label === 'string' ? label.trim().slice(0, 40) : ''
    const labels = { ...load().labels }
    if (name) labels[colour] = name
    else delete labels[colour]
    update({ ...load(), labels })
  })
  ipcMain.handle('tags:favourites', (_e, list: unknown) => update({ ...load(), favourites: [...new Set(strings(list))] }))
}
