import JSZip from 'jszip'

/** An export to import from: a zip file or a folder, read the same way. */
export interface Source {
  /** Every file, as paths with "/" (inside the zip, or relative to the folder). */
  files: string[]
  read(path: string): Promise<Uint8Array>
  text(path: string): Promise<string>
}

const decoder = new TextDecoder()

export async function zipSource(data: Uint8Array): Promise<Source> {
  const zip = await JSZip.loadAsync(data)
  const files = Object.values(zip.files)
    .filter((f) => !f.dir && !/(^|\/)(__MACOSX|\.)/.test(f.name))
    .map((f) => f.name)
  return {
    files,
    read: (p) => zip.file(p)!.async('uint8array'),
    text: (p) => zip.file(p)!.async('string')
  }
}

export async function folderSource(root: string): Promise<Source> {
  const files = await window.api.listImport(root)
  const full = (p: string): string => `${root}/${p}`
  return {
    files,
    read: (p) => window.api.readImport(full(p)),
    text: async (p) => decoder.decode(await window.api.readImport(full(p)))
  }
}

/** One file (like an Evernote .enex) on its own. */
function fileSource(path: string): Source {
  const name = path.split(/[\\/]/).pop() ?? path
  return {
    files: [name],
    read: () => window.api.readImport(path),
    text: async () => decoder.decode(await window.api.readImport(path))
  }
}

/** A zip, folder or single file; zips inside it (Notion splits big exports into parts) are opened too. */
export async function openSource(path: string, isFolder: boolean, expandZips = false): Promise<Source> {
  const top = isFolder ? await folderSource(path) : /\.zip$/i.test(path) ? await zipSource(await window.api.readImport(path)) : fileSource(path)
  if (!expandZips) return top
  const inner = top.files.filter((f) => /\.zip$/i.test(f))
  if (inner.length === 0) return top
  const parts = await Promise.all(inner.map(async (f) => ({ prefix: f.replace(/\.zip$/i, '') + '/', src: await zipSource(await top.read(f)) })))
  const owner = new Map<string, { src: Source; path: string }>()
  for (const f of top.files) if (!/\.zip$/i.test(f)) owner.set(f, { src: top, path: f })
  for (const { prefix, src } of parts) for (const f of src.files) owner.set(prefix + f, { src, path: f })
  return {
    files: [...owner.keys()],
    read: (p) => owner.get(p)!.src.read(owner.get(p)!.path),
    text: (p) => owner.get(p)!.src.text(owner.get(p)!.path)
  }
}

export const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
export const dirName = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/** "a/b/../c.png" relative to "a" → "a/c.png" */
export function joinPath(folder: string, rel: string): string {
  const parts = folder ? folder.split('/') : []
  for (const part of rel.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}

export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
