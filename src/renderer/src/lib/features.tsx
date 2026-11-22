import { useSyncExternalStore, type ComponentType } from 'react'
import type { Prefs } from '@shared/prefs'
import {
  Send,
  Ear,
  ArrowRightLeft,
  FilePen,
  AudioLines,
  Clapperboard,
  Cpu,
  Joystick,
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
  Hourglass,
  Upload,
  HardDrive,
  House,
  KeyRound,
  Keyboard,
  Repeat2,
  Layers,
  Images,
  Clock,
  LibraryBig,
  Library,
  Mail,
  MessageSquare,
  MessagesSquare,
  Monitor,
  SlidersVertical,
  Activity,
  MonitorPlay,
  MonitorUp,
  MousePointerClick,
  Moon,
  Music,
  Music2,
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
  Crop,
  Bot,
  Asterisk,
  Video,
  Hammer,
  ArrowDownToLine,
  Target,
  type LucideIcon
} from 'lucide-react'
import { openGrokTab } from '../components/Grok/GrokPage'
import { openSiteTab } from '../components/ChatSite/ChatSite'
import { useChatSites, useGrok } from '../store/grok'
import { openMiniGames } from '../store/miniGames'
import { useVault } from '../store/vault'
import { setPrefs, usePrefs } from '../store/prefs'
import { showSearch, toggleZen, useUI } from '../store/ui'
import { toggleStreamerMode } from '../store/streamer'
import { toggleMusic, useMusic } from '../store/music'
import { showAndFindSong, useSongId } from '../store/songId'
import { sendToPhone, usePhone } from '../store/phone'
import { openAsk } from '../store/ai'
import { openToday } from './daily'
import { openRandomNote } from './random'
import { startSnip } from './snip'
import {
  CALENDAR_TAB,
  CHAT_TAB,
  COMICS_TAB,
  WIKI_TAB,
  CONVERT_TAB,
  FILESENDER_TAB,
  PDF_EDITOR_TAB,
  STUDIO_TAB,
  APPSTUDIO_TAB,
  CLIPS_TAB,
  VIDEOS_TAB,
  SOUNDBOARD_TAB,
  MACROS_TAB,
  KEYREMAP_TAB,
  DISCORD_TAB,
  EMAIL_TAB,
  EXPLORER_TAB,
  FLASHCARDS_TAB,
  SCREENSHOTS_TAB,
  TIMELINE_TAB,
  GAMES_TAB,
  VIDEO_TAB,
  GRAPH_TAB,
  HOME_TAB,
  MESSAGES_TAB,
  CLOCKS_TAB,
  COUNTDOWNS_TAB,
  SKYBLOCK_GOALS_TAB,
  PUBLISHING_TAB,
  SCREENS_TAB,
  MIXER_TAB,
  TASKS_TAB,
  MUSIC_TAB,
  DOWNLOADS_TAB,
  MONEY_TAB,
  PASSWORDS_TAB,
  SETTINGS_TAB,
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

/** Second screen / control the Mac: starts it (or stops it if it's on); without the other computer connected, opens its settings. */
async function screenFeature(mode: 'extend' | 'control'): Promise<void> {
  const status = await window.api.screenStatus()
  if (status.session) {
    await window.api.screenStop()
    if (status.session.mode === mode) return
  }
  if (!status.available) {
    openSpecialTab(SETTINGS_TAB)
    useUI.setState({ settingsSection: 'computers' })
    return
  }
  await window.api.screenStart(mode).catch(() => {
    openSpecialTab(SETTINGS_TAB)
    useUI.setState({ settingsSection: 'computers' })
  })
}

let screenMode: 'extend' | 'control' | null = null
const screenWatchers = new Set<() => void>()
let screenWatching = false
/** Which screen session is on (for lighting up the button). */
function useScreenSession(): 'extend' | 'control' | null {
  return useSyncExternalStore(
    (changed) => {
      screenWatchers.add(changed)
      if (!screenWatching) {
        screenWatching = true
        const set = (s: { session: { mode: 'extend' | 'control' } | null }): void => {
          screenMode = s.session?.mode ?? null
          for (const fn of screenWatchers) fn()
        }
        void window.api.screenStatus().then(set)
        window.api.onScreenStatus(set)
      }
      return () => screenWatchers.delete(changed)
    },
    () => screenMode
  )
}

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
  countdowns: { icon: Hourglass, run: () => openSpecialTab(COUNTDOWNS_TAB) },
  publishing: { icon: Upload, run: () => openSpecialTab(PUBLISHING_TAB) },
  screens: { icon: Monitor, run: () => openSpecialTab(SCREENS_TAB) },
  mixer: { icon: SlidersVertical, run: () => openSpecialTab(MIXER_TAB) },
  tasks: { icon: Activity, run: () => openSpecialTab(TASKS_TAB) },
  screenshots: { icon: Images, run: () => openSpecialTab(SCREENSHOTS_TAB) },
  timeline: { icon: Clock, run: () => openSpecialTab(TIMELINE_TAB) },
  flashcards: { icon: Layers, run: () => openSpecialTab(FLASHCARDS_TAB), badge: () => <FeatureBadge id="flashcards" /> },
  zen: { icon: Moon, run: () => toggleZen() },
  money: { icon: PoundSterling, run: () => openSpecialTab(MONEY_TAB) },
  passwords: { icon: KeyRound, run: () => openSpecialTab(PASSWORDS_TAB) },
  email: { icon: Mail, run: () => openSpecialTab(EMAIL_TAB) },
  messages: { icon: MessagesSquare, run: () => openSpecialTab(MESSAGES_TAB), badge: () => <FeatureBadge id="messages" /> },
  phone: { icon: Smartphone, run: () => sendToPhone({ kind: 'pair' }), useActive: () => usePhone((s) => s.connected > 0) },
  'second-screen': {
    icon: MonitorUp,
    run: () => void screenFeature('extend'),
    useActive: () => useScreenSession() === 'extend'
  },
  'control-mac': {
    icon: MousePointerClick,
    run: () => void screenFeature('control'),
    useActive: () => useScreenSession() === 'control'
  },
  webcam: { icon: Webcam, run: () => sendToPhone({ kind: 'webcam' }), useActive: () => usePhone((s) => !!s.cam?.on) },
  web: { icon: Globe, run: () => openWebTab('', { beside: true }) },
  chat: { icon: MessageSquare, run: () => openSpecialTab(CHAT_TAB) },
  grok: { icon: Bot, run: openGrokTab, useActive: () => useGrok((s) => s.floating) },
  claude: { icon: Asterisk, run: () => openSiteTab('claude'), useActive: () => useChatSites((s) => s.claude.floating) },
  ask: { icon: Sparkles, run: () => openAsk() },
  music: { icon: Music, run: toggleMusic, useActive: () => useMusic((s) => s.open) },
  musiclibrary: { icon: Music2, run: () => openSpecialTab(MUSIC_TAB) },
  songid: { icon: Ear, run: showAndFindSong, useActive: () => useSongId((s) => s.phase === 'listening' || s.phase === 'thinking') },
  video: { icon: Film, run: () => openSpecialTab(VIDEO_TAB) },
  comics: { icon: LibraryBig, run: () => openSpecialTab(COMICS_TAB) },
  wiki: { icon: Library, run: () => openSpecialTab(WIKI_TAB) },
  youtube: { icon: MonitorPlay, run: () => void window.api.openYouTube() },
  games: { icon: Gamepad2, run: () => openSpecialTab(GAMES_TAB) },
  'skyblock-goals': { icon: Target, run: () => openSpecialTab(SKYBLOCK_GOALS_TAB) },
  'mini-games': { icon: Joystick, run: () => openMiniGames(null) },
  snip: { icon: Scan, run: () => void startSnip() },
  'snip-picture': { icon: Crop, run: () => void startSnip('picture') },
  explorer: { icon: HardDrive, run: () => openSpecialTab(EXPLORER_TAB) },
  convert: { icon: ArrowRightLeft, run: () => openSpecialTab(CONVERT_TAB) },
  filesender: { icon: Send, run: () => openSpecialTab(FILESENDER_TAB) },
  'pdf-editor': { icon: FilePen, run: () => openSpecialTab(PDF_EDITOR_TAB) },
  downloads: { icon: ArrowDownToLine, run: () => openSpecialTab(DOWNLOADS_TAB) },
  'offline-ai': {
    icon: Cpu,
    run: () => {
      openSpecialTab(SETTINGS_TAB)
      useUI.setState({ settingsSection: 'ai' })
    }
  },
  studio: { icon: Clapperboard, run: () => openSpecialTab(STUDIO_TAB) },
  appstudio: { icon: Hammer, run: () => openSpecialTab(APPSTUDIO_TAB) },
  clips: { icon: Scissors, run: () => openSpecialTab(CLIPS_TAB) },
  videos: { icon: Video, run: () => openSpecialTab(VIDEOS_TAB) },
  replay: { icon: History, run: () => void import('./replay').then((m) => m.saveReplay()), useActive: () => usePrefs((s) => s.prefs.replayOn) },
  soundboard: { icon: AudioLines, run: () => openSpecialTab(SOUNDBOARD_TAB) },
  'discord-voice': { icon: Headphones, run: () => openSpecialTab(DISCORD_TAB) },
  terminal: { icon: SquareTerminal, run: () => openSpecialTab(TERMINAL_TAB) },
  macros: { icon: Keyboard, run: () => openSpecialTab(MACROS_TAB) },
  keyremap: { icon: Repeat2, run: () => openSpecialTab(KEYREMAP_TAB) },
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
