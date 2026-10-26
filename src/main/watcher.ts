import { watch, type FSWatcher } from 'chokidar'
import { relative, sep } from 'path'
import { isIgnoredName } from './vault'

let watcher: FSWatcher | null = null
let timer: NodeJS.Timeout | undefined
let pending = new Set<string>()

/**
 * Watches the vault and calls `onChange` (debounced) with the vault-relative paths that were
 * added, removed or edited.
 */
export function startWatching(root: string, onChange: (paths: string[]) => void): void {
  stopWatching()
  const toRel = (path: string): string => relative(root, path).split(sep).join('/')
  watcher = watch(root, {
    ignoreInitial: true,
    ignored: (path) => toRel(path).split('/').some((part) => part !== '' && isIgnoredName(part))
  })
  watcher.on('all', (_event, path) => {
    pending.add(toRel(path))
    clearTimeout(timer)
    timer = setTimeout(() => {
      const paths = [...pending]
      pending = new Set()
      onChange(paths)
    }, 120)
  })
  watcher.on('error', (err) => console.error('[watcher]', err))
}

export function stopWatching(): void {
  clearTimeout(timer)
  pending = new Set()
  watcher?.close()
  watcher = null
}
