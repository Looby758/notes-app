import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useEditor } from '../store/editor'
import { commandForKey } from './commands'
import { TERMINAL_TAB } from './editorController'
import { IS_MAC } from '@shared/platform'

/**
 * The Terminal tab's screen and the command line behind it. There's one, kept here rather than in
 * the page, so switching to another tab (or moving it to another pane) doesn't lose what's on it.
 * Closing the tab ends the command line.
 */

interface Session {
  term: Terminal
  fit: FitAddon
  /** What the terminal draws into; moved into whichever page is showing the tab. */
  el: HTMLDivElement
  /** False once the command line has ended; the next key press starts a new one. */
  running: boolean
  cleanup: (() => void)[]
}

let session: Session | null = null

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

async function startShell(s: Session): Promise<void> {
  s.fit.fit()
  const result = await window.api.terminalStart(s.term.cols, s.term.rows)
  if (session !== s) return
  if (!result.ok) {
    s.term.write(`\x1b[31mThe terminal couldn’t start: ${result.error}\x1b[0m\r\n`)
    return
  }
  s.running = true
  // A command line left running (after the window reloaded) carries on, at this size.
  if (result.resumed) window.api.terminalResize(s.term.cols, s.term.rows)
}

/** Keys pressed in the terminal: which go to the command line, and which to the app. */
function handleKey(term: Terminal, e: KeyboardEvent): boolean {
  if (e.type !== 'keydown') return true
  // Esc belongs to whatever's running (it shouldn't also leave zen mode).
  if (e.key === 'Escape') {
    e.stopPropagation()
    return true
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

function create(host: HTMLElement): Session {
  const el = document.createElement('div')
  el.className = 'terminal-screen'
  host.appendChild(el)
  const term = new Terminal({ fontSize: 13, lineHeight: 1.2, cursorBlink: true, scrollback: 5000, allowProposedApi: false })
  const fit = new FitAddon()
  term.loadAddon(fit)
  applyLook(term)
  term.open(el)
  const s: Session = { term, fit, el, running: false, cleanup: [] }
  term.attachCustomKeyEventHandler((e) => handleKey(term, e))
  term.onData((data) => {
    if (s.running) window.api.terminalInput(data)
    else if (session === s) {
      term.reset()
      void startShell(s)
    }
  })
  term.onResize(({ cols, rows }) => {
    if (s.running) window.api.terminalResize(cols, rows)
  })
  s.cleanup.push(
    window.api.onTerminalData((data) => term.write(data)),
    window.api.onTerminalExit(() => {
      s.running = false
      term.write('\r\n\x1b[2mThe command line has ended. Press any key to start a new one.\x1b[0m\r\n')
    })
  )
  // Follow theme and font changes from Settings.
  const watcher = new MutationObserver(() => applyLook(term))
  watcher.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
  watcher.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  s.cleanup.push(() => watcher.disconnect())
  // Closing the tab (in any pane) ends the command line.
  s.cleanup.push(
    useEditor.subscribe((state) => {
      if (!Object.values(state.panes).some((p) => p.tabs.includes(TERMINAL_TAB))) endSession()
    })
  )
  return s
}

function endSession(): void {
  const s = session
  if (!s) return
  session = null
  for (const fn of s.cleanup) fn()
  s.term.dispose()
  s.el.remove()
  void window.api.terminalStop()
}

/** Shows the terminal in a page (starting the command line the first time); returns a function that takes it out again. */
export function attachTerminal(host: HTMLElement): () => void {
  let s = session
  if (s) host.appendChild(s.el)
  else {
    s = session = create(host)
    void startShell(s)
  }
  const current = s
  const refit = (): void => {
    // Not while hidden: a zero size would squash the screen to almost nothing.
    if (host.clientWidth > 0 && host.clientHeight > 0) current.fit.fit()
  }
  const sizes = new ResizeObserver(refit)
  sizes.observe(host)
  refit()
  current.term.focus()
  return () => {
    sizes.disconnect()
    if (current.el.parentElement === host) current.el.remove()
  }
}

export function focusTerminal(): void {
  session?.term.focus()
}
