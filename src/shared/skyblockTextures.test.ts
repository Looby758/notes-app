import { describe, expect, it } from 'vitest'
import {
  findTexture,
  hypixelFileName,
  iconOf,
  iconOfNbt,
  indexPacks,
  isoCube,
  pickTexture,
  mcItemOfNeu,
  minecraftItem,
  resolveHypixelModels,
  skinFromSnbt,
  skinFromTag,
  skinFromValue,
  type TexturePack
} from './skyblockTextures'
import { viewItems } from './skyblockProfile'

const skinValue = (hash: string): string => btoa(JSON.stringify({ textures: { SKIN: { url: `http://textures.minecraft.net/texture/${hash}` } } }))
const HASH = 'a'.repeat(64)

const furf: TexturePack = {
  id: 'furfsky_reborn',
  matchers: [
    { t: 'worn', m: { i: ['diamond_chestplate'], t: 'armor' } },
    { t: 'aote', m: { i: ['diamond_sword'], n: { ExtraAttributes: { id: 'ASPECT_OF_THE_END' } } } },
    { t: 'archer', m: { i: ['leather_boots'], n: { ExtraAttributes: { id: 'regex:(?:STARRED_)?ADAPTIVE_BOOTS' }, display: { Lore: { '*': 'ipattern:*§aArcher*' } } } } },
    { t: 'hype', m: { i: ['iron_sword'], n: { display: { Name: 'ipattern:*hyperion*' } } } },
    { t: 'bee', m: { i: ['skull'], d: 3, n: { ExtraAttributes: { id: 'pattern:BEE_PET*' } } } }
  ]
}
const vanilla: TexturePack = {
  id: 'vanilla',
  matchers: [
    { t: 'dsword', m: { i: ['diamond_sword'], d: 0 } },
    { t: 'skull3', m: { i: ['skull'], d: 3 } },
    { t: 'granite', m: { i: ['stone'], d: 1 } },
    { t: 'stone', m: { i: ['stone'], d: 0 } }
  ]
}

describe('findTexture', () => {
  it('uses the first pack that matches, and skips worn-armour textures', () => {
    const q = (id: string, nbt: Record<string, unknown> = {}, damage = 0) => findTexture({ id, damage, nbt }, [furf, vanilla])
    expect(q('diamond_sword', { ExtraAttributes: { id: 'ASPECT_OF_THE_END' } })).toBe('furfsky_reborn/aote.png')
    expect(q('diamond_sword', { ExtraAttributes: { id: 'OTHER' } })).toBe('vanilla/dsword.png')
    expect(q('diamond_chestplate')).toBeNull()
  })

  it('reads regex, ipattern and any-line-of-a-list rules', () => {
    const boots = (lore: string[], id = 'STARRED_ADAPTIVE_BOOTS') =>
      findTexture({ id: 'leather_boots', damage: 0, nbt: { ExtraAttributes: { id }, display: { Lore: lore } } }, [furf])
    expect(boots(['§7Hi', '§7Class: §aArcher'])).toBe('furfsky_reborn/archer.png')
    expect(boots(['§7Class: §aMage'])).toBeNull()
    expect(boots(['§aArcher'], 'NOT_ADAPTIVE_BOOTS')).toBeNull()
    expect(findTexture({ id: 'iron_sword', damage: 0, nbt: { display: { Name: '§6Heroic HYPERION §d✪' } } }, [furf])).toBe('furfsky_reborn/hype.png')
  })

  it('tries the exact damage first, then any damage', () => {
    expect(findTexture({ id: 'stone', damage: 1, nbt: {} }, [vanilla])).toBe('vanilla/granite.png')
    expect(findTexture({ id: 'stone', damage: 9, nbt: {} }, [vanilla])).toBe('vanilla/granite.png')
    // Same answer from a prepared index.
    expect(findTexture({ id: 'stone', damage: 0, nbt: {} }, indexPacks([vanilla]))).toBe('vanilla/stone.png')
  })
})

describe('items to pictures', () => {
  const ids = { '276': 'minecraft:diamond_sword', '397': 'minecraft:skull' }

  it('turns Hypixel and NEU item ids into Minecraft names', () => {
    expect(minecraftItem(276, 0, ids)).toEqual({ id: 'diamond_sword', damage: 0 })
    expect(minecraftItem('minecraft:dye:4', 0, ids)).toEqual({ id: 'dye', damage: 4 })
    expect(minecraftItem('granite', 0, ids, { granite: 'stone:1' })).toEqual({ id: 'stone', damage: 1 })
  })

  it('finds head skins in NBT and SNBT', () => {
    expect(skinFromValue(skinValue(HASH))).toBe(HASH)
    expect(skinFromValue('nonsense')).toBe('')
    expect(skinFromTag({ SkullOwner: { Properties: { textures: [{ Value: skinValue(HASH) }] } } })).toBe(HASH)
    expect(skinFromSnbt(`{SkullOwner:{Properties:{textures:[0:{Value:\\"${skinValue(HASH)}\\"}]}}}`)).toBe(HASH)
  })

  it('reads a NEU item file and picks pack, then head, then vanilla', () => {
    const index = indexPacks([furf, vanilla])
    const bee = mcItemOfNeu(
      {
        internalname: 'BEE;4',
        itemid: 'minecraft:skull',
        damage: 3,
        displayname: '§6[Lvl {LVL}] Bee',
        nbttag: `{SkullOwner:{Properties:{textures:[0:{Value:"${skinValue(HASH)}"}]}},ExtraAttributes:{petInfo:"x",id:"BEE_PET_4"}}`
      },
      ids,
      {}
    )!
    expect(bee).toMatchObject({ i: 'skull', d: 3, s: HASH, x: 'BEE_PET_4' })
    expect(iconOf(bee, index)).toEqual({ tex: 'furfsky_reborn/bee.png' })
    // No pack picture: the head wins over vanilla's plain skull.
    expect(iconOf({ ...bee, x: 'OTHER' }, index)).toEqual({ skin: HASH })
    expect(iconOf({ ...bee, x: 'OTHER', s: undefined }, index)).toEqual({ tex: 'vanilla/skull3.png' })
    expect(iconOfNbt('nothing', 0, {}, '', index)).toEqual({})
  })

  it('matches head pictures by skin, whatever else the head has', () => {
    const pack: TexturePack = { id: 'p', matchers: [{ t: 'byskin', m: { i: ['skull'], n: { SkullOwner: { Properties: { textures: { '0': { Value: skinValue(HASH) } } } } } } }] }
    const index = indexPacks([pack])
    expect(iconOfNbt('skull', 3, { ExtraAttributes: { id: 'X' } }, HASH, index)).toEqual({ tex: 'p/byskin.png' })
    expect(iconOfNbt('skull', 3, {}, 'b'.repeat(64), index)).toEqual({ skin: 'b'.repeat(64) })
  })

  it('gives profile items their picture and shimmer', () => {
    const index = indexPacks([furf, vanilla])
    const list = viewItems(
      {
        i: [
          { id: 276, Damage: 0, Count: 1, tag: { ExtraAttributes: { id: 'ASPECT_OF_THE_END', enchantments: { sharpness: 5 } }, display: { Name: '§9Aspect of the End' } } },
          { id: 276, Damage: 0, Count: 1, tag: { ExtraAttributes: { id: 'PLAIN' }, display: { Name: 'Sword' } } }
        ]
      },
      (slot) => {
        const { id, damage } = minecraftItem(slot.id as number, Number(slot.Damage) || 0, ids)
        return iconOfNbt(id, damage, slot.tag as Record<string, unknown>, '', index)
      }
    )
    expect(list[0]).toMatchObject({ id: 'ASPECT_OF_THE_END', glint: true, icon: { tex: 'furfsky_reborn/aote.png' } })
    expect(list[1]).toMatchObject({ glint: false, icon: { tex: 'vanilla/dsword.png' } })
  })
})

describe('Hypixel’s own pack', () => {
  it('finds each item model’s picture through its definition and model parents', () => {
    const items = {
      'item/misc/teeth': { model: { type: 'model', model: 'hypixel_skyblock:item/misc/teeth' } },
      'item/bow/term': {
        model: {
          type: 'condition',
          property: 'using_item',
          on_true: { type: 'model', model: 'hypixel_skyblock:item/bow/term_pulling' },
          on_false: { type: 'model', model: 'hypixel_skyblock:item/bow/term' }
        }
      },
      'item/odd/child': { model: { type: 'select', cases: [], fallback: { type: 'model', model: 'hypixel_skyblock:item/odd/child' } } },
      'item/missing': { model: { type: 'model', model: 'hypixel_skyblock:item/nowhere' } }
    }
    const models = {
      'item/misc/teeth': { parent: 'item/generated', textures: { layer0: 'hypixel_skyblock:item/misc/teeth' } },
      'item/bow/term': { parent: 'item/bow', textures: { layer0: 'hypixel_skyblock:item/bow/term' } },
      'item/bow/term_pulling': { textures: { layer0: 'hypixel_skyblock:item/bow/term_pulling' } },
      'item/odd/child': { parent: 'hypixel_skyblock:item/odd/base' },
      'item/odd/base': { textures: { particle: 'hypixel_skyblock:item/odd/base' } }
    }
    const have = new Set(['item/misc/teeth', 'item/bow/term', 'item/bow/term_pulling', 'item/odd/base'])
    expect(resolveHypixelModels(items, models, (t) => have.has(t))).toEqual({
      'hypixel_skyblock:item/misc/teeth': 'item/misc/teeth',
      'hypixel_skyblock:item/bow/term': 'item/bow/term',
      'hypixel_skyblock:item/odd/child': 'item/odd/base'
    })
    expect(hypixelFileName('item/bow/term')).toBe('item__bow__term')
  })

  it('draws NEU’s new paper items with Hypixel’s picture, by item model', () => {
    const index = indexPacks([
      { id: 'hypixel', matchers: [], models: { 'hypixel_skyblock:item/misc/teeth': 'item__misc__teeth' } },
      { id: 'vanilla', matchers: [{ t: 'paper', m: { i: ['paper'] } }] }
    ])
    const teeth = mcItemOfNeu(
      { internalname: 'KUUDRA_TEETH', itemid: 'minecraft:paper', nbttag: '{ExtraAttributes:{id:"KUUDRA_TEETH"},ItemModel:"hypixel_skyblock:item/misc/teeth"}' },
      {},
      {}
    )!
    expect(teeth.m).toBe('hypixel_skyblock:item/misc/teeth')
    expect(iconOf(teeth, index)).toEqual({ tex: 'hypixel/item__misc__teeth.png' })
    // Without Hypixel's picture it's left blank rather than drawn as paper.
    expect(iconOf({ ...teeth, m: 'hypixel_skyblock:item/other' }, index)).toEqual({})
  })
})

describe('your own Minecraft pack', () => {
  const solid = (w: number, h: number, rgba: number[]) => ({ width: w, height: h, data: Uint8Array.from({ length: w * h * 4 }, (_, i) => rgba[i % 4]) })

  it('draws a block as a shaded cube, first frame only', () => {
    const cube = isoCube(solid(16, 64, [200, 100, 50, 255]), solid(16, 16, [100, 100, 100, 255]), solid(16, 16, [100, 100, 100, 255]))
    expect(cube.width).toBe(64)
    const px = (x: number, y: number) => Array.from(cube.data.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4))
    expect(px(32, 10)).toEqual([200, 100, 50, 255]) // top, fully lit
    expect(px(10, 35)).toEqual([80, 80, 80, 255]) // front, darker
    expect(px(50, 40)).toEqual([60, 60, 60, 255]) // side, darker still
    expect(px(0, 0)[3]).toBe(0) // corners stay see-through
  })

  it('finds a texture by its 1.8 or newer name', () => {
    const have = new Map([['item/golden_sword', 'new']])
    expect(pickTexture(['items/gold_sword', 'item/golden_sword'], have)).toBe('new')
    expect(pickTexture(['ITEMS/Gold_Sword'], new Map([['items/gold_sword', 'old']]))).toBe('old')
    expect(pickTexture(['items/nothing'], have)).toBeUndefined()
  })

  it('swaps plain Minecraft pictures for your pack’s, but not SkyBlock pack ones', () => {
    const index = indexPacks([furf, vanilla])
    index.vanillaOverride = new Set(['dsword'])
    expect(iconOfNbt('diamond_sword', 0, { ExtraAttributes: { id: 'PLAIN' } }, '', index)).toEqual({ tex: 'custom/dsword.png' })
    expect(iconOfNbt('diamond_sword', 0, { ExtraAttributes: { id: 'ASPECT_OF_THE_END' } }, '', index)).toEqual({ tex: 'furfsky_reborn/aote.png' })
    expect(iconOfNbt('stone', 1, {}, '', index)).toEqual({ tex: 'vanilla/granite.png' })
  })
})
