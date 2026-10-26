import { create } from 'zustand'
import { dayKey as dayKeyOf } from '../lib/dates'

export type SidebarView = 'files' | 'search' | 'tags'
export type RightView = 'backlinks' | 'outline' | 'calendar'
export type CalendarView = 'month' | 'week'
export type Modal = 'switcher' | 'commands' | 'template' | null

export const SIDEBAR_MIN = 180
export const SIDEBAR_MAX = 520

interface UIState {
  leftOpen: boolean
  rightOpen: boolean
  leftWidth: number
  rightWidth: number
  sidebarView: SidebarView
  rightView: RightView
  starredOpen: boolean
  /** The day selected in the calendars (day key) and the full calendar's view. */
  calendarDay: string
  calendarView: CalendarView
  searchQuery: string
  /** Bumped to ask the search box to take focus. */
  searchFocus: number
  modal: Modal
  /** Provided by App: switching or closing the notes folder. */
  vaultActions: { switchVault: () => void; closeVault: () => void }
}

/** Layout bits remembered per computer. (Text size and the rest live in Settings, in settings.json.) */
const PERSISTED = ['leftOpen', 'rightOpen', 'leftWidth', 'rightWidth', 'sidebarView', 'rightView', 'starredOpen', 'calendarView'] as const

const saved = ((): Partial<UIState> => {
  try {
    return JSON.parse(localStorage.getItem('ui') ?? '{}')
  } catch {
    return {}
  }
})()

export const useUI = create<UIState>(() => ({
  leftOpen: saved.leftOpen ?? true,
  rightOpen: saved.rightOpen ?? true,
  leftWidth: saved.leftWidth ?? 260,
  rightWidth: saved.rightWidth ?? 280,
  sidebarView: saved.sidebarView ?? 'files',
  rightView: saved.rightView ?? 'backlinks',
  starredOpen: saved.starredOpen ?? true,
  calendarDay: dayKeyOf(new Date()),
  calendarView: saved.calendarView ?? 'month',
  searchQuery: '',
  searchFocus: 0,
  modal: null,
  vaultActions: { switchVault: () => {}, closeVault: () => {} }
}))

// Remember layout choices between launches.
let lastSaved = ''
useUI.subscribe((s) => {
  const json = JSON.stringify(Object.fromEntries(PERSISTED.map((k) => [k, s[k]])))
  if (json === lastSaved) return
  lastSaved = json
  try {
    localStorage.setItem('ui', json)
  } catch {
    // not fatal
  }
})

/** Opens the sidebar on the search view, optionally with a query (e.g. "#tag"). */
export function showSearch(query?: string): void {
  useUI.setState((s) => ({
    leftOpen: true,
    sidebarView: 'search',
    searchQuery: query ?? s.searchQuery,
    searchFocus: s.searchFocus + 1,
    modal: null
  }))
}

export function showSidebarView(view: SidebarView): void {
  if (view === 'search') return showSearch()
  useUI.setState({ leftOpen: true, sidebarView: view, modal: null })
}

export function showRightView(view: RightView): void {
  useUI.setState({ rightOpen: true, rightView: view })
}

export function toggleFocusMode(): void {
  useUI.setState((s) => {
    const anyOpen = s.leftOpen || s.rightOpen
    return { leftOpen: !anyOpen, rightOpen: !anyOpen }
  })
}
