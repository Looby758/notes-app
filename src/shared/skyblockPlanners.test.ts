import { describe, expect, it } from 'vitest'
import {
  bestiaryClosest,
  dailyTasks,
  dungeonPlan,
  forgeSlots,
  gardenPlan,
  lisp,
  museumPlan,
  plannerExtras,
  quickForge,
  slayerPlan,
  treeSource,
  treeView,
  whispersOf
} from './skyblockPlanners'

const constants = {
  leveling: {
    HOTF: [0, 3000, 9000],
    slayer_boss_xp: [5, 25, 100, 500, 1500],
    slayer_boss_xp_type: { vampire: [10, 25, 60, 120, 150] },
    slayer_to_highest_tier: { zombie: 5, wolf: 4 }
  },
  museum: {
    items: { combat: ['HYPERION', 'NECRON_BLADE', 'ASPECT_OF_THE_END'], armor: ['NECRON'], special: ['TROPHY'] },
    itemToXp: { HYPERION: 20, NECRON_BLADE: 10, ASPECT_OF_THE_END: 4, NECRON: 30 },
    children: { HYPERION: 'NECRON_BLADE' },
    sets_to_items: { NECRON: ['POWER_WITHER_HELMET', 'POWER_WITHER_CHESTPLATE'] },
    mapped_ids: { STARRED_THING: 'ASPECT_OF_THE_END' }
  },
  hotmlayout: {
    hotm: {
      perks: {
        mining_speed: {
          name: 'Mining Speed',
          x: 3,
          y: 9,
          maxLevel: 50,
          powder: 'MITHRIL',
          cost: '(pow (+ level 2) 3)',
          stat: '(* level 20)',
          lore: ['§7Grants §a+{stat} Mining Speed.']
        },
        core_of_the_mountain: {
          name: 'Core of the Mountain',
          x: 3,
          y: 5,
          maxLevel: 10,
          powder: '(if (lt level 4) MITHRIL (if (lt level 8) GEMSTONE GLACITE))',
          cost: '(list.at (list.new 0 50000 100000 200000 300000 400000 600000 750000 1000000 1250000 0) level)',
          lore: []
        },
        quick_forge: { name: 'Quick Forge', x: 5, y: 7, maxLevel: 20, powder: 'MITHRIL', cost: '(pow (+ level 2) 4)', lore: [] },
        pickobulus: { name: 'Pickobulus', x: 5, y: 8, maxLevel: 1, powder: 'MITHRIL', cost: '', lore: ['§6Pickaxe Ability: Pickobulus'] }
      }
    }
  },
  garden: {
    plots: { beginner_1: { name: '§aPlot §b2', x: 1, y: 2 }, beginner_2: { name: '§aPlot §b1', x: 2, y: 1 }, advanced_1: { name: '§aPlot §b15', x: 0, y: 1 } },
    plot_costs: {
      beginner: [
        { item: 'COMPOST', amount: 1 },
        { item: 'COMPOST', amount: 2 }
      ],
      advanced: [{ item: 'ENCHANTED_COMPOST', amount: 1 }]
    },
    crop_upgrades: [5, 10, 20],
    composter_upgrades: { speed: { '1': { upgrade: 20, items: { enchanted_wheat: 128 }, copper: 100 }, '2': { upgrade: 40, items: { enchanted_golden_carrot: 2 }, copper: 150 } } },
    composter_tooltips: { speed: '§7Increases the speed of the composter by §a{}%§7.' },
    visitors: { adventurer: 'UNCOMMON', baker: 'LEGENDARY' }
  }
}
const x = plannerExtras(constants)

describe('the repo’s little Lisp', () => {
  it('works out costs and powders', () => {
    expect(lisp('(pow (+ level 2) 3)', { level: 1 })).toBe(27)
    expect(lisp('(list.at (list.new 0 50000 100000) level)', { level: 2 })).toBe(100000)
    expect(lisp('(if (lt level 4) MITHRIL (if (lt level 8) GEMSTONE GLACITE))', { level: 5 })).toBe('GEMSTONE')
    expect(lisp('', { level: 1 })).toBeNull()
    expect(lisp('(mystery 1)', { level: 1 })).toBeNull()
  })
})

describe('perk trees', () => {
  it('reads Hypixel’s names, levels, toggles and costs', () => {
    const t = treeView('mining', x.hotm, { mining_speed: 2, special_0: 5, forge_time: 20, pickaxe_toss: 1, toggle_mining_speed: false }, 'pickaxe_toss')!
    const speed = t.nodes.find((n) => n.id === 'mining_speed')!
    expect(speed.level).toBe(2)
    expect(speed.disabled).toBe(true)
    expect(speed.next).toEqual({ powder: 'MITHRIL', cost: 64 })
    expect(speed.lore[0]).toContain('+40')
    const core = t.nodes.find((n) => n.id === 'core_of_the_mountain')!
    expect(core.next).toEqual({ powder: 'GEMSTONE', cost: 400000 })
    expect(core.toMax.GLACITE).toBe(1000000 + 1250000)
    expect(t.nodes.find((n) => n.id === 'quick_forge')!.next).toBeNull()
    expect(t.nodes.find((n) => n.id === 'pickobulus')!.selected).toBe(true)
    expect(t.bought).toBe(4)
    expect(t.width).toBe(6)
    expect(t.height).toBe(10)
  })
  it('finds the levels in the new skill tree or the old mining core', () => {
    expect(treeSource({ skill_tree: { nodes: { mining: { mining_speed: 3 } }, experience: { mining: 500 } } }, 'mining')).toEqual({
      nodes: { mining_speed: 3 },
      xp: 500,
      ability: ''
    })
    expect(treeSource({ mining_core: { nodes: { a: 1 }, experience: 9, selected_pickaxe_ability: 'pickobulus' } }, 'mining')).toEqual({
      nodes: { a: 1 },
      xp: 9,
      ability: 'pickobulus'
    })
    expect(treeSource({}, 'foraging')).toBeNull()
    expect(whispersOf({ foraging_core: { forest_whispers: 100, forest_whispers_spent: 50 } })).toEqual([{ kind: 'Forest Whispers', available: 100, spent: 50 }])
  })
})

describe('museum', () => {
  it('counts lower tiers and spots what you already have', () => {
    const p = museumPlan(['HYPERION'], x.museum, new Set(['POWER_WITHER_HELMET', 'POWER_WITHER_CHESTPLATE']), (id) => (id === 'POWER_WITHER_HELMET' ? 'Necron’s Helmet' : id))
    expect(p.categories.find((c) => c.id === 'combat')).toMatchObject({ donated: 2, total: 3 })
    expect(p.categories.some((c) => c.id === 'special')).toBe(false)
    expect(p.missing.map((m) => m.id)).toEqual(['NECRON', 'ASPECT_OF_THE_END'])
    expect(p.missing[0]).toMatchObject({ owned: true, name: 'Necron’s set' })
    expect(museumPlan(['STARRED_THING'], x.museum, new Set()).missing.some((m) => m.id === 'ASPECT_OF_THE_END')).toBe(false)
  })
})

describe('slayer', () => {
  it('counts bosses of each tier to the next level', () => {
    const p = slayerPlan('wolf', 1000, [10, 30, 250, 1500, 5000], x)
    expect(p.left).toBe(500)
    expect(p.nextLevel).toBe(4)
    expect(p.tiers.map((t) => t.bosses)).toEqual([100, 20, 5, 1])
    expect(p.tiers[3].cost).toBe(50_000)
    expect(slayerPlan('wolf', 9999, [10, 30], x).tiers).toEqual([])
    expect(slayerPlan('vampire', 0, [20], x).tiers[0]).toMatchObject({ xp: 10, bosses: 2, currency: 'motes' })
  })
})

describe('dungeons', () => {
  it('counts runs per floor for each goal', () => {
    const steps = Array(50).fill(1000)
    const p = dungeonPlan({ xp: 2500, level: 2 }, { id: 'mage', name: 'Mage', xp: 100, level: 0 }, steps, { normal: 3, master: 0 })
    expect(p.goals.map((g) => [g.name, g.left])).toEqual([
      ['Catacombs 3', 500],
      ['Mage 1', 900],
      ['Catacombs 50', 47500]
    ])
    expect(p.floors.map((f) => f.floor)).toEqual(['Entrance', 'Floor 1', 'Floor 2', 'Floor 3', 'Floor 4'])
    expect(p.floors[4].runs[0]).toBe(1)
    const m = dungeonPlan({ xp: 0, level: 0 }, null, steps, { normal: 7, master: 2 })
    expect(m.floors.filter((f) => f.master).map((f) => f.floor)).toEqual(['Master 1', 'Master 2', 'Master 3'])
  })
})

describe('garden', () => {
  it('prices the next plot, crop upgrades and the composter', () => {
    const g = gardenPlan(
      {
        unlocked_plots_ids: ['beginner_1'],
        crop_upgrade_levels: { WHEAT: 1 },
        composter_data: { upgrades: { speed: 1 }, organic_matter: 10 },
        commission_data: { completed: { baker: 2 } },
        active_commissions: { adventurer: {} }
      },
      { garden_player_data: { copper: 400 } },
      x.garden
    )
    expect(g.nextPlot).toEqual({ name: 'Plot 1', item: 'COMPOST', amount: 2 })
    expect(g.plots.find((p) => p.id === 'advanced_1')!.cost).toEqual({ item: 'ENCHANTED_COMPOST', amount: 1 })
    expect(g.crops.find((c) => c.id === 'WHEAT')!.copperToMax).toBe(30)
    expect(g.crops.find((c) => c.id === 'MELON')!.copperToMax).toBe(35)
    expect(g.composter[0]).toMatchObject({ level: 1, max: 2, tip: 'Increases the speed of the composter by 20%.', next: { copper: 150 } })
    expect(g.copper).toBe(400)
    expect(g.visitors.find((v) => v.id === 'baker')!.served).toBe(2)
    expect(g.waiting).toEqual(['adventurer'])
  })
})

describe('bestiary', () => {
  it('puts the mobs closest to a tier first', () => {
    const list = bestiaryClosest([
      {
        island: 'Hub',
        mobs: [
          { name: 'Zombie', kills: 90, tier: 3, maxTier: 10, next: 100 },
          { name: 'Wolf', kills: 10, tier: 1, maxTier: 10, next: 50 },
          { name: 'Maxed', kills: 999, tier: 10, maxTier: 10, next: null }
        ]
      }
    ])
    expect(list.map((m) => [m.name, m.left])).toEqual([
      ['Zombie', 10],
      ['Wolf', 40]
    ])
  })
})

describe('forge and daily list', () => {
  it('times forge slots with Quick Forge', () => {
    expect(quickForge(20)).toBe(0.3)
    expect(quickForge(10)).toBeCloseTo(0.15)
    const slots = forgeSlots(
      { forge: { forge_processes: { forge_1: { '1': { id: 'REFINED_DIAMOND', startTime: 1000, slot: 1 }, '2': { id: 'MYSTERY', startTime: 5, slot: 2 } } } } },
      (id) => (id === 'REFINED_DIAMOND' ? 100 : null),
      20
    )
    expect(slots).toEqual([
      { slot: 1, id: 'REFINED_DIAMOND', start: 1000, ready: 1000 + 70_000 },
      { slot: 2, id: 'MYSTERY', start: 5, ready: null }
    ])
  })
  it('lists the day’s tasks from what’s unlocked', () => {
    const t = dailyTasks({
      forge: [{ slot: 1, id: 'X', start: 0, ready: 10 }],
      garden: { waiting: ['baker'] },
      gardenUnlocked: true,
      hotm: 3,
      dailyPowder: false,
      crimson: true,
      enchanting: 5,
      kuudra: false,
      now: 100
    })
    expect(t.map((x) => x.id)).toEqual(['forge', 'visitors', 'commissions', 'puzzler', 'fetchur', 'faction', 'matriarch'])
    expect(t[0]).toMatchObject({ name: 'Collect from the Forge (1 ready)', auto: false })
    expect(t[1].name).toContain('1 waiting')
  })
})
