import { promises as fs } from 'fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path'
import type { FileNode } from '@shared/types'

/** Hidden folders (.git, .obsidian, .trash…) and node_modules never show in the tree. */
export function isIgnoredName(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules'
}

const INVALID_CHARS = /[\\/:*?"<>|]/

function cleanName(name: string): string {
  const n = name.trim()
  if (!n || n === '.' || n === '..') throw new Error('Name cannot be empty.')
  if (INVALID_CHARS.test(n)) throw new Error('Names can\'t contain \\ / : * ? " < > |')
  if (/[. ]$/.test(n)) throw new Error('Names can\'t end with a dot or a space.')
  return n
}

const isMarkdown = (name: string): boolean => name.toLowerCase().endsWith('.md')
/** Canvas boards (.canvas files) are saved through the same safe write as notes. */
const isBoard = (name: string): boolean => name.toLowerCase().endsWith('.canvas')

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024

/** Makes any file name safe for Windows: bad characters become "-". */
function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/[. ]+$/, '').trim()
  return cleaned || 'file'
}

/** "photo.final.png" → ["photo.final", ".png"] */
function splitName(name: string): [string, string] {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
}

function compareNodes(a: FileNode, b: FileNode): number {
  if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

/** Sync clients (Google Drive, antivirus) can briefly lock a file; retry a few times before giving up. */
async function renameWithRetry(src: string, dest: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.rename(src, dest)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) throw err
      await new Promise((r) => setTimeout(r, 40 * (attempt + 1)))
    }
  }
}

/** A temp-file name part that's unique even for two saves in the same millisecond. */
let tempCounter = 0
const tempSuffix = (): string => `${process.pid}-${Date.now()}-${++tempCounter}`

export class Vault {
  constructor(readonly root: string) {}

  /** Resolves a vault-relative path, refusing anything that escapes the vault. */
  abs(rel: string): string {
    const full = resolve(this.root, rel || '.')
    const r = relative(this.root, full)
    if (r.startsWith('..') || isAbsolute(r)) throw new Error('That path is outside the notes folder.')
    return full
  }

  rel(full: string): string {
    return relative(this.root, full).split(sep).join('/')
  }

  async tree(): Promise<FileNode[]> {
    return this.readDir(this.root)
  }

  private async readDir(dir: string): Promise<FileNode[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const nodes: FileNode[] = []
    for (const e of entries) {
      if (isIgnoredName(e.name)) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        nodes.push({ name: e.name, path: this.rel(full), type: 'folder', children: await this.readDir(full) })
      } else if (e.isFile()) {
        nodes.push({ name: e.name, path: this.rel(full), type: isMarkdown(e.name) ? 'file' : 'attachment' })
      }
    }
    return nodes.sort(compareNodes)
  }

  private async folder(rel: string): Promise<string> {
    const dir = this.abs(rel)
    if (!(await fs.stat(dir)).isDirectory()) throw new Error('That is not a folder.')
    return dir
  }

  /** "Untitled.md", then "Untitled 1.md", "Untitled 2.md"… */
  private async uniquePath(dir: string, base: string, ext: string): Promise<string> {
    for (let i = 0; ; i++) {
      const candidate = join(dir, `${i === 0 ? base : `${base} ${i}`}${ext}`)
      if (!(await exists(candidate))) return candidate
    }
  }

  async read(rel: string): Promise<string> {
    return fs.readFile(this.abs(rel), 'utf8')
  }

  /** Atomic save: write a hidden temp file next to the note, then swap it in. */
  async write(rel: string, content: string): Promise<void> {
    const full = this.abs(rel)
    if (!isMarkdown(full) && !isBoard(full)) throw new Error('Only .md notes and .canvas boards can be saved.')
    const tmp = join(dirname(full), `.${basename(full)}.${tempSuffix()}.tmp`)
    await fs.writeFile(tmp, content, 'utf8')
    try {
      await renameWithRetry(tmp, full)
    } catch (err) {
      await fs.rm(tmp, { force: true })
      throw err
    }
  }

  /** Every note's text, for building the link index. */
  async readAll(): Promise<{ path: string; content: string }[]> {
    const files: string[] = []
    const walk = (nodes: FileNode[]): void => {
      for (const n of nodes) n.type === 'file' ? files.push(n.path) : walk(n.children ?? [])
    }
    walk(await this.tree())
    const notes = await Promise.all(
      files.map(async (path) => {
        try {
          return { path, content: await this.read(path) }
        } catch {
          return null // deleted mid-scan
        }
      })
    )
    return notes.filter((n): n is { path: string; content: string } => n !== null)
  }

  /** Creates a note at an exact path (e.g. from clicking a link to a missing note), making folders as needed. */
  async createNoteAt(rel: string): Promise<string> {
    const parts = rel.split('/').filter(Boolean)
    if (parts.length === 0) throw new Error('Name cannot be empty.')
    const clean = parts.map(cleanName)
    if (!isMarkdown(clean[clean.length - 1])) clean[clean.length - 1] += '.md'
    const full = this.abs(clean.join('/'))
    await fs.mkdir(dirname(full), { recursive: true })
    await fs.writeFile(full, '', { flag: 'wx' }).catch((err) => {
      throw err.code === 'EEXIST' ? new Error(`"${clean.join('/')}" already exists.`) : err
    })
    return this.rel(full)
  }

  /**
   * Small app files kept inside the vault (in ".notesapp/", hidden from the tree) so they sync
   * with your notes, e.g. starred notes. Only simple names like "starred.json" are allowed.
   */
  async readAppData(name: string): Promise<string | null> {
    try {
      return await fs.readFile(this.appDataPath(name), 'utf8')
    } catch {
      return null
    }
  }

  async writeAppData(name: string, content: string): Promise<void> {
    const file = this.appDataPath(name)
    await fs.mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.${tempSuffix()}.tmp`
    await fs.writeFile(tmp, content, 'utf8')
    await renameWithRetry(tmp, file)
  }

  private appDataPath(name: string): string {
    if (!/^[a-z0-9-]+\.json$/.test(name)) throw new Error('Invalid app data name.')
    return join(this.root, '.notesapp', name)
  }

  /** Saves a pasted or dropped file into `folderRel` (created if needed) under a unique name. */
  async saveAttachment(folderRel: string, fileName: string, data: Uint8Array): Promise<string> {
    if (data.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('That file is too big to attach (over 100 MB).')
    const dir = this.abs(folderRel)
    await fs.mkdir(dir, { recursive: true })
    const target = await this.uniquePath(dir, ...splitName(safeFileName(fileName)))
    await fs.writeFile(target, data, { flag: 'wx' })
    return this.rel(target)
  }

  /** Saves an edited sketch over its .svg (only an existing picture, so nothing else can be written). */
  async writeSketch(rel: string, svg: string): Promise<void> {
    const full = this.abs(rel)
    if (extname(full).toLowerCase() !== '.svg') throw new Error('Only sketches (.svg) can be saved this way.')
    if (!(await exists(full))) throw new Error('That sketch is no longer in the notes folder.')
    if (Buffer.byteLength(svg) > MAX_ATTACHMENT_BYTES) throw new Error('That sketch is too big to save.')
    const tmp = join(dirname(full), `.${basename(full)}.${tempSuffix()}.tmp`)
    await fs.writeFile(tmp, svg, 'utf8')
    try {
      await renameWithRetry(tmp, full)
    } catch (err) {
      await fs.rm(tmp, { force: true })
      throw err
    }
  }

  /** Copies a file from anywhere on disk into `folderRel` (for "insert image" from a file picker). */
  async copyAttachment(folderRel: string, source: string): Promise<string> {
    if ((await fs.stat(source)).size > MAX_ATTACHMENT_BYTES) throw new Error('That file is too big to attach (over 100 MB).')
    const dir = this.abs(folderRel)
    await fs.mkdir(dir, { recursive: true })
    const target = await this.uniquePath(dir, ...splitName(safeFileName(basename(source))))
    await fs.copyFile(source, target)
    return this.rel(target)
  }

  async createNote(folderRel: string): Promise<string> {
    const target = await this.uniquePath(await this.folder(folderRel), 'Untitled', '.md')
    await fs.writeFile(target, '', { flag: 'wx' })
    return this.rel(target)
  }

  /** Creates an empty "Untitled board.canvas" in the folder. */
  async createBoard(folderRel: string): Promise<string> {
    const target = await this.uniquePath(await this.folder(folderRel), 'Untitled board', '.canvas')
    await fs.writeFile(target, '{\n\t"nodes":[],\n\t"edges":[]\n}\n', { flag: 'wx' })
    return this.rel(target)
  }

  async createFolder(folderRel: string): Promise<string> {
    const target = await this.uniquePath(await this.folder(folderRel), 'New folder', '')
    await fs.mkdir(target)
    return this.rel(target)
  }

  async rename(rel: string, newName: string): Promise<string> {
    if (!rel) throw new Error('The notes folder itself cannot be renamed here.')
    const src = this.abs(rel)
    const isFile = (await fs.stat(src)).isFile()
    let name = cleanName(newName)
    // Notes stay .md; other files keep their extension unless you type a new one.
    if (isFile && isMarkdown(src) && !isMarkdown(name)) name += '.md'
    else if (isFile && !isMarkdown(src) && !splitName(name)[1]) name += splitName(basename(src))[1]
    const target = join(dirname(src), name)
    if (target === src) return rel
    // A case-only rename ("note" → "Note") points at the same file on Windows, so allow it.
    const caseOnly = target.toLowerCase() === src.toLowerCase()
    if (!caseOnly && (await exists(target))) throw new Error(`"${name}" already exists here.`)
    await fs.rename(src, target)
    return this.rel(target)
  }

  async move(rel: string, folderRel: string): Promise<string> {
    if (!rel) throw new Error('The notes folder itself cannot be moved.')
    const src = this.abs(rel)
    const destDir = await this.folder(folderRel)
    if (destDir === dirname(src)) return rel
    if (destDir === src || destDir.startsWith(src + sep)) {
      throw new Error('A folder cannot be moved into itself.')
    }
    const target = join(destDir, basename(src))
    if (await exists(target)) throw new Error(`"${basename(src)}" already exists there.`)
    await fs.rename(src, target)
    return this.rel(target)
  }
}
