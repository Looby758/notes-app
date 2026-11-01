import type { ComponentType } from 'react'
import type { Prefs } from '@shared/prefs'
import {
  ArrowRightLeft,
  AudioLines,
  Clapperboard,
  Cpu,
  Bomb,
  BookOpen,
  CalendarDays,
  CalendarCheck,
  Dices,
  Eye,
  Film,
  FilePlus,
  Gamepad2,
  Globe,
  Globe2,
  Grid3x3,
  HardDrive,
  House,
  KeyRound,
  Layers,
  LibraryBig,
  Mail,
  MessageSquare,
  MessagesSquare,
  Monitor,
  MonitorPlay,
  Moon,
  Music,
  Orbit,
  PoundSterling,
  Scan,
  Search,
  Settings,
  Smartphone,
  Sparkles,
  SquareTerminal,
  Webcam,
  Zap,
  Headphones,
  History,
  Scissors,
  type LucideIcon
} from 'lucide-react'
import { useVault } from '../store/vault'
import { setPrefs, usePrefs } from '../store/prefs'
import { showSearch, toggleZen, useUI } from '../store/ui'
import { toggleStreamerMode } from '../store/streamer'
import { toggleMusic, useMusic } from '../store/music'
import { sendToPhone, usePhone } from '../store/phone'
import { openAsk } from '../store/ai'
import { openToday } from './daily'
import { openRandomNote } from './random'
import { startSnip } from './snip'
import {
  CALENDAR_TAB,
  CHAT_TAB,
  COMICS_TAB,
  CONVERT_TAB,
  STUDIO_TAB,
  CLIPS_TAB,
  SOUNDBOARD_TAB,
  DISCORD_TAB,
  EMAIL_TAB,
  EXPLORER_TAB,
  FLASHCARDS_TAB,
  GAMES_TAB,
  VIDEO_TAB,
  GRAPH_TAB,
  HOME_TAB,
  MESSAGES_TAB,
  MINESWEEPER_TAB,
  CLOCKS_TAB,
  SCREENS_TAB,
  MONEY_TAB,
  PASSWORDS_TAB,
  SETTINGS_TAB,
  SUDOKU_TAB,
  TERMINAL_TAB,
  openSpecialTab,
  openWebTab
} from './editorController'
import { FeatureBadge } from '../components/Nav/badges'
import { FEATURE_INFO, type FeatureInfo } from './featureInfo'

/**
 * Every feature of the app in one list, so the top bar, the dock, the radial menu and the
 * launcher all show the same things. Which ones go where is up to you (Settings → Finding features).
 */

export { FEATURE_GROUPS, type FeatureGroup } from './featureInfo'

interface Behaviour {
  icon: LucideIcon
  run: () => void
  /** For toggles: whether it's on right now (a hook, called while drawing). */
  useActive?: () => boolean
  /** An unread count or dot drawn on the icon. */
  badge?: ComponentType
}

export type Feature = FeatureInfo & Behaviour

const BEHAVIOUR: Record<string, Behaviour> = {
  home: { icon: House, run: () => openSpecialTab(HOME_TAB) },
  today: { icon: CalendarCheck, run: () => void openToday() },
  'new-note': { icon: FilePlus, run: () => void useVault.getState().newNote() },
  capture: { icon: Zap, run: () => void window.api.openCapture() },
  search: { icon: Search, run: () => showSearch() },
  graph: { icon: Orbit, run: () => openSpecialTab(GRAPH_TAB) },
  random: { icon: Dices, run: () => openRandomNote() },
  reading: {
    icon: BookOpen,
    run: () => setPrefs({ readingMode: !usePrefs.getState().prefs.readingMode }),
    useActive: () => usePrefs((s) => s.prefs.readingMode)
  },
  calendar: { icon: CalendarDays, run: () => openSpecialTab(CALENDAR_TAB) },
  clocks: { icon: Globe2, run: () => openSpecialTab(CLOCKS_TAB) },
  screens: { icon: Monitor, run: () => openSpecialTab(SCREENS_TAB) },
  flashcards: { icon: Layers, run: () => openSpecialTab(FLASHCARDS_TAB), badge: () => <FeatureBadge id="flashcards" /> },
  zen: { icon: Moon, run: () => toggleZen() },
  money: { icon: PoundSterling, run: () => openSpecialTab(MONEY_TAB) },
  passwords: { icon: KeyRound, run: () => openSpecialTab(PASSWORDS_TAB) },
  email: { icon: Mail, run: () => openSpecialTab(EMAIL_TAB) },
  messages: { icon: MessagesSquare, run: () => openSpecialTab(MESSAGES_TAB), badge: () => <FeatureBadge id="messages" /> },
  phone: { icon: Smartphone, run: () => sendToPhone({ kind: 'pair' }), useActive: () => usePhone((s) => s.connected > 0) },
  webcam: { icon: Webcam, run: () => sendToPhone({ kind: 'webcam' }), useActive: () => usePhone((s) => !!s.cam?.on) },
  web: { icon: Globe, run: () => openWebTab('', { beside: true }) },
  chat: { icon: MessageSquare, run: () => openSpecialTab(CHAT_TAB) },
  ask: { icon: Sparkles, run: () => openAsk() },
  music: { icon: Music, run: toggleMusic, useActive: () => useMusic((s) => s.open) },
  video: { icon: Film, run: () => openSpecialTab(VIDEO_TAB) },
  comics: { icon: LibraryBig, run: () => openSpecialTab(COMICS_TAB) },
  youtube: { icon: MonitorPlay, run: () => void window.api.openYouTube() },
  games: { icon: Gamepad2, run: () => openSpecialTab(GAMES_TAB) },
  sudoku: { icon: Grid3x3, run: () => openSpecialTab(SUDOKU_TAB) },
  minesweeper: { icon: Bomb, run: () => openSpecialTab(MINESWEEPER_TAB) },
  snip: { icon: Scan, run: () => void startSnip() },
  explorer: { icon: HardDrive, run: () => openSpecialTab(EXPLORER_TAB) },
  convert: { icon: ArrowRightLeft, run: () => openSpecialTab(CONVERT_TAB) },
  'offline-ai': {
    icon: Cpu,
    run: () => {
      openSpecialTab(SETTINGS_TAB)
      useUI.setState({ settingsSection: 'ai' })
    }
  },
  studio: { icon: Clapperboard, run: () => openSpecialTab(STUDIO_TAB) },
  clips: { icon: Scissors, run: () => openSpecialTab(CLIPS_TAB) },
  replay: { icon: History, run: () => void import('./replay').then((m) => m.saveReplay()), useActive: () => usePrefs((s) => s.prefs.replayOn) },
  soundboard: { icon: AudioLines, run: () => openSpecialTab(SOUNDBOARD_TAB) },
  'discord-voice': { icon: Headphones, run: () => openSpecialTab(DISCORD_TAB) },
  terminal: { icon: SquareTerminal, run: () => openSpecialTab(TERMINAL_TAB) },
  streamer: { icon: Eye, run: toggleStreamerMode, useActive: () => usePrefs((s) => s.prefs.streamerMode) },
  settings: { icon: Settings, run: () => openSpecialTab(SETTINGS_TAB) }
}

export const FEATURES: Feature[] = FEATURE_INFO.map((info) => ({ ...info, ...BEHAVIOUR[info.id] }))

const BY_ID = new Map(FEATURES.map((f) => [f.id, f]))

export const featureById = (id: string): Feature | undefined => BY_ID.get(id)

/** The features for a list of ids from settings, skipping any that no longer exist. */
export const featuresFor = (ids: readonly string[]): Feature[] => ids.map((id) => BY_ID.get(id)).filter((f): f is Feature => !!f)

/** Opens the launcher (every feature, grouped, type to filter). */
export const openLauncher = (): void => useUI.setState({ launcherOpen: true })

export type FeaturePlace = 'topbarFeatures' | 'dockFeatures' | 'radialFeatures' | 'phoneDeck'

/** Adds a feature to (or takes it off) the top bar, the dock or the radial menu. */
export function toggleFeatureIn(place: FeaturePlace, id: string): void {
  const list = usePrefs.getState().prefs[place]
  setPrefs({ [place]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] } as Partial<Prefs>)
}

/** Moves a feature within a list (drag to reorder). */
export function moveFeature(place: FeaturePlace, id: string, to: number): void {
  const list = usePrefs.getState().prefs[place].filter((x) => x !== id)
  list.splice(Math.max(0, Math.min(to, list.length)), 0, id)
  setPrefs({ [place]: list } as Partial<Prefs>)
}
