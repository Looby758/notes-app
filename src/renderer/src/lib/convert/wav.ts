/** Sound as a WAV file: 16-bit, one block of samples per channel (all the same length). */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const count = channels.length
  const frames = channels[0]?.length ?? 0
  const dataSize = frames * count * 2
  const out = new DataView(new ArrayBuffer(44 + dataSize))
  const text = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) out.setUint8(at + i, s.charCodeAt(i))
  }
  text(0, 'RIFF')
  out.setUint32(4, 36 + dataSize, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  out.setUint32(16, 16, true)
  out.setUint16(20, 1, true) // plain PCM
  out.setUint16(22, count, true)
  out.setUint32(24, sampleRate, true)
  out.setUint32(28, sampleRate * count * 2, true)
  out.setUint16(32, count * 2, true)
  out.setUint16(34, 16, true)
  text(36, 'data')
  out.setUint32(40, dataSize, true)
  let at = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      out.setInt16(at, toInt16(channels[c][i]), true)
      at += 2
    }
  }
  return new Uint8Array(out.buffer)
}

/** -1…1 → a 16-bit sample. */
export const toInt16 = (v: number): number => {
  const s = Math.max(-1, Math.min(1, v || 0))
  return s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
}
