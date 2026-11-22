import { create } from 'zustand'
import { claudePrompt, matchPull, pullKey, readBoard, type BoardColumn, type BoardItem, type PullRequest, type Shot } from '@shared/appStudio'
import { isClaudeLink } from '@shared/chatSites'
import { sendToSite, type SiteFile } from '../components/ChatSite/ChatSite'
import { pictureAsPng } from '../lib/boardPictures'
import { notify } from './notify'

/**
 * App Studio's idea board: ideas and bugs for each app, in columns (Ideas & bugs, Building,
 * Testing, Done). Saved in the notes folder (.notesapp/app-studio.json), so the board is the same
 * on every computer that has your notes.
 */

interface BoardState {
  items: BoardItem[]
  /** Each app's Claude project link, by board key. */
  claude: Record<string, string>
  /** Feature screenshots. */
  shots: Shot[]
  loaded: boolean
  /** The app whose board is showing (its board key). */
  app: string | null
  /** The item open in the editor; a new one isn't on the board until it has a title. */
  editing: BoardItem | null
  /** Items picked for "Copy as Claude prompt". */
  picked: string[]
}

export const useAppBoard = create<BoardState>(() => ({ items: [], claude: {}, shots: [], loaded: false, app: null, editing: null, picked: [] }))

const FILE = 'app-studio.json'
let generation = 0

export async function loadAppBoard(): Promise<void> {
  const gen = ++generation
  useAppBoard.setState({ items: [], claude: {}, shots: [], loaded: false, editing: null, picked: [] })
  try {
    const { items, claude, shots } = readBoard(await window.api.readAppData(FILE))
    if (gen === generation) useAppBoard.setState({ items, claude, shots, loaded: true })
  } catch {
    if (gen === generation) useAppBoard.setState({ loaded: true })
  }
}

let writing = false
let again = false

function persist(): void {
  if (writing) {
    again = true
    return
  }
  writing = true
  window.api
    .writeAppData(FILE, JSON.stringify((({ items, claude, shots }) => ({ items, claude, shots }))(useAppBoard.getState()), null, 2))
    .catch(notify)
    .finally(() => {
      writing = false
      if (again) {
        again = false
        persist()
      }
    })
}

const now = (): string => new Date().toISOString()
const newId = (): string => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function setBoardApp(app: string): void {
  useAppBoard.setState({ app, picked: [] })
}

/** Opens the editor on a new idea or bug for `app` (not saved until it has a title). */
export function startItem(app: string, kind: BoardItem['kind'], pictures: string[] = []): void {
  const t = now()
  useAppBoard.setState({ app, editing: { id: newId(), app, kind, title: '', details: '', column: 'ideas', pictures, created: t, updated: t } })
}

export function editItem(item: BoardItem): void {
  useAppBoard.setState({ editing: { ...item } })
}

export function changeEditing(patch: Partial<BoardItem>): void {
  useAppBoard.setState((s) => (s.editing ? { editing: { ...s.editing, ...patch } } : {}))
}

/** Closes the editor, saving the item (if it has a title). */
export function finishEditing(): void {
  const { editing, items } = useAppBoard.getState()
  useAppBoard.setState({ editing: null })
  if (!editing || !editing.title.trim()) return
  const item = { ...editing, title: editing.title.trim(), details: editing.details.trimEnd(), updated: now() }
  const exists = items.some((i) => i.id === item.id)
  const before = items.find((i) => i.id === item.id)
  if (exists && before && JSON.stringify({ ...before, updated: '' }) === JSON.stringify({ ...item, updated: '' })) return
  useAppBoard.setState({ items: exists ? items.map((i) => (i.id === item.id ? item : i)) : [...items, item] })
  persist()
}

export function cancelEditing(): void {
  useAppBoard.setState({ editing: null })
}

export function moveItem(id: string, column: BoardColumn, before?: string): void {
  const { items } = useAppBoard.getState()
  const item = items.find((i) => i.id === id)
  if (!item) return
  const rest = items.filter((i) => i.id !== id)
  const moved = { ...item, column, updated: item.column === column ? item.updated : now() }
  const at = before ? rest.findIndex((i) => i.id === before) : -1
  if (at >= 0) rest.splice(at, 0, moved)
  else rest.push(moved)
  useAppBoard.setState({ items: rest })
  persist()
}

export function deleteItem(id: string): void {
  useAppBoard.setState((s) => ({ items: s.items.filter((i) => i.id !== id), picked: s.picked.filter((p) => p !== id), editing: s.editing?.id === id ? null : s.editing }))
  persist()
}

export function togglePicked(id: string): void {
  useAppBoard.setState((s) => ({ picked: s.picked.includes(id) ? s.picked.filter((p) => p !== id) : [...s.picked, id] }))
}

export function clearPicked(): void {
  useAppBoard.setState({ picked: [] })
}

/**
 * A bug reported from the screen snip: its picture is saved in your attachments, then App Studio's
 * board opens with a new bug holding it, ready to say what's wrong.
 */
export async function reportBugFromSnip(png: Uint8Array, folder: string, appKey: string | null, open: () => void): Promise<void> {
  try {
    const name = `bug-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`
    const path = await window.api.saveAttachment(folder, name, png)
    open()
    startItem(useAppBoard.getState().app ?? appKey ?? 'App', 'bug', [path])
  } catch (err) {
    notify(err)
  }
}

// ---------- Claude ----------

export function setClaudeLink(app: string, url: string): void {
  const link = url.trim()
  useAppBoard.setState((s) => {
    const claude = { ...s.claude }
    if (link) claude[app] = link
    else delete claude[app]
    return { claude }
  })
  persist()
}

/**
 * Sends ideas and bugs to Claude: opens the app's Claude project inside Orbit with the prompt in
 * its message box (and on the clipboard, in case), and moves the cards to Building. False if the
 * app has no Claude project link yet.
 */
export async function sendToClaude(appKey: string, app: { name: string; repo?: string }, items: BoardItem[]): Promise<boolean> {
  const link = useAppBoard.getState().claude[appKey]
  if (!link || !isClaudeLink(link) || !items.length) return false
  const prompt = claudePrompt(app, items)
  await navigator.clipboard.writeText(prompt).catch(() => {})
  const ids = new Set(items.map((i) => i.id))
  const t = now()
  useAppBoard.setState((s) => ({
    items: s.items.map((i) => (ids.has(i.id) ? { ...i, sentAt: t, column: i.column === 'ideas' ? 'building' : i.column, updated: t } : i)),
    picked: [],
    editing: s.editing && ids.has(s.editing.id) ? null : s.editing
  }))
  persist()
  const files = await pictureFiles(items)
  const pictures = items.reduce((n, i) => n + i.pictures.length, 0)
  const { typed, attached } = await sendToSite('claude', link, prompt, files)
  if (!typed) notify('Claude is open. The prompt is copied: paste it in with Ctrl+V.' + (pictures ? ' Then copy each picture across too (Copy picture on the card).' : ''), 'info')
  else if (attached < pictures) notify(`The prompt is in Claude’s message box, but ${attached ? `only ${attached} of ${pictures} pictures went in` : 'the pictures didn’t go in'}. Copy each one across (Copy picture on the card), then send it.`, 'info')
  return true
}

/** The cards' pictures as PNG files to attach in Claude, named after the screenshots. One that can't be read is left out. */
async function pictureFiles(items: BoardItem[]): Promise<SiteFile[]> {
  const paths = items.flatMap((i) => i.pictures)
  const files = await Promise.all(
    paths.map(async (path): Promise<SiteFile | null> => {
      try {
        const png = await pictureAsPng(path)
        const name = (path.split(/[\\/]/).pop() || 'picture').replace(/\.[^.]*$/, '') + '.png'
        return { name, type: 'image/png', base64: await toBase64(png) }
      } catch {
        return null
      }
    })
  )
  return files.filter((f): f is SiteFile => !!f)
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

// ---------- Matching pull requests to cards ----------

/** Says which card a pull request is for (or none, with null). */
export function linkPull(repo: string, number: number, itemId: string | null): void {
  const key = pullKey(repo, number)
  const t = now()
  useAppBoard.setState((s) => ({
    items: s.items.map((i) => {
      if (i.id === itemId) return { ...i, pull: key, column: i.column === 'ideas' || i.column === 'building' ? 'testing' : i.column, updated: t }
      if (i.pull === key) return { ...i, pull: undefined, updated: t }
      return i
    })
  }))
  persist()
}

/**
 * Keeps the board up with the pull requests: a new one Claude opened is matched to the card it's
 * for (moved to Testing), and a card's pull request that was merged moves it to Done. One closed
 * without merging puts its card back in Building, ready for another try.
 */
export async function syncPulls(pulls: PullRequest[], errors: Record<string, string>, appOf: (repo: string) => { keys: string[] } | null): Promise<void> {
  const { items, loaded } = useAppBoard.getState()
  if (!loaded) return
  const t = now()
  let changed = false
  let next = items
  for (const p of pulls) {
    const key = pullKey(p.repo, p.number)
    const app = appOf(p.repo)
    if (!app) continue
    const linked = next.find((i) => i.pull === key)
    if (linked) {
      if (linked.column === 'ideas' || linked.column === 'building') {
        next = next.map((i) => (i === linked ? { ...i, column: 'testing', updated: t } : i))
        changed = true
      }
      continue
    }
    const item = matchPull(
      next.filter((i) => app.keys.includes(i.app)),
      p
    )
    if (item) {
      next = next.map((i) => (i === item ? { ...i, pull: key, column: 'testing', updated: t } : i))
      changed = true
    }
  }
  // Cards whose pull request isn't open any more.
  const open = new Set(pulls.map((p) => pullKey(p.repo, p.number)))
  const gone = new Map<string, number[]>()
  for (const i of next) {
    if (!i.pull || open.has(i.pull) || i.column === 'done') continue
    const [repo, n] = i.pull.split('#')
    if (errors[repo] || !Number(n)) continue
    gone.set(repo, [...(gone.get(repo) ?? []), Number(n)])
  }
  if (changed) {
    useAppBoard.setState({ items: next })
    persist()
  }
  for (const [repo, numbers] of gone) {
    const states = await window.api.appsPullStates(repo, numbers).catch(() => ({}) as Record<number, string>)
    useAppBoard.setState((s) => ({
      items: s.items.map((i) => {
        const state = i.pull?.startsWith(repo + '#') ? states[Number(i.pull.split('#')[1])] : undefined
        if (state === 'merged') return { ...i, column: 'done', updated: now() }
        if (state === 'closed') return { ...i, pull: undefined, column: 'building', updated: now() }
        return i
      })
    }))
    if (Object.values(states).some((v) => v !== 'open')) persist()
  }
}

// ---------- Screenshots ----------

export function addShots(shots: Shot[]): void {
  if (!shots.length) return
  useAppBoard.setState((s) => ({ shots: [...s.shots, ...shots] }))
  persist()
}

export function updateShot(id: string, patch: Partial<Shot>): void {
  useAppBoard.setState((s) => ({ shots: s.shots.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
  persist()
}

export function deleteShot(id: string): void {
  useAppBoard.setState((s) => ({ shots: s.shots.filter((x) => x.id !== id) }))
  persist()
}

export const newShotId = newId
