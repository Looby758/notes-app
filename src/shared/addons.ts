/**
 * Which parts of Orbit everyone gets, and which are add-ons you choose to add.
 *
 * This is the plan for the add-on store: core features are always there, and every add-on will
 * become its own download that's only on your computer once you add it. For now every add-on is
 * still built in, and `installedAddons` in settings starts with all of them, so nothing changes yet.
 *
 * The core list comes from Looby's picks (23 Nov 2026). Feature ids match lib/featureInfo.ts.
 */

/** Features every Orbit has. They're never add-ons. */
export const CORE_FEATURES = ['home', 'today', 'new-note', 'search', 'reading', 'todo', 'settings'] as const

export interface AddonInfo {
  /** Stable id, saved in settings. */
  id: string
  name: string
  /** The features (lib/featureInfo.ts ids) this add-on brings. Some add-ons, like Weather, are parts of a page rather than a feature of their own. */
  features: string[]
  /** Other add-ons this one can't work without. Adding this one adds them too. */
  needs?: string[]
  /**
   * Behind-the-scenes tools other add-ons share (like the video tools). They aren't shown in the
   * store: they come along with whatever needs them, and go when nothing does.
   */
  helper?: boolean
}

export const ADDONS: AddonInfo[] = [
  // Shared tools
  { id: 'video-tools', name: 'Video tools', features: [], helper: true },
  { id: 'link-tools', name: 'Download from a link', features: [], needs: ['video-tools'], helper: true },

  // Notes
  { id: 'summon-bar', name: 'Summon bar', features: ['capture'] },
  { id: 'graph', name: 'Graph', features: ['graph'] },
  { id: 'random-note', name: 'Random note', features: ['random'] },
  { id: 'canvas-board', name: 'Canvas boards', features: [] },
  { id: 'mind-map', name: 'Mind maps', features: [] },
  { id: 'sketch', name: 'Sketching and handwriting', features: [] },

  // Plan
  { id: 'calendar', name: 'Calendar', features: ['calendar'] },
  { id: 'weather', name: 'Weather', features: [] },
  { id: 'video-projects', name: 'Video projects', features: ['videos', 'publishing'] },
  { id: 'countdowns', name: 'Countdowns', features: ['countdowns'] },
  { id: 'clocks', name: 'World clocks', features: ['clocks'] },
  { id: 'screenshots', name: 'Screenshots', features: ['screenshots'] },
  { id: 'timeline', name: 'Timeline', features: ['timeline'], needs: ['screenshots'] },
  { id: 'flashcards', name: 'Flashcards', features: ['flashcards'] },
  { id: 'zen', name: 'Zen & focus timer', features: ['zen'] },

  // Money
  { id: 'money', name: 'Money', features: ['money'] },
  { id: 'passwords', name: 'Passwords', features: ['passwords'] },

  // Connect
  { id: 'email', name: 'Email', features: ['email'] },
  { id: 'discord-voice', name: 'Discord voice', features: ['discord-voice'] },
  { id: 'messages', name: 'Messages', features: ['messages'] },
  { id: 'phone', name: 'Phone', features: ['phone', 'webcam'] },
  { id: 'second-screen', name: 'Second screen and control the Mac', features: ['second-screen', 'control-mac'] },
  { id: 'web', name: 'Web browser', features: ['web'] },
  { id: 'claude', name: 'Claude', features: ['claude'] },
  { id: 'grok', name: 'Grok', features: ['grok'] },
  { id: 'ai-chat', name: 'AI chat', features: ['chat'] },
  { id: 'ask', name: 'Ask everything', features: ['ask'] },

  // Media
  { id: 'music', name: 'Music', features: ['musiclibrary', 'music'], needs: ['link-tools'] },
  { id: 'songid', name: 'What’s this song?', features: ['songid'], needs: ['music'] },
  { id: 'video-player', name: 'Video player', features: ['video'], needs: ['video-tools'] },
  { id: 'comics', name: 'Comics', features: ['comics'] },
  { id: 'wiki', name: 'Wikis', features: ['wiki'] },
  { id: 'soundboard', name: 'Soundboard', features: ['soundboard'], needs: ['link-tools'] },

  // Play
  { id: 'games', name: 'Games', features: ['games'] },
  { id: 'skyblock', name: 'SkyBlock', features: ['skyblock-goals'] },
  { id: 'mini-games', name: 'Mini games', features: ['mini-games'] },

  // Tools
  { id: 'snip', name: 'Screen snip', features: ['snip', 'snip-picture'] },
  { id: 'task-manager', name: 'Task manager', features: ['tasks'] },
  { id: 'mixer', name: 'Volume mixer', features: ['mixer'] },
  { id: 'screens', name: 'Screens', features: ['screens'] },
  { id: 'files', name: 'Files', features: ['explorer'] },
  { id: 'pdf-editor', name: 'PDF editor', features: ['pdf-editor'] },
  { id: 'convert', name: 'Convert files', features: ['convert'], needs: ['video-tools'] },
  { id: 'filesender', name: 'Big file sender', features: ['filesender'] },
  { id: 'downloads', name: 'Downloads', features: ['downloads'], needs: ['link-tools'] },
  { id: 'clips', name: 'Clips', features: ['clips', 'replay'], needs: ['video-tools'] },
  { id: 'offline-ai', name: 'Offline AI', features: ['offline-ai'] },
  { id: 'terminal', name: 'Terminal', features: ['terminal'] },
  { id: 'appstudio', name: 'App Studio', features: ['appstudio'], needs: ['terminal'] },
  { id: 'studio', name: 'Studio', features: ['studio'], needs: ['video-tools'] },
  { id: 'macros', name: 'Macros', features: ['macros'] },
  { id: 'keyremap', name: 'Key remapper', features: ['keyremap'] },
  { id: 'streamer', name: 'Streamer mode', features: ['streamer'] }
]

export const ADDON_IDS: string[] = ADDONS.map((a) => a.id)

const BY_ID = new Map(ADDONS.map((a) => [a.id, a]))
const ADDON_OF_FEATURE = new Map(ADDONS.flatMap((a) => a.features.map((f) => [f, a.id] as const)))
const CORE = new Set<string>(CORE_FEATURES)

export const addonById = (id: string): AddonInfo | undefined => BY_ID.get(id)

/** The add-on a feature comes in, or null for a core feature (or one Orbit doesn't know). */
export const addonOfFeature = (featureId: string): string | null => ADDON_OF_FEATURE.get(featureId) ?? null

export const isCoreFeature = (featureId: string): boolean => CORE.has(featureId)

/** Whether a feature is on this computer: core features always are, others when their add-on is added. */
export function hasFeature(featureId: string, installed: readonly string[]): boolean {
  if (CORE.has(featureId)) return true
  const addon = ADDON_OF_FEATURE.get(featureId)
  return !!addon && installed.includes(addon)
}

/** The add-ons given, plus everything they need, in the store's order. */
export function withNeeds(ids: readonly string[]): string[] {
  const out = new Set<string>()
  const add = (id: string): void => {
    const addon = BY_ID.get(id)
    if (!addon || out.has(id)) return
    out.add(id)
    for (const n of addon.needs ?? []) add(n)
  }
  for (const id of ids) add(id)
  return ADDON_IDS.filter((id) => out.has(id))
}

/** The added add-ons that can't work without this one, for "Removing this also removes…". */
export function neededBy(id: string, installed: readonly string[]): string[] {
  const out = new Set<string>()
  const walk = (target: string): void => {
    for (const a of ADDONS) {
      if (!out.has(a.id) && installed.includes(a.id) && a.needs?.includes(target)) {
        out.add(a.id)
        walk(a.id)
      }
    }
  }
  walk(id)
  return ADDON_IDS.filter((x) => out.has(x))
}

/** Adds an add-on and what it needs. */
export const addAddon = (installed: readonly string[], id: string): string[] => withNeeds([...installed, id])

/**
 * Removes an add-on, the add-ons that need it, and any shared tools nothing needs any more.
 */
export function removeAddon(installed: readonly string[], id: string): string[] {
  const gone = new Set([id, ...neededBy(id, installed)])
  const kept = installed.filter((x) => !gone.has(x) && !BY_ID.get(x)?.helper)
  return withNeeds(kept)
}

/**
 * Cleans the saved list: known ids only, each once, with what they need. Missing means everything
 * (Orbit from before add-ons). `seen` is every add-on Orbit knew about when the list was saved:
 * an add-on that's newer than that (Orbit gained it in an update) is added, so updating never
 * takes away something you had built in.
 */
export function cleanInstalledAddons(v: unknown, seen?: unknown): string[] {
  if (!Array.isArray(v)) return [...ADDON_IDS]
  const known = Array.isArray(seen) ? new Set(seen) : null
  const added = known ? ADDON_IDS.filter((id) => !known.has(id)) : []
  return withNeeds([...v.filter((id): id is string => typeof id === 'string'), ...added])
}
