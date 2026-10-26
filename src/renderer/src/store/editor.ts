import { create } from 'zustand'
import type { Heading } from '../lib/outline'

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict'

/**
 * The editor area is a tree: splits lay their children out side by side ('row') or stacked
 * ('column'), and the leaves are panes. `sizes` are fractions that add up to 1.
 */
export type LayoutNode =
  | { type: 'pane'; id: string }
  | { type: 'split'; id: string; dir: 'row' | 'column'; children: LayoutNode[]; sizes: number[] }

export interface PaneState {
  tabs: string[]
  active: string | null
  /** Pinned tabs: always first in the bar, and Ctrl+W / the close button leave them open. */
  pinned?: string[]
}

/** Keeps pinned tabs at the front, otherwise preserving order. */
export function orderTabs(tabs: string[], pinned: string[] = []): string[] {
  const set = new Set(pinned)
  return [...tabs.filter((t) => set.has(t)), ...tabs.filter((t) => !set.has(t))]
}

/** UI-facing editor state. The documents themselves live in lib/editorController. */
interface EditorState {
  layout: LayoutNode
  panes: Record<string, PaneState>
  /** The pane you're working in: commands, the outline and backlinks follow it. */
  activePane: string
  /** The active pane's current tab (kept in sync by setPanes). */
  active: string | null
  /** Save status per note path. */
  status: Record<string, SaveStatus>
  /** Word count of the active note. */
  words: number
  /** Recently opened notes, most recent first. */
  recent: string[]
  /** Headings of the active note, and which one the cursor is under (-1 for none). */
  outline: Heading[]
  currentHeading: number
}

export const FIRST_PANE = 'p1'

export const useEditor = create<EditorState>(() => ({
  layout: { type: 'pane', id: FIRST_PANE },
  panes: { [FIRST_PANE]: { tabs: [], active: null } },
  activePane: FIRST_PANE,
  active: null,
  status: {},
  words: 0,
  recent: [],
  outline: [],
  currentHeading: -1
}))

/** Updates panes/layout/activePane together and keeps `active` pointing at the right tab. */
export function setPanes(
  update: (s: Pick<EditorState, 'layout' | 'panes' | 'activePane'>) => Partial<Pick<EditorState, 'layout' | 'panes' | 'activePane'>>
): void {
  useEditor.setState((s) => {
    const next = { layout: s.layout, panes: s.panes, activePane: s.activePane, ...update(s) }
    // Every pane keeps its pinned list (unless the update set one), limited to tabs it still has,
    // and pinned tabs stay at the front.
    const panes: Record<string, PaneState> = {}
    for (const [id, p] of Object.entries(next.panes)) {
      const pinned = (p.pinned ?? s.panes[id]?.pinned ?? []).filter((t) => p.tabs.includes(t))
      panes[id] = { ...p, pinned, tabs: orderTabs(p.tabs, pinned) }
    }
    return { ...next, panes, active: panes[next.activePane]?.active ?? null }
  })
}

export function setStatus(path: string, status: SaveStatus): void {
  useEditor.setState((s) => (s.status[path] === status ? s : { status: { ...s.status, [path]: status } }))
}

// ---------- layout tree helpers ----------

/** Pane ids in reading order (left to right, top to bottom). */
export function paneOrder(node: LayoutNode): string[] {
  return node.type === 'pane' ? [node.id] : node.children.flatMap(paneOrder)
}

export function allTabs(panes: Record<string, PaneState>): string[] {
  return Object.values(panes).flatMap((p) => p.tabs)
}

/** Which pane, if any, has `id` open (preferring the active pane). */
export function paneWithTab(id: string): string | null {
  const { panes, activePane } = useEditor.getState()
  if (panes[activePane]?.tabs.includes(id)) return activePane
  return Object.keys(panes).find((p) => panes[p].tabs.includes(id)) ?? null
}
