/**
 * SkyBlock session summary, the pure parts: reading what Hypixel's API says about your SkyBlock
 * profile, comparing the copy taken when Minecraft started with the one taken after it closed,
 * spotting Minecraft among the running programs, and picking the rare drops out of Minecraft's
 * own log.
 *
 * What can and can't be known: Hypixel's API only has totals (coins, skill XP, collections…), so
 * a session is the difference between two copies. It says nothing about single drops, so those
 * come from the chat lines Minecraft writes to its log (RARE DROP!, PET DROP!…). Anything a
 * SkyBlock API setting hides (in game: SkyBlock Menu → Settings → API Settings) is left out and
 * named on the card.
 */

export const HYPIXEL_API = 'https://api.hypixel.net'

export interface SkyblockProfileChoice {
  id: string
  /** The fruit name Hypixel gives each profile ("Mango"). */
  name: string
  /** 'ironman', 'island' (Stranded), 'bingo', or '' for a normal profile. */
  mode: string
  selected: boolean
}

/** One copy of the numbers that matter, from the API. A null means the API didn't share it. */
export interface SkyblockSnapshot {
  at: number
  profileId: string
  profileName: string
  mode: string
  purse: number | null
  bank: number | null
  /** Skill name ('farming') → total XP. */
  skills: Record<string, number> | null
  skyblockXp: number | null
  /** Slayer boss ('zombie') → total XP. */
  slayer: Record<string, number> | null
  catacombsXp: number | null
  /** Collection item id ('ENDER_PEARL') → amount collected ever. */
  collections: Record<string, number> | null
  /** Sack item id → how many are in your sacks. */
  sacks: Record<string, number> | null
  kills: number | null
}

export interface ChatDrop {
  /** As the chat said it: 'RARE DROP!', 'PET DROP!', 'GREAT CATCH!'… */
  kind: string
  item: string
  count: number
}

export interface XpLine {
  id: string
  name: string
  gained: number
  perHour: number
}

export interface SkyblockSummary {
  id: string
  start: number
  end: number
  minutes: number
  profileName: string
  mode: string
  /** Purse + bank. null when neither could be read both times. */
  coins: { change: number; perHour: number; bankIncluded: boolean } | null
  skills: XpLine[]
  skyblockXp: number | null
  slayer: XpLine[]
  catacombs: XpLine | null
  /** Collections that went up, most first. */
  collected: { id: string; name: string; count: number }[]
  kills: number | null
  /** Rare drops from the chat log. null when no log was found to read. */
  drops: ChatDrop[] | null
  /** Plain sentences about what couldn't be seen. */
  missing: string[]
  /** Orbit was opened after Minecraft, so the start copy was taken late. */
  startedLate: boolean
}

export interface SkyblockStatus {
  hasKey: boolean
  canEncrypt: boolean
  player: string
  uuid: string
  profileId: string
  profiles: SkyblockProfileChoice[]
  /** Read chat for rare drops. */
  readLog: boolean
  /** The folder Minecraft writes latest.log to ('' = look in the usual places). */
  logFolder: string
  /** A session going on now (Minecraft is open), with when it began. */
  session: { start: number; startedLate: boolean } | null
  /** Waiting for Hypixel to save the last session before showing it. */
  finishing: boolean
  /** The last thing that went wrong talking to Hypixel, if anything. */
  problem: string
}

// ---------- reading the API ----------

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

const numbers = (v: unknown): Record<string, number> | null => {
  if (!isObj(v)) return null
  const out: Record<string, number> = {}
  for (const [k, val] of Object.entries(v)) {
    const n = num(val)
    if (n !== null) out[k] = n
  }
  return out
}

const dashless = (uuid: string): string => uuid.replace(/-/g, '').toLowerCase()

/** The profiles in an answer from /v2/skyblock/profiles, for the picker. */
export function profileChoices(body: unknown): SkyblockProfileChoice[] {
  const list = isObj(body) && Array.isArray(body.profiles) ? body.profiles : []
  return list.filter(isObj).map((p) => ({
    id: String(p.profile_id ?? ''),
    name: String(p.cute_name ?? 'Profile'),
    mode: typeof p.game_mode === 'string' ? p.game_mode : '',
    selected: p.selected === true
  })).filter((p) => p.id)
}

/**
 * Your numbers from an answer from /v2/skyblock/profiles: the profile picked in Orbit, or the one
 * you're on in game. null when you have no SkyBlock profile.
 */
export function snapshotFromProfiles(body: unknown, uuid: string, profileId: string, at: number): SkyblockSnapshot | null {
  const list = (isObj(body) && Array.isArray(body.profiles) ? body.profiles : []).filter(isObj)
  const profile = (profileId && list.find((p) => p.profile_id === profileId)) || list.find((p) => p.selected === true) || list[0]
  if (!profile) return null
  const members = isObj(profile.members) ? profile.members : {}
  const me = members[dashless(uuid)]
  if (!isObj(me)) return null

  const currencies = isObj(me.currencies) ? me.currencies : {}
  const playerData = isObj(me.player_data) ? me.player_data : {}
  const experience = isObj(playerData.experience) ? playerData.experience : null
  let skills: Record<string, number> | null = null
  if (experience) {
    skills = {}
    for (const [k, v] of Object.entries(experience)) {
      const n = num(v)
      if (n !== null && k.startsWith('SKILL_')) skills[k.slice(6).toLowerCase()] = n
    }
  }
  const leveling = isObj(me.leveling) ? me.leveling : {}
  const slayerBosses = isObj(me.slayer) && isObj(me.slayer.slayer_bosses) ? me.slayer.slayer_bosses : null
  let slayer: Record<string, number> | null = null
  if (slayerBosses) {
    slayer = {}
    for (const [k, v] of Object.entries(slayerBosses)) {
      const xp = isObj(v) ? num(v.xp) : null
      if (xp !== null) slayer[k] = xp
    }
  }
  const dungeons = isObj(me.dungeons) && isObj(me.dungeons.dungeon_types) ? me.dungeons.dungeon_types : {}
  const catacombs = isObj(dungeons.catacombs) ? num(dungeons.catacombs.experience) : null
  const inventory = isObj(me.inventory) ? me.inventory : null
  const stats = isObj(me.player_stats) ? me.player_stats : {}
  let kills: number | null = null
  if (isObj(stats.kills)) {
    const k = numbers(stats.kills) ?? {}
    kills = k.total ?? Object.values(k).reduce((a, b) => a + b, 0)
  }
  // The bank is the profile's (shared on co-ops); without the Banking API there's no "banking".
  const banking = isObj(profile.banking) ? num(profile.banking.balance) : null

  return {
    at,
    profileId: String(profile.profile_id ?? ''),
    profileName: String(profile.cute_name ?? 'Profile'),
    mode: typeof profile.game_mode === 'string' ? profile.game_mode : '',
    purse: num(currencies.coin_purse),
    bank: banking,
    skills,
    skyblockXp: num(leveling.experience),
    slayer,
    catacombsXp: catacombs,
    collections: numbers(me.collection),
    sacks: inventory ? numbers(inventory.sacks_counts) : null,
    kills
  }
}

/** Collection item id → its name, from /v2/resources/skyblock/collections (no key needed). */
export function collectionNames(body: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  const groups = isObj(body) && isObj(body.collections) ? body.collections : {}
  for (const g of Object.values(groups)) {
    if (!isObj(g) || !isObj(g.items)) continue
    for (const [id, item] of Object.entries(g.items)) if (isObj(item) && typeof item.name === 'string') out[id] = item.name
  }
  return out
}

/** Old Minecraft ids that don't read as their names. */
const ODD_NAMES: Record<string, string> = {
  LOG: 'Oak Wood',
  'LOG:1': 'Spruce Wood',
  'LOG:2': 'Birch Wood',
  'LOG:3': 'Jungle Wood',
  LOG_2: 'Acacia Wood',
  'LOG_2:1': 'Dark Oak Wood',
  'INK_SACK:3': 'Cocoa Beans',
  'INK_SACK:4': 'Lapis Lazuli',
  INK_SACK: 'Ink Sack',
  RAW_FISH: 'Raw Fish',
  'RAW_FISH:1': 'Raw Salmon',
  'RAW_FISH:2': 'Clownfish',
  'RAW_FISH:3': 'Pufferfish',
  SULPHUR: 'Gunpowder',
  NETHER_STALK: 'Nether Wart',
  ENDER_STONE: 'End Stone',
  QUARTZ: 'Nether Quartz',
  CARROT_ITEM: 'Carrot',
  POTATO_ITEM: 'Potato',
  MUSHROOM_COLLECTION: 'Mushroom',
  GEMSTONE_COLLECTION: 'Gemstone',
  MITHRIL_ORE: 'Mithril',
  'SAND:1': 'Red Sand',
  WATER_LILY: 'Lily Pad',
  CLAY_BALL: 'Clay',
  SNOW_BALL: 'Snowball'
}

/** A readable name for an item id, using Hypixel's names when Orbit has them. */
export function itemName(id: string, names: Record<string, string> = {}): string {
  if (names[id]) return names[id]
  if (ODD_NAMES[id]) return ODD_NAMES[id]
  return id
    .replace(/:\d+$/, '')
    .split('_')
    .filter(Boolean)
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(' ')
}

const SKILL_ORDER = ['combat', 'farming', 'mining', 'foraging', 'fishing', 'enchanting', 'alchemy', 'taming', 'carpentry', 'runecrafting', 'social']
const SLAYER_NAMES: Record<string, string> = { zombie: 'Revenant', spider: 'Tarantula', wolf: 'Sven', enderman: 'Voidgloom', blaze: 'Inferno', vampire: 'Riftstalker' }

const capitalise = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** Below this, an hourly rate would be a guess blown up from a few seconds, so it isn't shown. */
export const RATE_MIN_MINUTES = 5

/** Per hour, from minutes played. */
const perHour = (amount: number, minutes: number): number => (amount * 60) / Math.max(minutes, 1)

function xpLines(a: Record<string, number> | null, b: Record<string, number> | null, minutes: number, nameOf: (id: string) => string, order: string[] = []): XpLine[] {
  if (!a || !b) return []
  const lines: XpLine[] = []
  for (const [id, after] of Object.entries(b)) {
    const gained = after - (a[id] ?? 0)
    if (gained > 0.5) lines.push({ id, name: nameOf(id), gained, perHour: perHour(gained, minutes) })
  }
  const rank = (id: string): number => (order.includes(id) ? order.indexOf(id) : order.length)
  return lines.sort((x, y) => y.gained - x.gained || rank(x.id) - rank(y.id))
}

/** What changed between two copies: the session card. */
export function compareSnapshots(
  a: SkyblockSnapshot,
  b: SkyblockSnapshot,
  opts: { start: number; end: number; drops: ChatDrop[] | null; names?: Record<string, string>; startedLate?: boolean; logWanted?: boolean }
): SkyblockSummary {
  const minutes = Math.max(0, Math.round((opts.end - opts.start) / 60_000))
  const missing: string[] = []

  let coins: SkyblockSummary['coins'] = null
  if (a.purse !== null && b.purse !== null) {
    const bankIncluded = a.bank !== null && b.bank !== null
    const change = b.purse - a.purse + (bankIncluded ? b.bank! - a.bank! : 0)
    coins = { change, perHour: perHour(change, minutes), bankIncluded }
    if (!bankIncluded) missing.push('Coins in your bank aren’t counted, because the Banking API is off. Only your purse is.')
  } else missing.push('Coins couldn’t be read.')

  const skills = xpLines(a.skills, b.skills, minutes, capitalise, SKILL_ORDER)
  if (!a.skills || !b.skills) missing.push('Skill XP is hidden, because the Skills API is off.')

  const collected: SkyblockSummary['collected'] = []
  if (a.collections && b.collections) {
    for (const [id, after] of Object.entries(b.collections)) {
      const count = after - (a.collections[id] ?? 0)
      if (count > 0) collected.push({ id, name: itemName(id, opts.names), count })
    }
    collected.sort((x, y) => y.count - x.count)
  } else missing.push('Items collected are hidden, because the Collections API is off.')

  const catacombsGained = a.catacombsXp !== null && b.catacombsXp !== null ? b.catacombsXp - a.catacombsXp : 0
  const sbXp = a.skyblockXp !== null && b.skyblockXp !== null ? b.skyblockXp - a.skyblockXp : null

  if (opts.drops === null && opts.logWanted !== false) missing.push('Rare drops need Minecraft’s log (latest.log), and Orbit couldn’t find it. Pick its folder on the Games page → SkyBlock.')

  return {
    id: `${opts.start}`,
    start: opts.start,
    end: opts.end,
    minutes,
    profileName: b.profileName,
    mode: b.mode,
    coins,
    skills,
    skyblockXp: sbXp,
    slayer: xpLines(a.slayer, b.slayer, minutes, (id) => SLAYER_NAMES[id] ?? capitalise(id)),
    catacombs: catacombsGained > 0.5 ? { id: 'catacombs', name: 'Catacombs', gained: catacombsGained, perHour: perHour(catacombsGained, minutes) } : null,
    collected,
    kills: a.kills !== null && b.kills !== null ? Math.max(0, b.kills - a.kills) : null,
    drops: opts.drops,
    missing,
    startedLate: !!opts.startedLate
  }
}

/** Whether anything at all moved (nothing did: you didn't play SkyBlock, or Hypixel hasn't saved yet). */
export function anythingChanged(s: SkyblockSummary): boolean {
  return (
    (s.coins !== null && s.coins.change !== 0) ||
    s.skills.length > 0 ||
    (s.skyblockXp ?? 0) > 0 ||
    s.slayer.length > 0 ||
    s.catacombs !== null ||
    s.collected.length > 0 ||
    (s.kills ?? 0) > 0 ||
    (s.drops?.length ?? 0) > 0
  )
}

/** Whether two copies have the same numbers (Hypixel hasn't saved anything new in between). */
export function sameNumbers(a: SkyblockSnapshot, b: SkyblockSnapshot): boolean {
  const strip = (s: SkyblockSnapshot): string => JSON.stringify({ ...s, at: 0 })
  return strip(a) === strip(b)
}

// ---------- spotting Minecraft ----------

export interface ProgramInfo {
  /** Program name ('javaw'). */
  name: string
  path: string
  /** Window title (Windows) or command line (Mac). */
  title: string
}

const MINECRAFT_WORDS = /minecraft|lunar ?client|\.lunarclient|badlion|feather|skyclient|prismlauncher|multimc|polymc|labymod|net\.minecraft/i

/**
 * Whether a running program is Minecraft itself (Java Edition: a java/javaw program, whatever the
 * client), not just its launcher. Hypixel SkyBlock is only on Java Edition.
 */
export function isMinecraft(p: ProgramInfo): boolean {
  const name = p.name.toLowerCase().replace(/\.exe$/, '')
  const java = name === 'java' || name === 'javaw' || /[\\/]javaw?(\.exe)?$/i.test(p.path)
  if (!java) return false
  return MINECRAFT_WORDS.test(p.title) || MINECRAFT_WORDS.test(p.path)
}

// ---------- the chat log ----------

/** Chat lines Hypixel sends for drops worth a mention. */
const DROP = /^((?:(?:VERY |CRAZY |INSANE |PRAY TO RNGESUS )?RARE DROP!)|INSANE DROP!|PET DROP!|(?:GOOD|GREAT|OUTSTANDING) CATCH!|RARE REWARD!)\s+(.+)$/

/** Minecraft's colour codes (§a…) and anything else that isn't text. */
const COLOURS = /§[0-9a-fk-or]/gi

/** Seconds since midnight for a log line's [HH:MM:SS]. */
const lineTime = (line: string): number | null => {
  const m = /^\[(\d\d):(\d\d):(\d\d)\]/.exec(line)
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null
}

/**
 * The rare drops in Minecraft's latest.log, from the session's start (a local time of day). The log
 * starts fresh each time Minecraft opens, so it holds just this session; the time check leaves out
 * drops from before Orbit noticed you were playing, when a session is started by hand.
 * Lines from other players (which start with their name) never count.
 */
export function chatDrops(log: string, startSecondsOfDay: number | null = null): ChatDrop[] {
  const found = new Map<string, ChatDrop>()
  let wrapped = false
  let last = -1
  for (const raw of log.split(/\r?\n/)) {
    const at = lineTime(raw)
    if (at !== null) {
      if (at < last) wrapped = true // played past midnight
      last = at
    }
    if (startSecondsOfDay !== null && !wrapped && at !== null && at < startSecondsOfDay) continue
    const chat = /\[CHAT\]\s?(.*)$/.exec(raw)
    if (!chat) continue
    const text = chat[1].replace(COLOURS, '').trim()
    const m = DROP.exec(text)
    if (!m) continue
    let item = m[2]
      .replace(/\s*\(\+?\d+(?:\.\d+)?%[^)]*\)\s*$/, '') // (+250% ✯ Magic Find)
      .replace(/^\((.*)\)$/, '$1') // slayer drops come in brackets
      .replace(/[^\x20-\x7e]+/g, ' ')
      .replace(/^You found (an? )?/i, '') // fishing: "GOOD CATCH! You found a Lily Pad."
      .replace(/\.$/, '')
      .trim()
    let count = 1
    const times = /^(.*?)\s+x(\d+)$/.exec(item) ?? /^(\d+)x\s+(.*)$/.exec(item)
    if (times) {
      if (/^\d+$/.test(times[1])) {
        count = +times[1]
        item = times[2]
      } else {
        item = times[1]
        count = +times[2]
      }
    }
    if (!item) continue
    const kind = m[1]
    const key = `${kind}|${item}`
    const had = found.get(key)
    if (had) had.count += count
    else found.set(key, { kind, item, count })
  }
  return [...found.values()]
}

// ---------- showing it ----------

/** 1234567 → "1.23M", 12345 → "12.3k", 950 → "950". */
export function shortNumber(n: number): string {
  const sign = n < 0 ? '-' : ''
  const a = Math.abs(n)
  const fmt = (v: number, suffix: string): string => `${sign}${v >= 100 ? Math.round(v) : v >= 10 ? (Math.round(v * 10) / 10).toString() : (Math.round(v * 100) / 100).toString()}${suffix}`
  if (a >= 1e9) return fmt(a / 1e9, 'B')
  if (a >= 1e6) return fmt(a / 1e6, 'M')
  if (a >= 1e3) return fmt(a / 1e3, 'k')
  return `${sign}${Math.round(a)}`
}

export function describeMinutes(minutes: number): string {
  if (minutes < 1) return 'under a minute'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m} min`
  return m ? `${h}h ${m}m` : `${h}h`
}

export const MODE_NAMES: Record<string, string> = { ironman: 'Ironman', island: 'Stranded', bingo: 'Bingo' }

/** The session card as a note. */
export function summaryAsNote(s: SkyblockSummary): { title: string; body: string } {
  const day = new Date(s.start)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
  const time = `${pad(day.getHours())}:${pad(day.getMinutes())}`
  const title = `SkyBlock session ${date} ${time.replace(':', '.')}`
  const rates = s.minutes >= RATE_MIN_MINUTES
  const lines: string[] = [`# SkyBlock session, ${date} ${time}`, '', `${describeMinutes(s.minutes)} on ${s.profileName}${MODE_NAMES[s.mode] ? ` (${MODE_NAMES[s.mode]})` : ''}.`, '']
  if (s.coins) lines.push(`- **Coins:** ${s.coins.change >= 0 ? '+' : ''}${shortNumber(s.coins.change)}${rates ? ` (${shortNumber(s.coins.perHour)} an hour)` : ''}${s.coins.bankIncluded ? '' : ', purse only'}`)
  if (s.skyblockXp) lines.push(`- **SkyBlock XP:** +${shortNumber(s.skyblockXp)}`)
  if (s.kills) lines.push(`- **Kills:** ${s.kills.toLocaleString('en-GB')}`)
  const xp = [...s.skills, ...s.slayer, ...(s.catacombs ? [s.catacombs] : [])]
  if (xp.length) {
    lines.push('', '## XP', '')
    for (const x of xp) lines.push(`- ${x.name}: +${shortNumber(x.gained)}${rates ? ` (${shortNumber(x.perHour)} an hour)` : ''}`)
  }
  if (s.drops?.length) {
    lines.push('', '## Rare drops', '')
    for (const d of s.drops) lines.push(`- ${d.item}${d.count > 1 ? ` ×${d.count}` : ''} (${d.kind.replace(/!$/, '').toLowerCase()})`)
  }
  if (s.collected.length) {
    lines.push('', '## Collected', '')
    for (const c of s.collected) lines.push(`- ${c.name}: ${c.count.toLocaleString('en-GB')}`)
  }
  if (s.missing.length) lines.push('', ...s.missing.map((m) => `_${m}_`))
  return { title, body: lines.join('\n') + '\n' }
}
