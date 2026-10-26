import { useMemo } from 'react'
import { FilePlus, FileText } from 'lucide-react'
import { useVault } from '../../store/vault'
import { useEditor } from '../../store/editor'
import { fuzzyFilter } from '../../lib/fuzzy'
import { noteTitle, notePaths, parentOf } from '../../lib/paths'
import { openNote } from '../../lib/editorController'
import { Highlighted, type PickerItem } from './Picker'

const MAX_ITEMS = 60

/**
 * Notes matching `query` as picker items: recent notes first when the query is empty, and a
 * "Create note" item when nothing has that exact name.
 */
export function useNoteItems(query: string, onDone?: () => void): PickerItem[] {
  const tree = useVault((s) => s.tree)
  const recent = useEditor((s) => s.recent)

  return useMemo(() => {
    const all = notePaths(tree)
    const open = (path: string) => () => {
      onDone?.()
      openNote(path)
    }
    const item = (path: string, positions: number[] = []): PickerItem => {
      const key = path.replace(/\.md$/i, '')
      const titleStart = key.lastIndexOf('/') + 1
      return {
        id: path,
        icon: <FileText size={15} />,
        label: <Highlighted text={noteTitle(path)} positions={positions} offset={titleStart} />,
        detail: parentOf(path) || undefined,
        run: open(path)
      }
    }

    const q = query.trim()
    if (!q) {
      const existing = new Set(all)
      const recentPaths = recent.filter((p) => existing.has(p))
      const rest = all
        .filter((p) => !recentPaths.includes(p))
        .sort((a, b) => noteTitle(a).localeCompare(noteTitle(b), undefined, { sensitivity: 'base', numeric: true }))
      return [...recentPaths, ...rest].slice(0, MAX_ITEMS).map((p) => item(p))
    }

    const items = fuzzyFilter(all, q, (p) => p.replace(/\.md$/i, ''))
      .slice(0, MAX_ITEMS)
      .map(({ item: p, positions }) => item(p, positions))

    const exact = all.some((p) => noteTitle(p).toLowerCase() === q.toLowerCase() || p.replace(/\.md$/i, '').toLowerCase() === q.toLowerCase())
    if (!exact) {
      items.push({
        id: '__create__',
        icon: <FilePlus size={15} />,
        label: (
          <>
            Create <strong>{q}</strong>
          </>
        ),
        run: () => {
          onDone?.()
          useVault.getState().createNoteAt(q)
        }
      })
    }
    return items
  }, [tree, recent, query, onDone])
}
