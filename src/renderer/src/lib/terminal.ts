import { Terminal, type IDisposable, type IMarker, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { useEditor } from '../store/editor'
import { commandForKey, type Command } from './commands'
import { openSpecialTab, TERMINAL_TAB } from './editorController'
import { commitAllCommand, copyRunCommand, releaseCommand, stashCommand, switchBranchCommand, tryBranchCommand, type VersionBump } from '@shared/appStudio'
import { IS_MAC } from '@shared/platform'
import { commandLabel, findFiles, isErrorLine, keepsRunning, latestAndRunCommand, LineTracker, resolveFrom, runCommandOf } from '@shared/terminalTools'
import {
  addTerminal,
  getTerminal,
  nextTerminalName,
  rememberCommand,
  setActiveTerminal,
  setFinding,
  setSplit,
  shownTerminals,
  updateTerminal,
  useTerminals,
  type TerminalProject
} from '../store/terminals'
import { notify } from '../store/notify'

/**
 * The Terminal tab's screens and the command lines behind them. They're kept here rather than in
 * the page, so switching to another tab (or moving it to another pane) doesn't lose what's on them.
 * Closing the tab ends them all.
 */

interface Session {
  id: string
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  /** What the terminal draws into; moved into whichever page is showing the tab. */
  el: HTMLDivElement
  /** False once the command line has ended; the next key press starts a new one. */
  running: boolean
  /** The folder its command line is in (for file paths in what it prints). */
  folder: string | null
  /** A run button's command, typed once the command line is ready. */
  pending: string | null
  /** When Close app was pressed (Windows then asks "Terminate batch job (Y/N)?", answered yes for you). */
  closingAt: number
  /** Where the error check got to (moves with the text as old lines scroll away). */
  checked: IMarker | null
  typed: LineTracker
  cleanup: (() => void)[]
}

const sessions = new Map<string, Session>()
/** The page showing the terminals, if the tab is open somewhere. */
let shownIn: HTMLElement | null = null
let home: string | undefined
let listening = false

const DARK_COLORS: ITheme = {
  black: '#3b3d4a',
  red: '#f07178',
  green: '#c3e88d',
  yellow: '#ffcb6b',
  blue: '#82aaff',
  magenta: '#c792ea',
  cyan: '#89ddff',
  white: '#d7d9e0',
  brightBlack: '#6b6f80',
  brightRed: '#ff8b92',
  brightGreen: '#ddffa7',
  brightYellow: '#ffe585',
  brightBlue: '#9cc4ff',
  brightMagenta: '#e1acff',
  brightCyan: '#a3f7ff',
  brightWhite: '#ffffff'
}

const LIGHT_COLORS: ITheme = {
  black: '#24262e',
  red: '#c8303c',
  green: '#3d7a1c',
  yellow: '#8a6100',
  blue: '#2f5fc4',
  magenta: '#8a3fb5',
  cyan: '#18788a',
  white: '#8a8e9a',
  brightBlack: '#5e6270',
  brightRed: '#e0434f',
  brightGreen: '#4f9426',
  brightYellow: '#a87700',
  brightBlue: '#3f74e0',
  brightMagenta: '#a14fd0',
  brightCyan: '#1f91a6',
  brightWhite: '#24262e'
}

/** The app's current colours and code font, read from its CSS variables. */
function look(): { theme: ITheme; font: string } {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string): string => css.getPropertyValue(name).trim()
  const light = document.body.classList.contains('theme-light')
  return {
    theme: {
      ...(light ? LIGHT_COLORS : DARK_COLORS),
      background: v('--bg'),
      foreground: v('--text'),
      cursor: v('--accent'),
      cursorAccent: v('--bg'),
      selectionBackground: v('--accent-dim')
    },
    font: v('--font-mono') || 'monospace'
  }
}

function applyLook(term: Terminal): void {
  const { theme, font } = look()
  term.options.theme = theme
  term.options.fontFamily = font
}

/** Keys pressed in the terminal: which go to the command line, and which to the app. */
function handleKey(term: Terminal, e: KeyboardEvent): boolean {
  if (e.type !== 'keydown') return true
  // Esc belongs to whatever's running (it shouldn't also leave zen mode).
  if (e.key === 'Escape') {
    e.stopPropagation()
    return true
  }
  // Ctrl+F (⌘F on a Mac): find in what this terminal printed.
  if (e.code === 'KeyF' && !e.altKey && !e.shiftKey && (IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)) {
    e.preventDefault()
    e.stopPropagation()
    setFinding(true)
    return false
  }
  if (IS_MAC) {
    // ⌘ is the app's; Control is the command line's (Control+C stops a command, and so on).
    if (e.ctrlKey && !e.metaKey) {
      e.stopPropagation()
      return true
    }
  } else if (e.ctrlKey && !e.altKey && !e.shiftKey) {
    // Like Windows Terminal: Ctrl+C copies when text is selected (otherwise it stops the command),
    // and Ctrl+V pastes.
    if (e.code === 'KeyC' && term.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection())
      term.clearSelection()
      e.preventDefault()
      return false
    }
    if (e.code === 'KeyV') return false
  }
  // The app's own shortcuts (Ctrl+K, Ctrl+Tab…) still work from here.
  if (commandForKey(e)) return false
  return true
}


/** The background behind a line that looks like an error. */
const errorBackground = (): string => (document.body.classList.contains('theme-light') ? '#fbe1e3' : '#45222a')

/** Listens for what every command line prints (once for the whole window). */
function listen(): void {
  if (listening) return
  listening = true
  void window.api.terminalHome().then((h) => (home = h))
  // Coming back to the window with the terminal showing: its errors count as seen.
  window.addEventListener('focus', () => {
    const id = useTerminals.getState().active
    if (shownIn && id && getTerminal(id)?.errors) updateTerminal(id, { errors: 0 })
  })
  window.api.onTerminalData((id, data) => {
    const s = sessions.get(id)
    if (!s) return
    s.term.write(data, () => checkForErrors(s))
    if (s.closingAt && Date.now() - s.closingAt < 3000 && /Terminate batch job \(Y\/N\)\?/i.test(data)) {
      s.closingAt = 0
      window.api.terminalInput(id, 'Y\r')
    }
    if (s.pending) {
      const command = s.pending
      s.pending = null
      // Give the prompt a moment to finish drawing before typing into it.
      setTimeout(() => window.api.terminalInput(id, command + '\r'), 150)
    }
  })
  window.api.onTerminalExit((id) => {
    const s = sessions.get(id)
    if (!s) return
    s.running = false
    updateTerminal(id, { running: false })
    s.term.write('\r\n\x1b[2mThe command line has ended. Press any key (or Restart) to start a new one.\x1b[0m\r\n')
  })
}

/** Highlights new lines that look like errors, and counts them if you're not looking at that terminal. */
function checkForErrors(s: Session): void {
  const buf = s.term.buffer.active
  const cursor = buf.baseY + buf.cursorY
  let from = s.checked && !s.checked.isDisposed ? s.checked.line : 0
  if (from > cursor) from = cursor
  let found = 0
  // The line the cursor is on may still be being written, so it's checked next time.
  for (let y = from; y < cursor; y++) {
    const line = buf.getLine(y)
    if (!line || !isErrorLine(line.translateToString(true))) continue
    const marker = s.term.registerMarker(y - cursor)
    if (!marker) continue
    s.term.registerDecoration({ marker, x: 0, width: s.term.cols, backgroundColor: errorBackground(), layer: 'bottom' })
    found++
  }
  s.checked?.dispose()
  s.checked = s.term.registerMarker(0) ?? null
  if (!found) return
  const looking = shownIn !== null && useTerminals.getState().active === s.id && document.hasFocus()
  if (!looking) {
    const info = getTerminal(s.id)
    if (info) updateTerminal(s.id, { errors: info.errors + found })
  }
}

/** Makes file paths in what was printed clickable: a click opens the file (after asking). */
function fileLinks(s: Session): IDisposable {
  return s.term.registerLinkProvider({
    provideLinks(y, callback) {
      const line = s.term.buffer.active.getLine(y - 1)?.translateToString(true) ?? ''
      const files = findFiles(line)
      if (!files.length || !s.folder) return callback(undefined)
      const folder = s.folder
      callback(
        files.map((f) => ({
          range: { start: { x: f.start + 1, y }, end: { x: f.end, y } },
          text: line.slice(f.start, f.end),
          decorations: { underline: true, pointerCursor: true },
          activate: () => {
            window.api.explorerOpen(resolveFrom(folder, f.path, home), true).catch((err) => notify(err))
          }
        }))
      )
    }
  })
}

async function startShell(s: Session): Promise<void> {
  if (s.el.isConnected && s.el.clientWidth > 0) s.fit.fit()
  const info = getTerminal(s.id)
  const result = await window.api.terminalStart(s.id, info?.folder ?? null, s.term.cols, s.term.rows)
  if (sessions.get(s.id) !== s) return
  if (!result.ok) {
    s.term.write(`\x1b[31mThe terminal couldn’t start: ${result.error}\x1b[0m\r\n`)
    return
  }
  s.running = true
  s.folder = result.folder
  updateTerminal(s.id, { running: true })
  // A command line left running (after the window reloaded) carries on, at this size.
  if (result.resumed) {
    window.api.terminalResize(s.id, s.term.cols, s.term.rows)
    if (s.pending) {
      window.api.terminalInput(s.id, s.pending + '\r')
      s.pending = null
    }
  }
}

function create(id: string): Session {
  listen()
  const el = document.createElement('div')
  el.className = 'terminal-screen'
  const term = new Terminal({ fontSize: 13, lineHeight: 1.2, cursorBlink: true, scrollback: 5000, allowProposedApi: true })
  const fit = new FitAddon()
  term.loadAddon(fit)
  const search = new SearchAddon({ highlightLimit: 2000 })
  term.loadAddon(search)
  applyLook(term)
  // Side by side: clicking into a terminal makes it the one the buttons act on.
  el.addEventListener('mousedown', () => {
    if (useTerminals.getState().active !== id) setActiveTerminal(id)
  })
  const s: Session = { id, term, fit, search, el, running: false, folder: null, pending: takePending(id), closingAt: 0, checked: null, typed: new LineTracker(), cleanup: [] }
  term.attachCustomKeyEventHandler((e) => handleKey(term, e))
  term.onData((data) => {
    if (s.running) {
      window.api.terminalInput(id, data)
      for (const command of s.typed.feed(data)) rememberCommand(command)
    } else if (sessions.get(id) === s) {
      term.reset()
      s.checked = null
      void startShell(s)
    }
  })
  term.onResize(({ cols, rows }) => {
    if (s.running) window.api.terminalResize(id, cols, rows)
  })
  const links = fileLinks(s)
  s.cleanup.push(() => links.dispose())
  // Follow theme and font changes from Settings.
  const watcher = new MutationObserver(() => applyLook(term))
  watcher.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
  watcher.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  s.cleanup.push(() => watcher.disconnect())
  sessions.set(id, s)
  return s
}

function dispose(id: string, stopShell = true): void {
  const s = sessions.get(id)
  if (!s) return
  sessions.delete(id)
  for (const fn of s.cleanup) fn()
  s.term.dispose()
  s.el.remove()
  if (stopShell) void window.api.terminalStop(id)
}

/** Ends every terminal (the Terminal tab was closed). */
function endAll(): void {
  for (const id of [...sessions.keys()]) dispose(id)
  // Ones carried over from before the window reloaded, never shown since.
  for (const t of useTerminals.getState().terminals) void window.api.terminalStop(t.id)
  useTerminals.setState({ terminals: [], active: null })
}

// Closing the tab (in any pane) ends the command lines.
useEditor.subscribe((state) => {
  if (!useTerminals.getState().terminals.length) return
  if (!Object.values(state.panes).some((p) => p.tabs.includes(TERMINAL_TAB))) endAll()
})

/** Puts the screens in the page: makes any that are missing, removes closed ones, shows the active one. */
function sync(host: HTMLElement): void {
  const state = useTerminals.getState()
  const { terminals, active } = state
  const shown = shownTerminals(state)
  for (const id of [...sessions.keys()]) if (!terminals.some((t) => t.id === id)) dispose(id)
  for (const t of terminals) {
    let s = sessions.get(t.id)
    const fresh = !s
    if (!s) s = create(t.id)
    if (s.el.parentElement !== host) host.appendChild(s.el)
    if (fresh) {
      s.term.open(s.el)
      void startShell(s)
    }
    s.el.hidden = !shown.includes(t.id)
    // Side by side, they keep the order of the strip along the top.
    s.el.style.order = String(terminals.indexOf(t))
    s.el.classList.toggle('active', shown.length > 1 && t.id === active)
  }
  // The right-hand one of two gets the line between them.
  const right = shown.length > 1 ? [...shown].sort((a, b) => terminals.findIndex((t) => t.id === a) - terminals.findIndex((t) => t.id === b))[1] : null
  for (const [id, s] of sessions) s.el.classList.toggle('right', id === right)
  host.classList.toggle('split', shown.length > 1)
  fitShown(host)
  const s = active ? sessions.get(active) : undefined
  if (s && host.clientWidth > 0 && (host.contains(document.activeElement) || !document.activeElement || document.activeElement === document.body)) s.term.focus()
}

/** Fits the showing terminals to their space (not while hidden: a zero size would squash them). */
function fitShown(host: HTMLElement): void {
  if (host.clientWidth === 0 || host.clientHeight === 0) return
  for (const id of shownTerminals(useTerminals.getState())) {
    const s = sessions.get(id)
    if (s && s.el.clientWidth > 0) s.fit.fit()
  }
}

/** Shows the terminals in a page (starting one the first time); returns a function that takes them out again. */
export function attachTerminal(host: HTMLElement): () => void {
  shownIn = host
  if (!useTerminals.getState().terminals.length) addTerminal({ name: 'Terminal', folder: null })
  const state = useTerminals.getState()
  // Looking at the tab: the errors in the terminal showing count as seen.
  setActiveTerminal(state.active && state.terminals.some((t) => t.id === state.active) ? state.active : state.terminals[0].id)
  sync(host)
  const unsubscribe = useTerminals.subscribe((now, prev) => {
    if (now.terminals === prev.terminals && now.active === prev.active && now.split === prev.split) return
    // The find bar searches the active terminal: clear the highlights left in the one before.
    if (now.active !== prev.active && prev.active) sessions.get(prev.active)?.search.clearDecorations()
    sync(host)
    if (now.active !== prev.active && now.active) sessions.get(now.active)?.term.focus()
  })
  const refit = (): void => fitShown(host)
  const sizes = new ResizeObserver(refit)
  sizes.observe(host)
  refit()
  focusTerminal()
  return () => {
    unsubscribe()
    sizes.disconnect()
    if (shownIn === host) shownIn = null
    for (const s of sessions.values()) if (s.el.parentElement === host) s.el.remove()
  }
}

export function focusTerminal(): void {
  const id = useTerminals.getState().active
  if (id) sessions.get(id)?.term.focus()
}

/** Opens a new plain terminal, in `folder` (the notes folder if not given). */
export function newTerminal(folder: string | null = null, name?: string): void {
  addTerminal({ name: name ?? nextTerminalName(folder ? (folder.split(/[\\/]/).filter(Boolean).pop() ?? 'Terminal') : 'Terminal'), folder })
  openSpecialTab(TERMINAL_TAB)
}

/**
 * Closes the app running in a terminal (a dev server, say), like pressing Ctrl+C: the terminal
 * stays open, ready for the next command.
 */
export function closeRunningApp(id: string): void {
  const s = sessions.get(id)
  if (!s?.running) return
  s.pending = null
  s.closingAt = Date.now()
  window.api.terminalInput(id, '\x03')
  s.term.focus()
}

/** Ends a terminal's command line (and whatever is running in it); it stays in the list to restart. */
export function stopTerminal(id: string): void {
  const s = sessions.get(id)
  if (!s?.running) return
  s.pending = null
  void window.api.terminalStop(id)
}

/** Starts a terminal's command line again from fresh, running its command again if it has one. */
export function restartTerminal(id: string): void {
  const s = sessions.get(id)
  const info = getTerminal(id)
  if (!s || !info) return
  s.running = false
  s.term.reset()
  s.checked = null
  s.pending = info.command ?? null
  updateTerminal(id, { errors: 0 })
  // Stopping first, so the new command line doesn't pick up the old one.
  void window.api.terminalStop(id).then(() => startShell(s))
}

/** Closes one terminal (ending what's running in it). */
export function closeTerminal(id: string): void {
  dispose(id)
  const { terminals } = useTerminals.getState()
  const i = terminals.findIndex((t) => t.id === id)
  const rest = terminals.filter((t) => t.id !== id)
  const { active, split } = useTerminals.getState()
  if (active === id && split) useTerminals.setState({ terminals: rest, active: split, split: null })
  else useTerminals.setState({ terminals: rest, active: active === id ? (rest[Math.min(i, rest.length - 1)]?.id ?? null) : active, split: split === id ? null : split })
}

/** Shows two terminals side by side (the active one and the next, or a new one), or goes back to one. */
export function toggleSideBySide(): void {
  const { terminals, active, split } = useTerminals.getState()
  if (split) return setSplit(null)
  if (!active) return
  const i = terminals.findIndex((t) => t.id === active)
  const other = terminals[i + 1] ?? terminals[i - 1]
  if (other) return setSplit(other.id)
  const fresh = addTerminal({ name: nextTerminalName(), folder: getTerminal(active)?.folder ?? null })
  useTerminals.setState({ active, split: fresh.id })
}

const findColours = (): ISearchOptions['decorations'] => {
  const light = document.body.classList.contains('theme-light')
  return {
    matchBackground: light ? '#fff1a8' : '#5c4d12',
    matchOverviewRuler: '#d4a72c',
    activeMatchBackground: light ? '#ffb340' : '#c27c0e',
    activeMatchColorOverviewRuler: '#ff9f0a'
  }
}

/** Finds `query` in what the active terminal printed (`back`: the one before). False if it's not there. */
export function findInTerminal(query: string, back = false, typing = false): boolean {
  const s = sessions.get(useTerminals.getState().active ?? '')
  if (!s) return false
  if (!query) {
    s.search.clearDecorations()
    return false
  }
  const options: ISearchOptions = { incremental: typing && !back, decorations: findColours() }
  return back ? s.search.findPrevious(query, options) : s.search.findNext(query, options)
}

/** Hears how many matches there are, and which one is picked, in the active terminal. */
export function onFindResults(callback: (index: number, count: number) => void): () => void {
  const subs: IDisposable[] = []
  const watch = (): void => {
    for (const d of subs.splice(0)) d.dispose()
    const s = sessions.get(useTerminals.getState().active ?? '')
    if (s) subs.push(s.search.onDidChangeResults(({ resultIndex, resultCount }) => callback(resultIndex, resultCount)))
  }
  watch()
  const unsubscribe = useTerminals.subscribe((now, prev) => {
    if (now.active !== prev.active) {
      watch()
      callback(-1, 0)
    }
  })
  return () => {
    unsubscribe()
    for (const d of subs) d.dispose()
  }
}

/** Closes the find bar: the highlights go and typing goes back to the terminal. */
export function endFind(): void {
  const s = sessions.get(useTerminals.getState().active ?? '')
  s?.search.clearDecorations()
  setFinding(false)
  s?.term.focus()
}

/**
 * The "Get latest and run" button: in the project's app terminal (made if needed, started fresh),
 * pulls the latest code, installs packages only if they changed, then starts the app. Restart
 * afterwards just starts the app again.
 */
export function getLatestAndRun(project: TerminalProject): void {
  const run = runCommandOf(project.commands)
  rememberCommand('git pull')
  runInAppTerminal(project, latestAndRunCommand(IS_WINDOWS, run))
}

/** App Studio's "Try it": switches the app to a pull request's branch, gets its latest, and starts it. */
export function tryBranch(project: TerminalProject, branch: string): void {
  rememberCommand(`git checkout ${branch}`)
  runInAppTerminal(project, tryBranchCommand(IS_WINDOWS, branch, runCommandOf(project.commands)))
}

/** App Studio's release button: bumps the version, commits and tags it, and pushes, in the project's own terminal. */
export function releaseApp(project: TerminalProject, bump: VersionBump): void {
  runProjectCommand(project, releaseCommand(IS_WINDOWS, bump))
}

/**
 * Runs a test copy of a project (a pull request's version, in a folder of its own): in the copy's
 * own terminal (made if needed, started fresh), gets the branch's latest, installs if needed, and
 * starts it. Restart afterwards just starts it again.
 */
export function runTestCopy(project: TerminalProject, path: string, branch: string, label: string): void {
  const run = runCommandOf(project.commands)
  rememberCommand(`git checkout ${branch}`)
  const line = copyRunCommand(IS_WINDOWS, branch, run)
  const existing = useTerminals.getState().terminals.find((t) => t.folder === path && t.command === run)
  if (existing) {
    setActiveTerminal(existing.id)
    openSpecialTab(TERMINAL_TAB)
    const s = sessions.get(existing.id)
    if (s) {
      restartTerminal(existing.id)
      s.pending = line
    } else pendingFor.set(existing.id, line)
    return
  }
  const t = addTerminal({ name: `${project.name} · ${label}`, folder: path, command: run })
  openSpecialTab(TERMINAL_TAB)
  queueMicrotask(() => {
    const s = sessions.get(t.id)
    if (s) s.pending = line
    else pendingFor.set(t.id, line)
  })
}

/** Closes a test copy's terminals (ending the app running from it), so its folder can be removed. */
export function closeCopyTerminals(path: string): void {
  for (const t of useTerminals.getState().terminals) if (t.folder === path) closeTerminal(t.id)
}

/** Puts the project's uncommitted changes aside (a git stash), in its own terminal. */
export function stashChanges(project: TerminalProject): void {
  runProjectCommand(project, stashCommand())
}

/** Commits all the project's changes, in its own terminal. */
export function commitChanges(project: TerminalProject, message: string): void {
  runProjectCommand(project, commitAllCommand(IS_WINDOWS, message))
}

/** Switches the project to a branch (main, for a release) and gets its latest, in the project's own terminal. */
export function switchBranch(project: TerminalProject, branch: string): void {
  runProjectCommand(project, switchBranchCommand(IS_WINDOWS, branch))
}

const IS_WINDOWS = !IS_MAC && /win/i.test(navigator.platform)

/** Types a command line into the project's app terminal (made if needed, started fresh), and shows it. */
function runInAppTerminal(project: TerminalProject, line: string): void {
  const run = runCommandOf(project.commands)
  const existing = useTerminals.getState().terminals.find((t) => t.projectId === project.id && t.command === run)
  if (existing) {
    setActiveTerminal(existing.id)
    openSpecialTab(TERMINAL_TAB)
    const s = sessions.get(existing.id)
    if (s) {
      restartTerminal(existing.id)
      s.pending = line
    } else pendingFor.set(existing.id, line)
    return
  }
  const t = addTerminal({
    name: `${project.name} · ${commandLabel(run).replace(/^(npm|pnpm|yarn|bun) (run )?/, '')}`,
    folder: project.folder,
    projectId: project.id,
    command: run
  })
  openSpecialTab(TERMINAL_TAB)
  queueMicrotask(() => {
    const s = sessions.get(t.id)
    if (s) s.pending = line
    else pendingFor.set(t.id, line)
  })
}

/**
 * A project's run button. Commands that keep running (a dev server) get a terminal of their own,
 * and pressing the button again restarts it; the rest are typed into the project's own terminal.
 */
export function runProjectCommand(project: TerminalProject, command: string): void {
  rememberCommand(command)
  const { terminals } = useTerminals.getState()
  const own = keepsRunning(command)
  const existing = terminals.find((t) => t.projectId === project.id && (own ? t.command === command : !t.command))
  if (existing) {
    setActiveTerminal(existing.id)
    openSpecialTab(TERMINAL_TAB)
    const s = sessions.get(existing.id)
    if (own) {
      if (s) restartTerminal(existing.id)
      return
    }
    if (s?.running) window.api.terminalInput(existing.id, command + '\r')
    else if (s) {
      s.pending = command
      s.term.reset()
      void startShell(s)
    }
    return
  }
  const t = addTerminal({
    name: own ? `${project.name} · ${commandLabel(command).replace(/^(npm|pnpm|yarn|bun) (run )?/, '')}` : project.name,
    folder: project.folder,
    projectId: project.id,
    command: own ? command : undefined
  })
  openSpecialTab(TERMINAL_TAB)
  // The page makes its screen and starts it; the command is typed once it's ready.
  queueMicrotask(() => {
    const s = sessions.get(t.id)
    if (s) {
      if (s.running) window.api.terminalInput(t.id, command + '\r')
      else s.pending = command
    } else pendingFor.set(t.id, command)
  })
}

/** Commands waiting for a terminal whose screen hasn't been made yet (the tab was still opening). */
const pendingFor = new Map<string, string>()
const takePending = (id: string): string | null => {
  const c = pendingFor.get(id)
  pendingFor.delete(id)
  return c ?? null
}

/** Runs a command typed into the Run panel, in the terminal you're looking at. */
export function runInActive(command: string): void {
  const id = useTerminals.getState().active
  const s = id ? sessions.get(id) : undefined
  if (!id || !s) return
  rememberCommand(command)
  if (s.running) window.api.terminalInput(id, command + '\r')
  else {
    s.pending = command
    s.term.reset()
    void startShell(s)
  }
  s.term.focus()
}

/** The projects' run buttons in the command palette ("Eclipse: npm run dev"). Ones with a blank aren't included. */
export function projectCommands(): Command[] {
  return useTerminals.getState().projects.flatMap((p) =>
    p.commands
      .filter((c) => !/\{[^{}]+\}/.test(c))
      .map((c) => ({ id: `terminal.run:${p.id}:${c}`, group: 'Terminal', title: `${p.name}: ${c} (run in the terminal)`, run: () => runProjectCommand(p, c) }))
  )
}
