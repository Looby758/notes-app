import { create } from 'zustand'

/**
 * Several notes (or folders) picked at once, for bulk actions: Ctrl/⌘-click adds or removes one,
 * Shift-click picks everything between the last click and this one.
 */
interface SelectionState {
  paths: string[]
  /** Where a Shift-click range starts. */
  anchor: string | null
}

export const useSelection = create<SelectionState>(() => ({ paths: [], anchor: null }))

export const isMultiSelected = (path: string): boolean => useSelection.getState().paths.includes(path)

/** Ctrl/⌘-click. `current` is the item that was already highlighted, which joins the selection. */
export function toggleSelected(path: string, current?: string | null): void {
  const { paths } = useSelection.getState()
  const base = paths.length === 0 && current && current !== path ? [current] : paths
  useSelection.setState({ paths: base.includes(path) ? base.filter((p) => p !== path) : [...base, path], anchor: path })
}

/** Shift-click: everything from the anchor to `path`, in the order shown (`order`). */
export function selectRange(path: string, order: string[], current?: string | null): void {
  const { anchor } = useSelection.getState()
  const start = order.indexOf(anchor ?? current ?? path)
  const end = order.indexOf(path)
  if (start === -1 || end === -1) {
    useSelection.setState({ paths: [path], anchor: path })
    return
  }
  const [a, b] = start < end ? [start, end] : [end, start]
  useSelection.setState({ paths: order.slice(a, b + 1), anchor: anchor ?? current ?? path })
}

export function setSelection(paths: string[]): void {
  useSelection.setState({ paths, anchor: paths[0] ?? null })
}

export function clearSelection(): void {
  if (useSelection.getState().paths.length) useSelection.setState({ paths: [], anchor: null })
}
