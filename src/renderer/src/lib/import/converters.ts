import { htmlToMarkdown } from './html'
import { baseName, dirName, joinPath, safeDecode, type Source } from './source'
import type { ImportedNote } from './write'
import { formatDate } from '../dates'
import { parseDelimited } from '../sheets'

/** Collects a note's files and hands out `att:N` links for them. */
class Files {
  list: { name: string; data: Uint8Array }[] = []
  add(name: string, data: Uint8Array): string {
    this.list.push({ name, data })
    return `att:${this.list.length - 1}`
  }
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|heic|avif)$/i
const embed = (name: string, link: string): string => (IMAGE.test(name) ? `![${name.replace(/\.[^.]+$/, '')}](${link})` : `[${name}](${link})`)

function dataUrlBytes(url: string): { data: Uint8Array; ext: string } | null {
  const m = /^data:([\w/+.-]+)?(;base64)?,(.*)$/s.exec(url)
  if (!m) return null
  const ext = (m[1] ?? 'image/png').split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') ?? 'png'
  const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3])
  return { data: Uint8Array.from(raw, (c) => c.charCodeAt(0)), ext }
}

// ---------- Google Keep (Google Takeout) ----------

interface KeepNote {
  title?: string
  textContent?: string
  listContent?: { text: string; isChecked: boolean }[]
  labels?: { name: string }[]
  attachments?: { filePath: string; mimetype?: string }[]
  isTrashed?: boolean
  isArchived?: boolean
  isPinned?: boolean
  createdTimestampUsec?: number
  userEditedTimestampUsec?: number
}

export async function fromKeep(src: Source): Promise<ImportedNote[]> {
  const notes: ImportedNote[] = []
  for (const path of src.files.filter((f) => /\.json$/i.test(f))) {
    let k: KeepNote
    try {
      k = JSON.parse(await src.text(path))
    } catch {
      continue
    }
    if (typeof k !== 'object' || !k || (!('textContent' in k) && !('listContent' in k))) continue
    if (k.isTrashed) continue
    const files = new Files()
    const parts: string[] = []
    if (k.textContent) parts.push(k.textContent.trim())
    if (k.listContent?.length) parts.push(k.listContent.map((i) => `- [${i.isChecked ? 'x' : ' '}] ${i.text.replace(/\n/g, ' ')}`).join('\n'))
    for (const a of k.attachments ?? []) {
      const file = src.files.find((f) => dirName(f) === dirName(path) && baseName(f) === a.filePath) ?? src.files.find((f) => baseName(f) === a.filePath)
      if (file) parts.push(embed(a.filePath, files.add(a.filePath, await src.read(file))))
    }
    const created = k.createdTimestampUsec ? new Date(k.createdTimestampUsec / 1000) : k.userEditedTimestampUsec ? new Date(k.userEditedTimestampUsec / 1000) : undefined
    const firstLine = (k.textContent ?? k.listContent?.[0]?.text ?? '').split('\n')[0].trim()
    notes.push({
      folder: k.isArchived ? 'Archived' : '',
      title: k.title?.trim() || firstLine.slice(0, 60) || `Keep note ${created ? formatDate(created, 'YYYY-MM-DD HH-mm') : ''}`.trim(),
      body: parts.join('\n\n'),
      tags: [...(k.labels ?? []).map((l) => l.name), ...(k.isPinned ? ['pinned'] : [])],
      created,
      files: files.list
    })
  }
  return notes
}

// ---------- Notion (Markdown & CSV export) ----------

/** Notion adds a 32-character id to every name: "Trip plans 1a2b…f.md". */
const NOTION_ID = /\s+[0-9a-f]{32}(?=$|\.|\/)/gi
const stripId = (p: string): string => p.replace(NOTION_ID, '')

function csvToTable(csv: string): string {
  const rows = parseDelimited(csv)
  const clean = rows.filter((r) => r.some((c) => c.trim())).map((r) => r.map((c) => c.replace(/\n/g, ' ').replace(/\|/g, '\\|').trim() || ' '))
  if (clean.length === 0) return ''
  const cols = Math.max(...clean.map((r) => r.length))
  const line = (r: string[]): string => `| ${[...r, ...Array(cols - r.length).fill(' ')].join(' | ')} |`
  return [line(clean[0]), `| ${Array(cols).fill('---').join(' | ')} |`, ...clean.slice(1).map(line)].join('\n')
}

export async function fromNotion(src: Source): Promise<ImportedNote[]> {
  // A single top folder (the export's) isn't worth keeping.
  const tops = new Set(src.files.map((f) => f.split('/')[0]))
  const strip = tops.size === 1 && src.files.every((f) => f.includes('/')) ? `${[...tops][0]}/` : ''
  const notes: ImportedNote[] = []
  for (const path of src.files) {
    const isMd = /\.md$/i.test(path)
    const isCsv = /\.csv$/i.test(path) && !/_all\.csv$/i.test(path)
    if (!isMd && !isCsv) continue
    const rel = path.startsWith(strip) ? path.slice(strip.length) : path
    const folder = stripId(dirName(rel))
    let title = stripId(baseName(rel)).replace(/\.(md|csv)$/i, '')
    const text = await src.text(path)
    if (isCsv) {
      notes.push({ folder, title, body: csvToTable(text) })
      continue
    }
    const files = new Files()
    let body = text
    // The page's own title is its first heading.
    const heading = /^#\s+(.+)\n+/.exec(body)
    if (heading) {
      title = heading[1].trim() || title
      body = body.slice(heading[0].length)
    }
    // Links: to other pages → [[Page]]; to pictures and files → saved with the note.
    const replacements: [string, string][] = []
    for (const m of body.matchAll(/(!?)\[([^\]]*)\]\(([^)]+)\)/g)) {
      const [whole, bang, label, target] = m
      if (/^[a-z]+:/i.test(target)) continue
      const resolved = joinPath(dirName(path), safeDecode(target))
      if (/\.md$/i.test(resolved)) {
        const name = stripId(baseName(resolved)).replace(/\.md$/i, '')
        replacements.push([whole, name === label ? `[[${name}]]` : `[[${name}|${label}]]`])
      } else if (/\.csv$/i.test(resolved)) {
        replacements.push([whole, `[[${stripId(baseName(resolved)).replace(/\.csv$/i, '')}]]`])
      } else if (src.files.includes(resolved)) {
        const link = files.add(baseName(resolved), await src.read(resolved))
        replacements.push([whole, bang ? `![${label}](${link})` : `[${label || baseName(resolved)}](${link})`])
      }
    }
    for (const [from, to] of replacements) body = body.split(from).join(to)
    notes.push({ folder, title, body, files: files.list })
  }
  return notes
}

// ---------- Evernote (.enex) ----------

function enexDate(s: string | null | undefined): Date | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s ?? '')
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : undefined
}

export async function fromEvernote(src: Source): Promise<ImportedNote[]> {
  const notes: ImportedNote[] = []
  for (const path of src.files.filter((f) => /\.enex$/i.test(f))) {
    const xml = new DOMParser().parseFromString(await src.text(path), 'application/xml')
    // Several .enex files (one per notebook): each becomes a folder.
    const notebook = src.files.filter((f) => /\.enex$/i.test(f)).length > 1 ? baseName(path).replace(/\.enex$/i, '') : ''
    for (const n of Array.from(xml.getElementsByTagName('note'))) {
      const get = (tag: string): string | undefined => n.getElementsByTagName(tag)[0]?.textContent ?? undefined
      const files = new Files()
      const byHash = new Map<string, string>()
      for (const r of Array.from(n.getElementsByTagName('resource'))) {
        const b64 = (r.getElementsByTagName('data')[0]?.textContent ?? '').replace(/\s+/g, '')
        if (!b64) continue
        const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        const mime = r.getElementsByTagName('mime')[0]?.textContent ?? ''
        const name = r.getElementsByTagName('file-name')[0]?.textContent || `file.${mime.split('/')[1] ?? 'bin'}`
        const hash = await window.api.md5(data)
        byHash.set(hash, embed(name, files.add(name, data)))
      }
      const body = htmlToMarkdown(get('content') ?? '', {
        media: (hash) => byHash.get(hash) ?? null,
        image: (src) => (src.startsWith('data:') ? null : `![](${src})`)
      })
      notes.push({
        folder: notebook,
        title: get('title')?.trim() || 'Untitled',
        body,
        tags: Array.from(n.getElementsByTagName('tag')).map((t) => t.textContent ?? ''),
        created: enexDate(get('created')),
        files: files.list
      })
    }
  }
  return notes
}

// ---------- Apple Notes (Mac only) ----------

export async function fromAppleNotes(): Promise<{ notes: ImportedNote[]; locked: number }> {
  const all = await window.api.appleNotes()
  const accounts = new Set(all.map((n) => n.account))
  let locked = 0
  const notes: ImportedNote[] = []
  for (const a of all) {
    if (a.locked) {
      locked++
      continue
    }
    const files = new Files()
    let i = 0
    let body = htmlToMarkdown(a.html, {
      image: (src) => {
        const bytes = src.startsWith('data:') ? dataUrlBytes(src) : null
        return bytes ? `![](${files.add(`${a.title.slice(0, 40)} ${++i}.${bytes.ext}`, bytes.data)})` : null
      }
    })
    // Apple Notes repeats the title as the first line.
    const first = body.split('\n')[0].replace(/^[#*\s]+|[*\s]+$/g, '')
    if (first === a.title.trim()) body = body.slice(body.indexOf('\n') + 1)
    notes.push({
      folder: accounts.size > 1 ? `${a.account}/${a.folder}` : a.folder === 'Notes' ? '' : a.folder,
      title: a.title.trim() || 'Untitled',
      body,
      created: new Date(a.created),
      files: files.list
    })
  }
  return { notes, locked }
}

// ---------- a folder of markdown, text or HTML files (Bear, Obsidian, Simplenote…) ----------

export async function fromFiles(src: Source): Promise<ImportedNote[]> {
  const notes: ImportedNote[] = []
  for (const path of src.files) {
    if (!/\.(md|markdown|txt|html?)$/i.test(path)) continue
    const files = new Files()
    let text = await src.text(path)
    if (/\.html?$/i.test(path)) text = htmlToMarkdown(text, { image: (s) => `![](${s})` })
    // Pictures next to the notes come along.
    const replacements: [string, string][] = []
    for (const m of text.matchAll(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g)) {
      const [whole, bang, label, target] = m
      if (/^[a-z]+:/i.test(target) || /\.(md|markdown)$/i.test(target)) continue
      const resolved = joinPath(dirName(path), safeDecode(target))
      if (!src.files.includes(resolved)) continue
      const link = files.add(baseName(resolved), await src.read(resolved))
      replacements.push([whole, `${bang}[${label}](${link})`])
    }
    for (const [from, to] of replacements) text = text.split(from).join(to)
    notes.push({ folder: dirName(path), title: baseName(path).replace(/\.[^.]+$/, ''), body: text, files: files.list })
  }
  return notes
}
