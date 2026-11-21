import { create } from 'zustand'
import { addToHistory, DEFAULT_PROJECT_COMMANDS } from '@shared/terminalTools'

/**
 * The Terminal tab's state: the command lines open in it, your projects (an app's folder and the
 * commands you run for it), and the commands you've run before. Projects and history are kept on
 * this computer (folders differ between computers); the open terminals last until the tab is
 * closed or Orbit quits.
 */

export interface TerminalInfo {
  id: string
  name: string
  /** The folder it starts in; null for the notes folder. */
  folder: string | null
  /** The command its run button started, run again on Restart. */
  command?: string
  projectId?: string
  /** False once the command line has ended. */
  running: boolean
  /** Errors printed since you last looked at it. */
  errors: number
}

export interface TerminalProject {
  id: string
  name: string
  folder: string
  commands: string[]
}

interface TerminalsState {
  terminals: TerminalInfo[]
  active: string | null
  projects: TerminalProject[]
  /** Commands run before, newest first. */
  history: string[]
  /** Whether the Run panel (projects, saved commands, history) is showing. */
  panel: boolean
}

const PROJECTS_KEY = 'terminal:projects'
const HISTORY_KEY = 'terminal:history'
const PANEL_KEY = 'terminal:panel'
/** Open terminals, so a reload of the window picks them up again (they keep running meanwhile). */
const OPEN_KEY = 'terminal:open'

function read<T>(storage: Storage, key: string, fallback: T): T {
  try {
    const v = storage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

function write(storage: Storage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or unavailable: it just isn't remembered.
  }
}

const saved = read<{ terminals: TerminalInfo[]; active: string | null }>(sessionStorage, OPEN_KEY, { terminals: [], active: null })

export const useTerminals = create<TerminalsState>(() => ({
  terminals: saved.terminals.map((t) => ({ ...t, errors: 0 })),
  active: saved.active,
  projects: read<TerminalProject[]>(localStorage, PROJECTS_KEY, []),
  history: read<string[]>(localStorage, HISTORY_KEY, []),
  panel: read<boolean>(localStorage, PANEL_KEY, true)
}))

useTerminals.subscribe((s, prev) => {
  if (s.terminals !== prev.terminals || s.active !== prev.active) write(sessionStorage, OPEN_KEY, { terminals: s.terminals, active: s.active })
  if (s.projects !== prev.projects) write(localStorage, PROJECTS_KEY, s.projects)
  if (s.history !== prev.history) write(localStorage, HISTORY_KEY, s.history)
  if (s.panel !== prev.panel) write(localStorage, PANEL_KEY, s.panel)
})

const newId = (): string => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function getTerminal(id: string): TerminalInfo | undefined {
  return useTerminals.getState().terminals.find((t) => t.id === id)
}

export function updateTerminal(id: string, patch: Partial<TerminalInfo>): void {
  useTerminals.setState((s) => ({ terminals: s.terminals.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
}

/** Adds a terminal to the list (and shows it). The command line itself is started by the page. */
export function addTerminal(info: Omit<TerminalInfo, 'id' | 'running' | 'errors'>): TerminalInfo {
  const t: TerminalInfo = { ...info, id: newId(), running: false, errors: 0 }
  useTerminals.setState((s) => ({ terminals: [...s.terminals, t], active: t.id }))
  return t
}

export function setActiveTerminal(id: string): void {
  useTerminals.setState((s) => ({ active: id, terminals: s.terminals.map((t) => (t.id === id && t.errors ? { ...t, errors: 0 } : t)) }))
}

/** A name for a new plain terminal: "Terminal", then "Terminal 2"… */
export function nextTerminalName(base = 'Terminal'): string {
  const names = new Set(useTerminals.getState().terminals.map((t) => t.name))
  if (!names.has(base)) return base
  let n = 2
  while (names.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

export function rememberCommand(command: string): void {
  useTerminals.setState((s) => ({ history: addToHistory(s.history, command) }))
}

export function forgetCommand(command: string): void {
  useTerminals.setState((s) => ({ history: s.history.filter((h) => h !== command) }))
}

export function setPanel(panel: boolean): void {
  useTerminals.setState({ panel })
}

/** Adds a project for an app's folder, with the usual commands to start with. */
export function addProject(folder: string): TerminalProject {
  const name = folder.split(/[\\/]/).filter(Boolean).pop() ?? 'Project'
  const p: TerminalProject = { id: newId(), name: name.charAt(0).toUpperCase() + name.slice(1), folder, commands: [...DEFAULT_PROJECT_COMMANDS] }
  useTerminals.setState((s) => ({ projects: [...s.projects, p] }))
  return p
}

export function updateProject(id: string, patch: Partial<Omit<TerminalProject, 'id'>>): void {
  useTerminals.setState((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
}

export function removeProject(id: string): void {
  useTerminals.setState((s) => ({ projects: s.projects.filter((p) => p.id !== id) }))
}

/** Whether any terminal has errors you haven't looked at (for the red dot on the Terminal tab). */
export const unseenTerminalErrors = (s: TerminalsState): number => s.terminals.reduce((n, t) => n + t.errors, 0)
