/** file:// links to files anywhere on the computer, for notes that link to a file without copying it in. */

/** A file:// address for a path ("C:\a b\c.png" → "file:///C:/a%20b/c.png", "/Users/x" → "file:///Users/x"). */
export function fileUrl(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  const encoded = (slashed.startsWith('/') ? '' : '/') + slashed.split('/').map(encodeURIComponent).join('/')
  // "C:" stays as it is ("file:///C:/Users/…").
  return 'file://' + encoded.replace(/^\/([A-Za-z])%3A/, '/$1:')
}

/** The path a file:// address points to (Windows paths keep forward slashes, which work there too), or null. */
export function pathFromFileUrl(url: string): string | null {
  const m = /^file:\/\/(?:localhost)?(\/.*)$/i.exec(url.split(/[?#]/)[0])
  if (!m) return null
  let path: string
  try {
    path = decodeURIComponent(m[1])
  } catch {
    return null
  }
  // "/C:/Users/…" is a Windows path.
  return /^\/[A-Za-z]:/.test(path) ? path.slice(1) : path
}

/** `path`'s place inside the notes folder `root` ("attachments/a.png"), or null if it's outside. */
export function vaultRelative(root: string, path: string): string | null {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const r = norm(root)
  const p = norm(path)
  // Windows paths aren't case-sensitive.
  const windows = /^[A-Za-z]:/.test(r)
  const head = p.slice(0, r.length)
  const same = windows ? head.toLowerCase() === r.toLowerCase() : head === r
  return same && p[r.length] === '/' ? p.slice(r.length + 1) : null
}

/** The folder a path is in ("C:/a/b.png" → "C:/a", "/a/b" → "/a"). */
export function folderOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (i <= 0) return path.slice(0, i + 1) || path
  // "C:/b.png" → "C:/" (a drive's top, not "C:").
  return /^[A-Za-z]:$/.test(path.slice(0, i)) ? path.slice(0, i + 1) : path.slice(0, i)
}
