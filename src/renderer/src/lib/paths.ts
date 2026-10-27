import type { FileNode } from '@shared/types'

/** Parent folder of a vault-relative path ('' for the root). */
export function parentOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

/** 'a/b/c' → ['a', 'a/b', 'a/b/c'] */
export function ancestorsOf(path: string): string[] {
  const parts = path.split('/').filter(Boolean)
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

/** True if `path` is `base` or inside it. */
export function isWithin(path: string, base: string): boolean {
  return path === base || path.startsWith(base + '/')
}

/** Rewrites `path` after `from` was renamed or moved to `to`. */
export function replacePrefix(path: string, from: string, to: string): string {
  return isWithin(path, from) ? to + path.slice(from.length) : path
}

/** Resolves a relative link like '../img/a.png' against a folder. A leading '/' means the vault root. */
export function resolveRelative(folder: string, target: string): string {
  const parts = target.startsWith('/') ? [] : folder.split('/').filter(Boolean)
  for (const seg of target.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

/** URL the renderer uses to load an image from inside the vault. */
export function toVaultUrl(path: string): string {
  return 'vault://local/' + path.split('/').map(encodeURIComponent).join('/')
}

/** 'Projects/Plan.md' → 'Plan' */
export function noteTitle(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
}

export function displayName(node: FileNode): string {
  if (node.type === 'attachment') return node.name.replace(/\.canvas$/i, '')
  return node.type === 'file' ? node.name.replace(/\.md$/i, '') : node.name
}

export function findNode(nodes: FileNode[], path: string): FileNode | null {
  for (const n of nodes) {
    if (n.path === path) return n
    if (n.children && isWithin(path, n.path)) {
      const found = findNode(n.children, path)
      if (found) return found
    }
  }
  return null
}

export function countNotes(nodes: FileNode[]): number {
  return nodes.reduce((sum, n) => sum + (n.type === 'file' ? 1 : countNotes(n.children ?? [])), 0)
}

export function notePaths(nodes: FileNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === 'file') out.push(n.path)
    else notePaths(n.children ?? [], out)
  }
  return out
}

/** Strips Electron's "Error invoking remote method 'x': Error: " prefix. */
export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}
