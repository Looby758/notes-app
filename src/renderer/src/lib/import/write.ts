import { findNode, parentOf } from '../paths'
import { relativePath } from '../links'
import { formatDate } from '../dates'
import { useVault } from '../../store/vault'

/** A note ready to be saved, from any app's export. */
export interface ImportedNote {
  /** Folder inside the import folder ("" for its top), with "/". */
  folder: string
  title: string
  /** Markdown. Attachments are written as `](att:N)` and pointed at the saved file. */
  body: string
  tags?: string[]
  created?: Date
  /** Files the body refers to as att:0, att:1… */
  files?: { name: string; data: Uint8Array }[]
}

export type Progress = (done: number, total: number) => void

export interface ImportResult {
  folder: string
  notes: number
  files: number
  skipped: string[]
}

/** A name Windows and Mac both accept, not too long. */
export function safeName(name: string, fallback = 'Untitled'): string {
  const clean = name
    .replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
  const short = clean.length > 80 ? clean.slice(0, 80).replace(/\s+\S*$/, '').trim() : clean
  return short || fallback
}

const encode = (p: string): string => p.split('/').map(encodeURIComponent).join('/')

function frontmatter(n: ImportedNote): string {
  const lines: string[] = []
  if (n.tags?.length) lines.push(`tags: [${[...new Set(n.tags.map((t) => t.replace(/[\s,#[\]]+/g, '-').replace(/^-|-$/g, '')).filter(Boolean))].join(', ')}]`)
  if (n.created && !Number.isNaN(n.created.getTime())) lines.push(`created: ${formatDate(n.created, 'YYYY-MM-DD')}`)
  return lines.length ? `---\n${lines.join('\n')}\n---\n` : ''
}

/** Saves imported notes (and their files) into "Imported/<source>", never over anything that's there. */
export async function writeImport(source: string, notes: ImportedNote[], progress: Progress = () => undefined): Promise<ImportResult> {
  const tree = useVault.getState().tree
  let base = `Imported/${safeName(source)}`
  for (let n = 2; findNode(tree, base); n++) base = `Imported/${safeName(source)} ${n}`

  const used = new Set<string>()
  const result: ImportResult = { folder: base, notes: 0, files: 0, skipped: [] }
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]
    progress(i, notes.length)
    try {
      const folder = [base, ...note.folder.split('/').filter((p) => p.trim()).map((p) => safeName(p, 'Folder'))].join('/')
      const name = safeName(note.title)
      let path = `${folder}/${name}.md`
      for (let k = 2; used.has(path.toLowerCase()); k++) path = `${folder}/${name} ${k}.md`
      used.add(path.toLowerCase())

      let body = note.body
      for (const [index, file] of (note.files ?? []).entries()) {
        const saved = await window.api.saveAttachment(`${base}/attachments`, safeName(file.name, 'file'), file.data)
        result.files++
        body = body.split(`](att:${index})`).join(`](${encode(relativePath(parentOf(path), saved))})`)
      }
      const created = await window.api.createNoteAt(path)
      await window.api.writeNote(created, `${frontmatter(note)}${body.trim()}\n`)
      result.notes++
    } catch (err) {
      result.skipped.push(`${note.title}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  progress(notes.length, notes.length)
  await useVault.getState().refresh()
  return result
}
