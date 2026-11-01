import type { DeckButton, PhoneScreen } from '@shared/types'
import { usePrefs } from '../store/prefs'
import { usePhone } from '../store/phone'
import { useEditor } from '../store/editor'
import { useTimer } from '../store/focusTimer'
import { getNoteText, itemsByDay, useNoteIndex } from '../store/noteIndex'
import { musicControl } from '../store/music'
import { useMessages } from '../store/messages'
import { featureById } from './features'
import { FEATURE_INFO } from './featureInfo'
import { getOpenText, isNoteTab, noteLockOf } from './editorController'
import { lockAllNow } from './lock/actions'
import { isLockedText } from './lock/crypto'
import { splitFrontmatter } from './ai'
import { noteTitle } from './paths'
import { dayKey } from './dates'
import { notify } from '../store/notify'
import { toggleDiscord } from '../store/discord'

/**
 * Your phone as a Stream Deck and a second screen.
 *   Deck: big buttons that run things on the computer (any feature, plus music and lock).
 *   Screen: today's plan, the note you have open, and the focus timer, kept up to date.
 * Also: a heads-up on the phone when new messages come in (reminders are sent by main/index.ts).
 */

/** Deck buttons that aren't features of their own. */
export const DECK_EXTRAS: { id: string; name: string; icon: string; run: () => void }[] = [
  { id: 'play-pause', name: 'Play / pause', icon: '⏯️', run: () => void musicControl('toggle') },
  { id: 'next-song', name: 'Next song', icon: '⏭️', run: () => void musicControl('next') },
  { id: 'previous-song', name: 'Previous song', icon: '⏮️', run: () => void musicControl('previous') },
  { id: 'discord-mute', name: 'Discord: mute', icon: '🎙️', run: () => void toggleDiscord('mute') },
  { id: 'discord-deafen', name: 'Discord: deafen', icon: '🎧', run: () => void toggleDiscord('deaf') },
  { id: 'lock-all', name: 'Lock notes & passwords', icon: '🔒', run: lockAllNow }
]

const FEATURE_EMOJI: Record<string, string> = {
  home: '🏠',
  today: '📅',
  'new-note': '📝',
  capture: '⚡',
  search: '🔍',
  graph: '🪐',
  random: '🎲',
  reading: '📖',
  calendar: '🗓️',
  clocks: '🌍',
  screens: '🖥️',
  flashcards: '🃏',
  zen: '🌙',
  money: '💷',
  passwords: '🔑',
  email: '✉️',
  messages: '💬',
  phone: '📱',
  web: '🌐',
  chat: '🤖',
  ask: '✨',
  music: '🎵',
  comics: '📚',
  youtube: '📺',
  video: '🎞️',
  games: '🎮',
  sudoku: '🔢',
  minesweeper: '💣',
  snip: '✂️',
  explorer: '🗂️',
  convert: '🔄',
  studio: '🎬',
  clips: '🎞️',
  replay: '⏪',
  soundboard: '🔊',
  'discord-voice': '🎧',
  terminal: '⌨️',
  streamer: '🙈',
  webcam: '📷',
  settings: '⚙️'
}

// Features that are toggles or run in the background: pressing them shouldn't pull Orbit to the front.
const QUIET = new Set(['music', 'reading', 'streamer', 'capture', 'snip', 'youtube', 'phone', 'replay'])

/** Everything that can go on the deck, for Settings. */
export const DECK_CHOICES = [
  ...DECK_EXTRAS.map((x) => ({ id: x.id, name: x.name })),
  ...FEATURE_INFO.filter((f) => f.id !== 'phone' && f.id !== 'webcam').map((f) => ({ id: f.id, name: f.name }))
]

function deckButtons(ids: string[]): DeckButton[] {
  return ids.flatMap((id): DeckButton[] => {
    const extra = DECK_EXTRAS.find((x) => x.id === id)
    if (extra) return [{ id, label: extra.name, icon: extra.icon }]
    const info = FEATURE_INFO.find((f) => f.id === id)
    return info ? [{ id, label: info.name, icon: FEATURE_EMOJI[id] ?? '•', show: !QUIET.has(id) }] : []
  })
}

/** A deck button was pressed on the phone. */
export function runDeck(id: string): void {
  const extra = DECK_EXTRAS.find((x) => x.id === id)
  if (extra) return extra.run()
  const f = featureById(id)
  if (f) f.run()
  else notify('That deck button isn’t in Orbit any more.', 'info')
}

function screen(): PhoneScreen {
  const today = (itemsByDay().get(dayKey(new Date())) ?? [])
    .filter((i) => i.kind !== 'daily')
    .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))
    .slice(0, 20)
    .map((i) => ({ time: i.start ?? '', title: i.title, done: i.done }))
  const { active } = useEditor.getState()
  let note: PhoneScreen['note'] = null
  if (isNoteTab(active)) {
    const text = getOpenText(active) ?? getNoteText(active) ?? ''
    // Locked notes stay on the computer; so does everything in streamer mode.
    if (!noteLockOf(active) && !isLockedText(text) && !usePrefs.getState().prefs.streamerMode) {
      note = { title: noteTitle(active), text: splitFrontmatter(text).body.slice(0, 20000) }
    }
  }
  const t = useTimer.getState()
  const timer = t.phase
    ? { label: t.phase === 'focus' ? `Focus${t.rounds > 1 ? ` ${t.round} of ${t.rounds}` : ''}` : t.phase === 'break' ? 'Break' : 'Long break', endsAt: t.endsAt, left: t.pausedLeft }
    : null
  return { today, note, timer }
}

/** Keeps the phone's Deck and Screen up to date while a phone is connected. Returns a stop function. */
export function startPhoneSync(): () => void {
  let lastDeck = ''
  let lastScreen = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  const connected = (): boolean => usePhone.getState().connected > 0

  const pushDeck = (): void => {
    const buttons = deckButtons(usePrefs.getState().prefs.phoneDeck)
    const json = JSON.stringify(buttons)
    if (json === lastDeck) return
    lastDeck = json
    void window.api.phoneSetDeck(buttons)
  }
  const pushScreen = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!connected()) return
      const s = screen()
      const json = JSON.stringify(s)
      if (json === lastScreen) return
      lastScreen = json
      void window.api.phoneSetScreen(s)
    }, 800)
  }

  pushDeck()
  const offs = [
    usePrefs.subscribe((s, before) => s.prefs.phoneDeck !== before.prefs.phoneDeck && pushDeck()),
    usePhone.subscribe((s, before) => {
      if (s.connected > 0 && before.connected === 0) {
        lastScreen = ''
        pushScreen()
      }
    }),
    useEditor.subscribe(pushScreen),
    useNoteIndex.subscribe(pushScreen),
    useTimer.subscribe((s, before) => (s.phase !== before.phase || s.endsAt !== before.endsAt || s.pausedLeft !== before.pausedLeft) && pushScreen())
  ]
  // New messages: a heads-up on the phone.
  let unread = 0
  const offUnread = watchUnread((count) => {
    if (count > unread && connected()) void window.api.phoneNotify('💬 New messages', `${count} unread in WhatsApp and Discord`)
    unread = count
  })
  // The day changes at midnight, and "now" moves for the plan.
  const minute = setInterval(pushScreen, 60_000)
  return () => {
    offs.forEach((off) => off())
    offUnread()
    clearInterval(minute)
    clearTimeout(timer)
  }
}

/** Calls back with the total unread message count when it changes. */
function watchUnread(cb: (count: number) => void): () => void {
  let last = -1
  const check = (): void => {
    const total = Object.values(useMessages.getState().unread).reduce((n, u) => n + (u?.count ?? 0), 0)
    if (total !== last) {
      last = total
      cb(total)
    }
  }
  check()
  return useMessages.subscribe(check)
}
