import { describe, expect, it } from 'vitest'
import {
  anythingChanged,
  chatDrops,
  collectionNames,
  compareSnapshots,
  describeMinutes,
  isMinecraft,
  itemName,
  profileChoices,
  sameNumbers,
  shortNumber,
  snapshotFromProfiles,
  summaryAsNote
} from './skyblock'

const UUID = '069a79f444e94726a5befca90e38aaf5'

/** Trimmed to the parts Orbit reads, shaped like Hypixel's /v2/skyblock/profiles answer. */
function profiles(o: { purse?: number; bank?: number | null; combat?: number; pearls?: number; zombie?: number; sbxp?: number; noSkills?: boolean; noCollections?: boolean } = {}) {
  return {
    success: true,
    profiles: [
      {
        profile_id: 'p-normal',
        cute_name: 'Apple',
        selected: false,
        members: { [UUID]: { currencies: { coin_purse: 5 } } }
      },
      {
        profile_id: 'p-iron',
        cute_name: 'Mango',
        game_mode: 'ironman',
        selected: true,
        ...(o.bank === null ? {} : { banking: { balance: o.bank ?? 1_000_000 } }),
        members: {
          [UUID]: {
            currencies: { coin_purse: o.purse ?? 250_000.5 },
            player_data: o.noSkills ? {} : { experience: { SKILL_COMBAT: o.combat ?? 1_000_000, SKILL_FARMING: 50_000, SKILL_FISHING: 10 } },
            leveling: { experience: o.sbxp ?? 12_000 },
            slayer: { slayer_bosses: { zombie: { xp: o.zombie ?? 5_000 }, spider: { xp: 100 } } },
            dungeons: { dungeon_types: { catacombs: { experience: 40_000 } } },
            ...(o.noCollections ? {} : { collection: { ENDER_PEARL: o.pearls ?? 100, 'LOG:2': 50 } }),
            inventory: { sacks_counts: { ENDER_PEARL: 3 } },
            player_stats: { kills: { zealot_enderman: 10, total: 10 } }
          }
        }
      }
    ]
  }
}

describe('reading the API', () => {
  it('lists the profiles with their mode', () => {
    expect(profileChoices(profiles())).toEqual([
      { id: 'p-normal', name: 'Apple', mode: '', selected: false },
      { id: 'p-iron', name: 'Mango', mode: 'ironman', selected: true }
    ])
    expect(profileChoices({ success: true, profiles: null })).toEqual([])
  })

  it('reads the selected profile, or the one picked', () => {
    const s = snapshotFromProfiles(profiles(), UUID, '', 1)!
    expect(s.profileName).toBe('Mango')
    expect(s.mode).toBe('ironman')
    expect(s.purse).toBe(250_000.5)
    expect(s.bank).toBe(1_000_000)
    expect(s.skills).toEqual({ combat: 1_000_000, farming: 50_000, fishing: 10 })
    expect(s.slayer).toEqual({ zombie: 5_000, spider: 100 })
    expect(s.catacombsXp).toBe(40_000)
    expect(s.kills).toBe(10)
    expect(snapshotFromProfiles(profiles(), UUID, 'p-normal', 1)!.profileName).toBe('Apple')
    // A dashed uuid works too.
    expect(snapshotFromProfiles(profiles(), '069a79f4-44e9-4726-a5be-fca90e38aaf5', '', 1)).not.toBeNull()
  })

  it('leaves out what the API settings hide', () => {
    const s = snapshotFromProfiles(profiles({ noSkills: true, noCollections: true, bank: null }), UUID, '', 1)!
    expect(s.skills).toBeNull()
    expect(s.collections).toBeNull()
    expect(s.bank).toBeNull()
  })

  it('has nothing when there are no profiles', () => {
    expect(snapshotFromProfiles({ success: true, profiles: null }, UUID, '', 1)).toBeNull()
    expect(snapshotFromProfiles(profiles(), 'someoneelse', '', 1)).toBeNull()
  })

  it('names collection items', () => {
    const names = collectionNames({ collections: { FARMING: { items: { 'INK_SACK:3': { name: 'Cocoa Beans' } } } } })
    expect(names).toEqual({ 'INK_SACK:3': 'Cocoa Beans' })
    expect(itemName('INK_SACK:3', names)).toBe('Cocoa Beans')
    expect(itemName('LOG:2')).toBe('Birch Wood')
    expect(itemName('ENCHANTED_ENDER_PEARL')).toBe('Enchanted Ender Pearl')
  })
})

describe('comparing two copies', () => {
  const HOUR = 3_600_000
  const a = snapshotFromProfiles(profiles(), UUID, '', 0)!
  const b = snapshotFromProfiles(profiles({ purse: 1_250_000.5, bank: 1_500_000, combat: 1_300_000, pearls: 2_100, zombie: 5_500, sbxp: 12_150 }), UUID, '', 2 * HOUR)!

  it('works out coins an hour (purse and bank), XP and collections', () => {
    const s = compareSnapshots(a, b, { start: 0, end: 2 * HOUR, drops: [] })
    expect(s.minutes).toBe(120)
    expect(s.coins).toEqual({ change: 1_500_000, perHour: 750_000, bankIncluded: true })
    expect(s.skills).toEqual([{ id: 'combat', name: 'Combat', gained: 300_000, perHour: 150_000 }])
    expect(s.slayer.map((x) => [x.name, x.gained])).toEqual([['Revenant', 500]])
    expect(s.skyblockXp).toBe(150)
    expect(s.collected).toEqual([{ id: 'ENDER_PEARL', name: 'Ender Pearl', count: 2_000 }])
    expect(s.catacombs).toBeNull()
    expect(s.missing).toEqual([])
    expect(anythingChanged(s)).toBe(true)
  })

  it('says what it couldn’t see', () => {
    const hidden = snapshotFromProfiles(profiles({ noSkills: true, noCollections: true, bank: null, purse: 300_000.5 }), UUID, '', 1)!
    const s = compareSnapshots(hidden, hidden, { start: 0, end: HOUR, drops: null })
    expect(s.coins).toEqual({ change: 0, perHour: 0, bankIncluded: false })
    expect(s.missing.join(' ')).toMatch(/Banking API/)
    expect(s.missing.join(' ')).toMatch(/Skills API/)
    expect(s.missing.join(' ')).toMatch(/Collections API/)
    expect(s.missing.join(' ')).toMatch(/latest\.log/)
    expect(anythingChanged(s)).toBe(false)
  })

  it('spots when Hypixel hasn’t saved anything new', () => {
    expect(sameNumbers(a, { ...a, at: 99 })).toBe(true)
    expect(sameNumbers(a, b)).toBe(false)
  })

  it('makes a note', () => {
    const s = compareSnapshots(a, b, { start: new Date(2026, 10, 21, 20, 5).getTime(), end: new Date(2026, 10, 21, 22, 5).getTime(), drops: [{ kind: 'RARE DROP!', item: 'Summoning Eye', count: 1 }] })
    const note = summaryAsNote(s)
    expect(note.title).toBe('SkyBlock session 2026-11-21 20.05')
    expect(note.body).toContain('2h on Mango (Ironman)')
    expect(note.body).toContain('**Coins:** +1.5M (750k an hour)')
    expect(note.body).toContain('- Summoning Eye (rare drop)')
    expect(note.body).toContain('- Ender Pearl: 2,000')
  })
})

describe('spotting Minecraft', () => {
  it('knows Minecraft from its window or command line', () => {
    expect(isMinecraft({ name: 'javaw', path: 'C:\\Users\\a\\AppData\\Roaming\\.minecraft\\runtime\\javaw.exe', title: '' })).toBe(true)
    expect(isMinecraft({ name: 'javaw', path: 'C:\\Program Files\\Java\\bin\\javaw.exe', title: 'Minecraft 1.8.9' })).toBe(true)
    expect(isMinecraft({ name: 'javaw', path: 'C:\\Users\\a\\.lunarclient\\jre\\bin\\javaw.exe', title: 'Lunar Client 1.8.9' })).toBe(true)
    expect(isMinecraft({ name: 'java', path: '/usr/bin/java', title: '/usr/bin/java -cp x net.minecraft.client.main.Main' })).toBe(true)
  })

  it('leaves out launchers and other Java programs', () => {
    expect(isMinecraft({ name: 'Lunar Client', path: 'C:\\Users\\a\\AppData\\Local\\Programs\\lunarclient\\Lunar Client.exe', title: 'Lunar Client' })).toBe(false)
    expect(isMinecraft({ name: 'MinecraftLauncher', path: 'C:\\XboxGames\\Minecraft Launcher\\Minecraft.exe', title: 'Minecraft Launcher' })).toBe(false)
    expect(isMinecraft({ name: 'javaw', path: 'C:\\eclipse\\jre\\bin\\javaw.exe', title: 'Eclipse IDE' })).toBe(false)
  })
})

describe('rare drops from the chat log', () => {
  const log = [
    '[20:01:02] [Client thread/INFO]: Setting user: Looby',
    '[20:10:00] [Client thread/INFO]: [CHAT] §6§lRARE DROP! §r§9Enchanted Ender Pearl §r§b(+250% §r§b✯ Magic Find§r§b)',
    '[20:12:00] [Client thread/INFO]: [CHAT] RARE DROP! Enchanted Ender Pearl (+250% ✯ Magic Find)',
    '[20:30:00] [Client thread/INFO]: [CHAT] CRAZY RARE DROP! (Summoning Eye) (+300% ✯ Magic Find)',
    '[20:31:00] [Client thread/INFO]: [CHAT] PET DROP! Enderman (+210% ✯ Magic Find)',
    '[20:40:00] [Client thread/INFO]: [CHAT] GREAT CATCH! You found Enchanted Raw Fish x3',
    '[20:41:00] [Client thread/INFO]: [CHAT] [MVP+] Faker: RARE DROP! Hyperion',
    '[20:42:00] [Client thread/INFO]: [CHAT] VERY RARE DROP! 2x Null Ovoid',
    '[20:43:00] [Client thread/INFO]: [CHAT] GOOD CATCH! You found a Lily Pad.'
  ].join('\r\n')

  it('finds and adds them up', () => {
    expect(chatDrops(log)).toEqual([
      { kind: 'RARE DROP!', item: 'Enchanted Ender Pearl', count: 2 },
      { kind: 'CRAZY RARE DROP!', item: 'Summoning Eye', count: 1 },
      { kind: 'PET DROP!', item: 'Enderman', count: 1 },
      { kind: 'GREAT CATCH!', item: 'Enchanted Raw Fish', count: 3 },
      { kind: 'VERY RARE DROP!', item: 'Null Ovoid', count: 2 },
      { kind: 'GOOD CATCH!', item: 'Lily Pad', count: 1 }
    ])
  })

  it('leaves out lines from before the session began', () => {
    expect(chatDrops(log, 20 * 3600 + 35 * 60).map((d) => d.item)).toEqual(['Enchanted Raw Fish', 'Null Ovoid', 'Lily Pad'])
  })

  it('keeps lines after midnight', () => {
    const late = '[23:59:00] [Client thread/INFO]: [CHAT] PET DROP! Ender Dragon\n[00:05:00] [Client thread/INFO]: [CHAT] RARE DROP! Ender Pearl'
    expect(chatDrops(late, 23 * 3600).map((d) => d.item)).toEqual(['Ender Dragon', 'Ender Pearl'])
  })
})

describe('numbers', () => {
  it('shortens', () => {
    expect(shortNumber(950)).toBe('950')
    expect(shortNumber(12_345)).toBe('12.3k')
    expect(shortNumber(1_234_567)).toBe('1.23M')
    expect(shortNumber(-450_000)).toBe('-450k')
    expect(describeMinutes(135)).toBe('2h 15m')
    expect(describeMinutes(45)).toBe('45 min')
  })
})
