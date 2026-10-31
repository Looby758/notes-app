import { describe, expect, it } from 'vitest'
import { describeSize, kindOf, outputName, targetsFor, whyNot } from './formats'
import { encodeWav, toInt16 } from './wav'

describe('file converter formats', () => {
  it('knows what kind each file is', () => {
    expect(kindOf('IMG_0001.HEIC')).toBe('image')
    expect(kindOf('song.wav')).toBe('audio')
    expect(kindOf('Report.docx')).toBe('document')
    expect(kindOf('clip.MOV')).toBe('video')
    expect(kindOf('screen recording.webm')).toBe('video')
    expect(kindOf('slides.key')).toBeNull()
    expect(kindOf('noextension')).toBeNull()
  })

  it('never offers a file its own format', () => {
    expect(targetsFor('photo.jpeg').map((t) => t.format)).toEqual(['png', 'webp'])
    expect(targetsFor('photo.heic').map((t) => t.format)).toEqual(['jpg', 'png', 'webp'])
    expect(targetsFor('a.mp3').map((t) => t.format)).toEqual(['wav'])
    expect(targetsFor('Report.docx')[0].format).toBe('pdf')
    expect(targetsFor('clip.mov').map((t) => t.format)).toEqual(['mp4', 'webm', 'gif', 'mp3', 'wav'])
    expect(targetsFor('clip.mp4')[0].format).toBe('mov')
    expect(targetsFor('slides.key')).toEqual([])
  })

  it('explains files it can’t convert', () => {
    expect(whyNot('old.doc')).toMatch(/save it as \.docx/)
    expect(whyNot('slides.key')).toMatch(/Keynote/)
  })

  it('names converted files without clashes', () => {
    const taken = new Set<string>()
    expect(outputName('Photo.heic', 'jpg', taken)).toBe('Photo.jpg')
    expect(outputName('photo.png', 'jpg', taken)).toBe('photo (2).jpg')
    expect(outputName('a:b.wav', 'mp3', taken)).toBe('a-b.mp3')
  })

  it('describes sizes', () => {
    expect(describeSize(512)).toBe('512 bytes')
    expect(describeSize(820_400)).toBe('820 KB')
    expect(describeSize(3_420_000)).toBe('3.4 MB')
    expect(describeSize(25_000_000)).toBe('25 MB')
  })
})

describe('WAV files', () => {
  it('writes a valid header and samples', () => {
    const wav = encodeWav([new Float32Array([0, 1, -1])], 44100)
    const view = new DataView(wav.buffer)
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE')
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(44100)
    expect(view.getUint32(40, true)).toBe(6)
    expect([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)]).toEqual([0, 32767, -32768])
  })

  it('interleaves two channels', () => {
    const wav = encodeWav([new Float32Array([1]), new Float32Array([-1])], 8000)
    const view = new DataView(wav.buffer)
    expect(view.getUint16(22, true)).toBe(2)
    expect([view.getInt16(44, true), view.getInt16(46, true)]).toEqual([32767, -32768])
  })

  it('clamps loud samples', () => {
    expect(toInt16(2)).toBe(32767)
    expect(toInt16(-3)).toBe(-32768)
    expect(toInt16(NaN)).toBe(0)
  })
})
