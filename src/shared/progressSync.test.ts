import { describe, expect, it } from 'vitest'
import { isSyncedVideo, mergeSynced, newest, readSynced, sameSynced, videoSyncKey } from './progressSync'

describe('sharing progress between computers', () => {
  it('keeps the newer change to each thing, from either computer', () => {
    const mac = { a: { updated: 5, value: 1 }, b: { updated: 1, value: 2 } }
    const pc = { a: { updated: 3, value: 9 }, b: { updated: 4, value: null }, c: { updated: 2, value: 7 } }
    expect(mergeSynced(mac, pc)).toEqual({ a: { updated: 5, value: 1 }, b: { updated: 4, value: null }, c: { updated: 2, value: 7 } })
  })

  it('drops broken entries from a half-synced file', () => {
    const raw = { ok: { updated: 1, value: { name: 'Film.mkv', at: 10, duration: 100 } }, bad: { updated: 'x', value: {} }, worse: 3, cleared: { updated: 2, value: null } }
    expect(Object.keys(readSynced(raw, isSyncedVideo))).toEqual(['ok', 'cleared'])
    expect(readSynced(null, isSyncedVideo)).toEqual({})
  })

  it('matches videos by file name, wherever they are', () => {
    expect(videoSyncKey('C:\\Users\\me\\Videos\\Film.MKV')).toBe(videoSyncKey('/Users/me/Movies/Film.mkv'))
  })

  it('keeps only the most recent, and knows when nothing changed', () => {
    const list = { a: { updated: 1, value: 1 }, b: { updated: 3, value: 2 }, c: { updated: 2, value: 3 } }
    expect(Object.keys(newest(list, 2)).sort()).toEqual(['b', 'c'])
    expect(sameSynced(list, { ...list })).toBe(true)
    expect(sameSynced(list, { ...list, a: { updated: 1, value: 5 } })).toBe(false)
  })
})
