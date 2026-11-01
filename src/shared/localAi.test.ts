import { describe, expect, it } from 'vitest'
import { pickFromReleases, cleanReply, fitTexts, hfFileInfo, moneySortPrompt, parseMoneySort, pickEngine, sentenceAround, sha256Of, suggestedModel, type ReleaseAsset } from './localAi'

const asset = (name: string): ReleaseAsset => ({ name, url: `https://example.com/${name}`, size: 100, digest: `sha256:${'a'.repeat(64)}` })
const RELEASE = [
  'llama-b7000-bin-win-cuda-12.4-x64.zip',
  'cudart-llama-bin-win-cuda-12.4-x64.zip',
  'llama-b7000-bin-win-cuda-12.8-x64.zip',
  'cudart-llama-bin-win-cuda-12.8-x64.zip',
  'llama-b7000-bin-win-cuda-13.1-x64.zip',
  'cudart-llama-bin-win-cuda-13.1-x64.zip',
  'llama-b7000-bin-win-vulkan-x64.zip',
  'llama-b7000-bin-win-cpu-x64.zip',
  'llama-b7000-bin-macos-arm64.zip',
  'llama-b7000-bin-ubuntu-x64.zip'
].map(asset)

describe('pickEngine', () => {
  it('picks the newest CUDA build and its runtime for an NVIDIA PC', () => {
    const p = pickEngine(RELEASE, { platform: 'win32', arch: 'x64', nvidia: true })
    expect(p?.kind).toBe('cuda')
    expect(p?.engine.name).toBe('llama-b7000-bin-win-cuda-13.1-x64.zip')
    expect(p?.runtime?.name).toBe('cudart-llama-bin-win-cuda-13.1-x64.zip')
  })
  it('skips CUDA builds too old for RTX 50 cards, falling back to Vulkan', () => {
    const old = RELEASE.filter((a) => !/12\.8|13\.1/.test(a.name))
    expect(pickEngine(old, { platform: 'win32', arch: 'x64', nvidia: true })?.kind).toBe('vulkan')
  })
  it('needs the matching runtime for a CUDA build', () => {
    const noRuntime = RELEASE.filter((a) => !a.name.startsWith('cudart'))
    expect(pickEngine(noRuntime, { platform: 'win32', arch: 'x64', nvidia: true })?.kind).toBe('vulkan')
  })
  it('uses Vulkan without an NVIDIA card, and Metal on Apple Silicon', () => {
    expect(pickEngine(RELEASE, { platform: 'win32', arch: 'x64', nvidia: false })?.engine.name).toBe('llama-b7000-bin-win-vulkan-x64.zip')
    expect(pickEngine(RELEASE, { platform: 'darwin', arch: 'arm64', nvidia: false })?.kind).toBe('metal')
    expect(pickEngine(RELEASE, { platform: 'darwin', arch: 'x64', nvidia: false })).toBeNull()
    expect(pickEngine(RELEASE, { platform: 'linux', arch: 'x64', nvidia: true })).toBeNull()
  })
})

describe('download checks', () => {
  it('reads GitHub digests', () => {
    expect(sha256Of(`sha256:${'AB'.repeat(32)}`)).toBe('ab'.repeat(32))
    expect(sha256Of('md5:123')).toBeNull()
    expect(sha256Of(null)).toBeNull()
  })
  it('finds a model file in a Hugging Face listing', () => {
    const list = [
      { path: 'README.md', size: 10 },
      { path: 'Qwen3-14B-Q4_K_M.gguf', size: 9001, lfs: { oid: 'c'.repeat(64), size: 9001 } }
    ]
    expect(hfFileInfo(list, 'Qwen3-14B-Q4_K_M.gguf')).toEqual({ size: 9001, sha256: 'c'.repeat(64) })
    expect(hfFileInfo(list, 'README.md')).toBeNull()
    expect(hfFileInfo(list, 'missing.gguf')).toBeNull()
  })
})

describe('suggestedModel', () => {
  it('suggests the smart model for a 16 GB card and the quick one for smaller cards and a 16 GB Mac', () => {
    expect(suggestedModel(16, false).id).toBe('qwen3-14b')
    expect(suggestedModel(8, false).id).toBe('qwen3-8b')
    expect(suggestedModel(16, true).id).toBe('qwen3-8b')
    expect(suggestedModel(null, false).id).toBe('qwen3-8b')
  })
})

describe('cleanReply', () => {
  it('takes out thinking and the too-hard mark', () => {
    expect(cleanReply('<think>hmm</think>\n\nParis.')).toEqual({ text: 'Paris.', hard: false })
    expect(cleanReply('Maybe 42.\n[HARD]')).toEqual({ text: 'Maybe 42.', hard: true })
    expect(cleanReply('Answer<think>cut off')).toEqual({ text: 'Answer', hard: false })
  })
})

describe('fitTexts', () => {
  it('keeps texts under a budget, cutting the last', () => {
    const out = fitTexts([{ text: 'a'.repeat(6) }, { text: 'b'.repeat(6) }, { text: 'c' }], 10)
    expect(out).toHaveLength(2)
    expect(out[1].text).toBe('bbbb\n…')
  })
})

describe('money sorting', () => {
  const cats = [
    { id: 'food', name: 'Food' },
    { id: 'games', name: 'Games' },
    { id: 'pay', name: 'Pay', income: true }
  ]
  const rows = [
    { description: 'TESCO STORES 1234', amount: -1250 },
    { description: 'STEAMGAMES.COM', amount: -999 },
    { description: 'ACME LTD SALARY', amount: 150000 }
  ]
  it('lists the lines and categories', () => {
    const p = moneySortPrompt(rows, cats)
    expect(p).toContain('1. OUT £12.50 TESCO STORES 1234')
    expect(p).toContain('3. IN £1500.00 ACME LTD SALARY')
    expect(p).toContain('food = Food')
  })
  it('reads the answer back, keeping only categories that fit', () => {
    const reply = '1: food\n2: Games\n3: food\n4: games\nnonsense'
    expect(parseMoneySort(reply, rows, cats)).toEqual({ 0: 'food', 1: 'games' })
    expect(parseMoneySort('3: pay', rows, cats)).toEqual({ 2: 'pay' })
  })
})

describe('sentenceAround', () => {
  it('finds the sentence a word is in', () => {
    const text = 'First one. The bank of the river was muddy. Last.'
    const at = text.indexOf('bank')
    expect(sentenceAround(text, at, at + 4)).toBe('The bank of the river was muddy.')
  })
  it('drops list markers', () => {
    const text = '- [ ] fix the bank thing'
    const at = text.indexOf('bank')
    expect(sentenceAround(text, at, at + 4)).toBe('fix the bank thing')
  })
})

describe('pickFromReleases', () => {
  const gh = (name: string) => ({ name, browser_download_url: `https://example.com/${name}`, size: 100, digest: `sha256:${'b'.repeat(64)}` })
  // Real names: "latest" (v0.7.0) has no builds; the nightly b11669 does.
  const releases = [
    { tag_name: 'v0.7.0', assets: [gh('nightly-tag.txt')] },
    {
      tag_name: 'b11669',
      assets: [
        'cudart-llama-bin-win-cuda-12.4-x64.zip',
        'cudart-llama-bin-win-cuda-13.4-arm64.zip',
        'cudart-llama-bin-win-cuda-13.4-x64.zip',
        'llama-b11669-bin-macos-arm64.tar.gz',
        'llama-b11669-bin-win-cuda-12.4-x64.zip',
        'llama-b11669-bin-win-cuda-13.4-arm64.zip',
        'llama-b11669-bin-win-cuda-13.4-x64.zip',
        'llama-b11669-bin-win-vulkan-x64.zip'
      ].map(gh)
    }
  ]
  it('skips a release without builds and finds CUDA 13.4 for an RTX PC', () => {
    const r = pickFromReleases(releases, { platform: 'win32', arch: 'x64', nvidia: true })
    expect(r?.release.tag_name).toBe('b11669')
    expect(r?.pick.engine.name).toBe('llama-b11669-bin-win-cuda-13.4-x64.zip')
    expect(r?.pick.runtime?.name).toBe('cudart-llama-bin-win-cuda-13.4-x64.zip')
  })
  it('finds the Mac build', () => {
    expect(pickFromReleases(releases, { platform: 'darwin', arch: 'arm64', nvidia: false })?.pick.engine.name).toBe('llama-b11669-bin-macos-arm64.tar.gz')
  })
  it('skips builds GitHub gives no checksum for', () => {
    const noDigest = [{ tag_name: 'b1', assets: releases[1].assets.map((a) => ({ ...a, digest: null })) }]
    expect(pickFromReleases(noDigest, { platform: 'win32', arch: 'x64', nvidia: true })).toBeNull()
  })
})
