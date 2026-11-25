import { freeSlots, type Busy } from '@shared/claudeHelpers'
import { countdownsText } from '@shared/claudeFormat'
import { degrees, describeWeather, type Forecast } from '@shared/weather'
import type { CalEvent } from '@shared/types'
import { itemsByDay } from '../../store/noteIndex'
import { usePrefs } from '../../store/prefs'
import { useVault } from '../../store/vault'
import { toItems } from '../../store/externalEvents'
import { ensureMoney, useMoney } from '../../store/money'
import { addDays, dayKey, fromDayKey } from '../dates'
import { editNote, ensureDaily } from '../daily'
import { upcomingReminders } from '../reminderScheduler'
import { reminderTime } from '../reminders'
import { formatPounds } from '../money'
import * as tabs from '../editorController'
import { locked, needNotes, num, str, strs, type Answer, type Args } from './common'

/**
 * Planning for Claude Desktop: opening any page of Orbit, the morning briefing, free time for
 * planning a week, the weather, and reminders.
 */

// ---------- opening a page ----------

const PAGES: Record<string, string> = {
  home: tabs.HOME_TAB,
  calendar: tabs.CALENDAR_TAB,
  music: tabs.MUSIC_TAB,
  money: tabs.MONEY_TAB,
  flashcards: tabs.FLASHCARDS_TAB,
  countdowns: tabs.COUNTDOWNS_TAB,
  'world clocks': tabs.CLOCKS_TAB,
  email: tabs.EMAIL_TAB,
  messages: tabs.MESSAGES_TAB,
  'app studio': tabs.APPSTUDIO_TAB,
  convert: tabs.CONVERT_TAB,
  comics: tabs.COMICS_TAB,
  videos: tabs.VIDEOS_TAB,
  'video player': tabs.VIDEO_TAB,
  games: tabs.GAMES_TAB,
  'mini games': tabs.MINIGAMES_TAB,
  skyblock: tabs.SKYBLOCK_GOALS_TAB,
  'task manager': tabs.TASKS_TAB,
  'volume mixer': tabs.MIXER_TAB,
  files: tabs.EXPLORER_TAB,
  downloads: tabs.DOWNLOADS_TAB,
  screenshots: tabs.SCREENSHOTS_TAB,
  clips: tabs.CLIPS_TAB,
  soundboard: tabs.SOUNDBOARD_TAB,
  macros: tabs.MACROS_TAB,
  discord: tabs.DISCORD_TAB,
  wiki: tabs.WIKI_TAB,
  graph: tabs.GRAPH_TAB,
  timeline: tabs.TIMELINE_TAB,
  terminal: tabs.TERMINAL_TAB,
  'ask ai': tabs.AI_TAB,
  'ai chat': tabs.CHAT_TAB,
  'pdf editor': tabs.PDF_EDITOR_TAB,
  publishing: tabs.PUBLISHING_TAB,
  screens: tabs.SCREENS_TAB,
  studio: tabs.STUDIO_TAB,
  'send files': tabs.FILESENDER_TAB,
  'find and replace': tabs.REPLACE_TAB,
  'add-ons': tabs.ADDONS_TAB,
  uninstaller: tabs.UNINSTALL_TAB,
  'key remapper': tabs.KEYREMAP_TAB,
  web: tabs.WEB_TAB,
  settings: tabs.SETTINGS_TAB
}
export const PAGE_NAMES = Object.keys(PAGES)

function openPageFor(args: Args): string {
  const want = str(args.page).trim().toLowerCase().replace(/ page$/, '')
  const name = PAGE_NAMES.find((p) => p === want) ?? PAGE_NAMES.find((p) => p.replace(/[^a-z]/g, '') === want.replace(/[^a-z]/g, '')) ?? PAGE_NAMES.find((p) => p.includes(want) || want.includes(p))
  if (!name) throw new Error(`Orbit has no page called “${str(args.page)}”. Its pages are: ${PAGE_NAMES.join(', ')}.`)
  tabs.openSpecialTab(PAGES[name])
  return `Opened ${name} in Orbit.`
}

// ---------- weather ----------

async function forecast(): Promise<{ forecast: Forecast | null; place: string; error?: string }> {
  const s = await window.api.weather()
  return { forecast: s.forecast, place: s.place?.name ?? '', error: s.error }
}

function dayWeather(f: Forecast, date: string): string | null {
  const d = f.days.find((x) => x.date === date)
  if (!d) return null
  const hours = f.hours.filter((h) => h.time.startsWith(date) && Number(h.time.slice(11, 13)) % 3 === 0)
  return `${date}: ${describeWeather(d.code).label}, ${degrees(d.min)} to ${degrees(d.max)}, ${d.rain}% chance of rain${hours.length ? `\n  ${hours.map((h) => `${h.time.slice(11, 16)} ${describeWeather(h.code).label.toLowerCase()} ${degrees(h.temp)}${h.rain !== undefined ? ` (${h.rain}% rain)` : ''}`).join(', ')}` : ''}`
}

async function weatherFor(args: Args): Promise<string> {
  const { forecast: f, place, error } = await forecast()
  if (!f) throw new Error(error || 'Orbit has no town set for the weather. The user can set one on the Home page’s weather box.')
  const from = str(args.date) || dayKey(new Date())
  const days = Math.min(14, Math.max(1, num(args.days, str(args.date) ? 1 : 3)))
  const lines: string[] = []
  if (!str(args.date)) lines.push(`Now in ${place}: ${describeWeather(f.current.code).label}, ${degrees(f.current.temp)} (feels like ${degrees(f.current.feels)}), wind ${Math.round(f.current.wind)} km/h`)
  for (let i = 0; i < days; i++) {
    const line = dayWeather(f, dayKey(addDays(fromDayKey(from)!, i)))
    if (line) lines.push(line)
  }
  return lines.length ? lines.join('\n') : 'The forecast doesn’t go that far ahead (it covers the next 14 days).'
}

// ---------- reminders ----------

async function addReminderFor(args: Args): Promise<string> {
  needNotes()
  const text = str(args.text).trim().replace(/\n/g, ' ')
  const time = str(args.time)
  if (!text) throw new Error('Say what to be reminded about.')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('The time has to be a 24-hour time like 18:00.')
  const date = str(args.date) || dayKey(new Date())
  const day = fromDayKey(date)
  if (!day) throw new Error('The date has to be like 2026-11-25.')
  const path = await ensureDaily(day)
  await editNote(path, (t) => `${t.replace(/\s*$/, '')}${t.trim() ? '\n' : ''}- [ ] ${text} ⏰ ${date} ${time}\n`, { undo: 'Claude added a reminder' })
  await useVault.getState().refresh([path])
  return `Orbit will remind them “${text}” at ${time} on ${date} (it’s a task in ${path}; ticking it stops the reminder).`
}

function remindersFor(args: Args): string {
  needNotes()
  const list = upcomingReminders(Math.min(100, num(args.limit, 20))).filter((r) => !locked(r.path))
  return list.length ? list.map((r) => `${r.date} ${r.time}: ${r.title} (${r.path})`).join('\n') : 'No reminders coming up.'
}

// ---------- free time ----------

async function busyBetween(from: string, to: string): Promise<Busy[]> {
  const busy: Busy[] = []
  for (const [, items] of itemsByDay(from, to)) for (const i of items) if (i.start && !locked(i.path)) busy.push({ date: i.date, start: i.start, end: i.end })
  try {
    const start = fromDayKey(from)!
    const { events } = await window.api.fetchCalendarEvents(start.toISOString(), addDays(fromDayKey(to)!, 1).toISOString())
    for (const e of events as CalEvent[]) for (const it of toItems(e)) if (!it.allDay && it.start) busy.push({ date: it.date, start: it.start, end: it.end })
  } catch {
    // No connected calendars: Orbit's own events are still there.
  }
  return busy
}

async function freeTimeFor(args: Args): Promise<string> {
  needNotes()
  const from = str(args.from) || dayKey(new Date())
  const start = fromDayKey(from)
  if (!start) throw new Error('The first day has to be like 2026-11-25.')
  const to = str(args.to) || dayKey(addDays(start, 6))
  const days: string[] = []
  for (let d = start; dayKey(d) <= to && days.length < 31; d = addDays(d, 1)) days.push(dayKey(d))
  const dayStart = /^\d{2}:\d{2}$/.test(str(args.day_start)) ? str(args.day_start) : '09:00'
  const dayEnd = /^\d{2}:\d{2}$/.test(str(args.day_end)) ? str(args.day_end) : '21:00'
  let slots = freeSlots(await busyBetween(from, to), days, dayStart, dayEnd, Math.max(10, num(args.min_minutes, 30)))
  // Today: only what's still to come.
  const nowKey = dayKey(new Date())
  const nowTime = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`
  slots = slots.filter((s) => s.date > nowKey || (s.date === nowKey && s.end > nowTime)).map((s) => (s.date === nowKey && s.start < nowTime ? { ...s, start: nowTime } : s))
  if (!slots.length) return 'No free time in those days.'
  return `Free time (${dayStart}–${dayEnd}):\n${slots.map((s) => `${s.date} ${s.start}–${s.end}`).join('\n')}`
}

// ---------- the morning briefing ----------

/** `run` answers another of Claude's questions (so the briefing uses the same answers). */
export function plannerAnswers(run: (name: string, args: Args) => Promise<string>): Record<string, Answer> {
  const section = async (title: string, make: () => Promise<string> | string): Promise<string> => {
    try {
      return `## ${title}\n${(await make()).trim()}`
    } catch (err) {
      return `## ${title}\n(couldn’t get it: ${err instanceof Error ? err.message : String(err)})`
    }
  }

  const briefing = async (args: Args): Promise<string> => {
    const areas = new Set(strs(args.areas))
    const today = str(args.date) || dayKey(new Date())
    const soon = dayKey(addDays(fromDayKey(today)!, 3))
    const parts: Promise<string>[] = []
    if (areas.has('calendar')) {
      parts.push(section('Today', () => run('get_calendar', { from: today, to: today })))
      parts.push(section('Tasks due in the next few days', () => run('get_due_tasks', { from: today, to: soon })))
      parts.push(section('Reminders', () => remindersFor({ limit: 8 })))
      parts.push(section('Weather', () => weatherFor({ date: today, days: 1 })))
      parts.push(
        section('Countdowns', () =>
          countdownsText(usePrefs.getState().prefs.countdowns, new Date())
            .split('\n')
            .slice(0, 4)
            .join('\n') || 'None.'
        )
      )
    }
    if (areas.has('money'))
      parts.push(
        section('Money this week', async () => {
          await ensureMoney()
          const weekAgo = dayKey(addDays(fromDayKey(today)!, -6))
          const spent = useMoney
            .getState()
            .entries.filter((e) => !e.income && e.date >= weekAgo && e.date <= today)
            .reduce((t, e) => t + e.amount, 0)
          return `Spent ${formatPounds(spent)} in the last 7 days.`
        })
      )
    if (areas.has('music')) parts.push(section('Music', () => run('get_now_playing', {})))
    const all = await Promise.all(parts)
    const next = upcomingReminders(1)[0]
    return `Briefing for ${today}${next ? ` (next reminder ${reminderTime(next).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : ''}\n\n${all.join('\n\n')}`
  }

  return {
    open_page: openPageFor,
    get_weather: weatherFor,
    add_reminder: addReminderFor,
    get_reminders: remindersFor,
    find_free_time: freeTimeFor,
    morning_briefing: briefing
  }
}
