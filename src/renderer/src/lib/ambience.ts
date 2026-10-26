/** The focus timer's chime: a soft two-note sound, made on the fly (no audio files). */

let ctx: AudioContext | null = null

/** `rising` for "time for a break", falling for "back to work" / done. */
export function chime(rising = true): void {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  const c = ctx
  const t = c.currentTime
  const notes = rising ? [784, 1046.5] : [1046.5, 784]
  notes.forEach((f, i) => {
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.value = f
    const g = c.createGain()
    g.gain.setValueAtTime(0, t + i * 0.25)
    g.gain.linearRampToValueAtTime(0.3, t + i * 0.25 + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.25 + 1.6)
    o.connect(g).connect(c.destination)
    o.start(t + i * 0.25)
    o.stop(t + i * 0.25 + 1.7)
  })
}
