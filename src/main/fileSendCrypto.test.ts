import { describe, expect, it } from 'vitest'
import { codeKey, seal, unseal } from './fileSendCrypto'

describe('file sender locking', () => {
  it('opens with the same code only', async () => {
    const key = await codeKey({ room: 4821, words: ['tiger', 'piano', 'river'] })
    const same = await codeKey({ room: 4821, words: ['tiger', 'piano', 'river'] })
    const otherWords = await codeKey({ room: 4821, words: ['tiger', 'piano', 'robin'] })
    const otherRoom = await codeKey({ room: 4822, words: ['tiger', 'piano', 'river'] })
    const box = seal(key, { t: 'offer', sdp: 'v=0', session: 1 })
    expect(unseal(same, box)).toEqual({ t: 'offer', sdp: 'v=0', session: 1 })
    expect(unseal(otherWords, box)).toBeNull()
    expect(unseal(otherRoom, box)).toBeNull()
  })

  it('notices changed messages', async () => {
    const key = await codeKey({ room: 1000, words: ['acorn', 'acorn', 'acorn'] })
    const raw = Buffer.from(seal(key, { t: 'ready' }), 'base64')
    raw[14] ^= 1
    expect(unseal(key, raw.toString('base64'))).toBeNull()
    expect(unseal(key, 'not base64 at all!')).toBeNull()
  })
})
