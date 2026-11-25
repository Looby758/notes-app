import { allThemes, getTheme } from '@shared/themes'
import { isHexColour, themeColours } from '@shared/claudeHelpers'
import { setPrefs, usePrefs } from '../../store/prefs'
import { removeTheme, useThemes } from '../../store/themes'
import { addMinutes, formatClock, pauseTimer, phaseLabel, resumeTimer, secondsLeft, startTimer, stop, useTimer } from '../../store/focusTimer'
import { setQuiet } from '../../store/quiet'
import { toggleZen, useUI } from '../../store/ui'
import { arrangeHome, homeCards, moveId } from '../home'
import { homeBoxOn } from '../addons'
import { num, pickOne, str, strs, type Answer, type Args } from './common'

/** How Orbit looks and feels for Claude Desktop: the Home page, themes, and focus mode. */

// ---------- Home ----------

const BUILT_IN = [
  { id: 'today', order: 10, title: 'Today' },
  { id: 'weather', order: 20, title: 'Weather' },
  { id: 'flashcards', order: 30, title: 'Flashcards' },
  { id: 'recent', order: 40, title: 'Recent notes' }
]

function boxes(): { id: string; title: string }[] {
  const all = [...BUILT_IN, ...homeCards().map(({ id, order, title }) => ({ id, order, title }))].filter((b) => homeBoxOn(b.id)).sort((a, b) => a.order - b.order)
  return arrangeHome(all, usePrefs.getState().prefs.homeOrder)
}

function homeFor(): string {
  const hidden = new Set(usePrefs.getState().prefs.homeHidden)
  return boxes()
    .map((b, i) => `${i + 1}. ${b.title}${hidden.has(b.id) ? ' (hidden)' : ''}`)
    .join('\n')
}

function arrangeHomeFor(args: Args): string {
  const all = boxes()
  const box = (want: string): { id: string; title: string } => pickOne(all, want, (b) => b.title, 'Home box')
  let ids = all.map((b) => b.id)
  const order = strs(args.order)
  if (order.length) {
    const first = order.map((o) => box(o).id)
    ids = [...first, ...ids.filter((id) => !first.includes(id))]
  }
  if (str(args.move) && typeof args.to === 'number') ids = moveId(ids, box(str(args.move)).id, Math.max(0, Math.round(args.to) - 1))
  let hidden = usePrefs.getState().prefs.homeHidden
  for (const h of strs(args.hide)) hidden = [...new Set([...hidden, box(h).id])]
  for (const s of strs(args.show)) hidden = hidden.filter((x) => x !== box(s).id)
  if (args.reset === true) {
    setPrefs({ homeOrder: [], homeHidden: [] })
    return `Put Home back to normal.\n${homeFor()}`
  }
  setPrefs({ homeOrder: ids, homeHidden: hidden })
  return `Home now:\n${homeFor()}`
}

// ---------- themes ----------

function themesFor(): string {
  const p = usePrefs.getState().prefs
  return allThemes()
    .map((t) => `${t.name}${t.light ? ' (light)' : ' (dark)'}${t.pack ? ', imported' : ''}${t.id === p.theme ? ' ← on now' : ''}`)
    .concat(`Accent: ${p.accent || 'the theme’s own'}. Follows the system’s light/dark: ${p.followSystem ? 'yes' : 'no'}.`)
    .join('\n')
}

function setThemeFor(args: Args): string {
  const patch: Parameters<typeof setPrefs>[0] = {}
  if (str(args.theme)) {
    const t = pickOne(allThemes(), str(args.theme), (x) => x.name, 'theme')
    patch.theme = t.id
    patch.followSystem = false
  }
  if (has(args.accent)) {
    const a = str(args.accent)
    if (a && !isHexColour(a)) throw new Error('The accent has to be a colour like #8b5cf6, or empty for the theme’s own.')
    patch.accent = a.toLowerCase()
  }
  if (typeof args.follow_system === 'boolean') patch.followSystem = args.follow_system
  if (!Object.keys(patch).length) throw new Error('Say which theme, accent colour or follow_system.')
  setPrefs(patch)
  return `Done. ${getTheme(usePrefs.getState().prefs.theme).name} is on${patch.accent ? `, with the accent ${patch.accent}` : ''}.`
}
const has = (v: unknown): boolean => v !== undefined && v !== null

async function makeThemeFor(args: Args): Promise<string> {
  const name = str(args.name).trim().slice(0, 60)
  if (!name) throw new Error('Name the theme.')
  const base = str(args.colour)
  if (!isHexColour(base)) throw new Error('The colour has to be like #3b1d6e.')
  const light = args.light === true
  const accent = isHexColour(args.accent) ? (args.accent as string) : base
  const manifest = {
    id: name,
    name,
    author: 'Claude',
    light,
    accent,
    colors: themeColours(base, light),
    pictureStrength: typeof args.picture_strength === 'number' ? Math.min(0.6, Math.max(0.03, args.picture_strength)) : 0.2
  }
  const theme = await window.api.makeTheme(manifest, str(args.picture) || undefined)
  useThemes.setState({ themes: await window.api.listThemes() })
  setPrefs({ theme: theme.id, followSystem: false, accent: '' })
  return `Made the theme “${theme.name}” and switched to it${theme.pack?.pictures.all ? ', with the picture behind every page' : ''}. It can be removed with remove_theme, or changed in Settings → Appearance.`
}

async function removeThemeFor(args: Args): Promise<string> {
  const t = pickOne(
    allThemes().filter((x) => x.pack || x.id.startsWith('imported-')),
    str(args.theme),
    (x) => x.name,
    'imported theme'
  )
  await removeTheme(t.id)
  return `Removed the theme ${t.name}.`
}

// ---------- focus mode ----------

const FOCUS = 'claude-focus'

/** `run` answers another of Claude's questions (play_music). */
export function lookAnswers(run: (name: string, args: Args) => Promise<string>): Record<string, Answer> {
  const startFocusFor = async (args: Args): Promise<string> => {
    const minutes = Math.min(240, Math.max(1, num(args.minutes, usePrefs.getState().prefs.focusMinutes)))
    const rounds = Math.min(12, Math.max(1, num(args.rounds, 1)))
    startTimer(minutes, rounds)
    const said = [`Focus timer on: ${minutes} minutes${rounds > 1 ? `, ${rounds} rounds with breaks` : ''}.`]
    if (args.quiet !== false) {
      setQuiet(FOCUS, true)
      said.push('Orbit’s pop-ups and reminders wait until it’s over.')
    }
    if (args.zen === true && !useUI.getState().zen) {
      toggleZen()
      said.push('Zen mode is on.')
    }
    if (str(args.playlist) || str(args.search)) said.push(await run('play_music', { playlist: str(args.playlist) || undefined, search: str(args.playlist) ? undefined : str(args.search), shuffle: true }))
    // Pop-ups come back when the timer ends.
    const unsub = useTimer.subscribe((s) => {
      if (s.phase === null) {
        setQuiet(FOCUS, false)
        unsub()
      }
    })
    return said.join(' ')
  }

  const focusFor = (args: Args): string => {
    const action = str(args.action) || 'status'
    const s = useTimer.getState()
    if (action === 'stop') {
      stop()
      setQuiet(FOCUS, false)
      if (useUI.getState().zen) toggleZen()
      return 'Stopped the focus timer.'
    }
    if (!s.phase) return 'The focus timer isn’t running.'
    if (action === 'pause') pauseTimer()
    else if (action === 'resume') resumeTimer()
    else if (action === 'add') addMinutes(Math.round(num(args.minutes, 5)))
    const now = useTimer.getState()
    return `${phaseLabel(now.phase!, now.round, now.rounds)}: ${formatClock(secondsLeft({ ...now, now: Date.now() }))} left${now.pausedLeft !== null ? ' (paused)' : ''}.`
  }

  return {
    get_home_page: homeFor,
    arrange_home_page: arrangeHomeFor,
    list_themes: themesFor,
    set_theme: setThemeFor,
    make_theme: makeThemeFor,
    remove_theme: removeThemeFor,
    start_focus: startFocusFor,
    focus_timer: focusFor
  }
}
