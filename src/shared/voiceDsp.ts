/**
 * The Studio's live voice effects that the browser doesn't have built in: a noise gate (it turns
 * the quiet bits between your words right down, so breaths, room noise and mouth noises between
 * sentences mostly disappear) and a de-esser (it softens harsh "s" and "sh" sounds). They run
 * sample by sample inside an AudioWorklet (lib/voiceWorklet.ts); kept here, free of the browser, so
 * they can be tested.
 */

export interface GateSettings {
  on: boolean
  /** Quieter than this (dB) counts as "not talking". */
  threshold: number
  /** How far down the quiet bits are turned (dB, positive). Not all the way, so it sounds natural. */
  range: number
}

export interface DeEssSettings {
  on: boolean
  /** 0–1: how much the harsh "s" sounds are turned down. */
  amount: number
}

const dbToGain = (db: number): number => Math.pow(10, db / 20)

/** A one-pole smoother's coefficient for a time constant in seconds. */
const coef = (seconds: number, rate: number): number => (seconds <= 0 ? 0 : Math.exp(-1 / (seconds * rate)))

/**
 * A noise gate with hold and smooth fades, so words aren't chopped: it opens within a couple of
 * milliseconds of you speaking and only closes a moment after you stop.
 */
export class Gate {
  private env = 0
  private gain = 1
  private holdLeft = 0
  private readonly envAttack: number
  private readonly envRelease: number
  private readonly open: number
  private readonly close: number
  private readonly holdSamples: number

  constructor(
    private settings: GateSettings,
    rate: number
  ) {
    this.envAttack = coef(0.001, rate)
    this.envRelease = coef(0.08, rate)
    this.open = coef(0.002, rate)
    this.close = coef(0.12, rate)
    this.holdSamples = Math.round(0.18 * rate)
  }

  set(settings: GateSettings): void {
    this.settings = settings
  }

  /** How far the gate is turned down right now (1 = fully open). */
  get level(): number {
    return this.gain
  }

  process(buf: Float32Array): void {
    const { on, threshold, range } = this.settings
    if (!on) {
      this.gain = 1
      return
    }
    const thresh = dbToGain(threshold)
    const floor = dbToGain(-Math.abs(range))
    for (let i = 0; i < buf.length; i++) {
      const x = Math.abs(buf[i])
      this.env = x > this.env ? this.envAttack * this.env + (1 - this.envAttack) * x : this.envRelease * this.env + (1 - this.envRelease) * x
      if (this.env >= thresh) this.holdLeft = this.holdSamples
      else if (this.holdLeft > 0) this.holdLeft--
      const target = this.holdLeft > 0 ? 1 : floor
      const c = target > this.gain ? this.open : this.close
      this.gain = c * this.gain + (1 - c) * target
      buf[i] *= this.gain
    }
  }
}

/** A second-order low-pass filter (RBJ cookbook). What's left after it is the "s" band. */
class LowPass {
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0
  private readonly b0: number
  private readonly b1: number
  private readonly b2: number
  private readonly a1: number
  private readonly a2: number

  constructor(freq: number, rate: number, q = 0.707) {
    const w = (2 * Math.PI * freq) / rate
    const alpha = Math.sin(w) / (2 * q)
    const cos = Math.cos(w)
    const a0 = 1 + alpha
    this.b0 = (1 - cos) / 2 / a0
    this.b1 = (1 - cos) / a0
    this.b2 = (1 - cos) / 2 / a0
    this.a1 = (-2 * cos) / a0
    this.a2 = (1 - alpha) / a0
  }

  step(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1
    this.x1 = x
    this.y2 = this.y1
    this.y1 = y
    return y
  }
}

/**
 * A split-band de-esser: the sound above about 5.5 kHz (where "s" lives) is turned down only while
 * it's loud compared with the rest of your voice, so it stays bright the rest of the time.
 */
export class DeEsser {
  private readonly lp: LowPass
  private hiEnv = 0
  private allEnv = 0
  private gain = 1
  private readonly envC: number
  private readonly attack: number
  private readonly release: number

  constructor(
    private settings: DeEssSettings,
    rate: number,
    freq = 5500
  ) {
    this.lp = new LowPass(Math.min(freq, rate * 0.45), rate)
    this.envC = coef(0.004, rate)
    this.attack = coef(0.001, rate)
    this.release = coef(0.06, rate)
  }

  set(settings: DeEssSettings): void {
    this.settings = settings
  }

  get level(): number {
    return this.gain
  }

  process(buf: Float32Array): void {
    const { on, amount } = this.settings
    const a = Math.min(1, Math.max(0, amount))
    for (let i = 0; i < buf.length; i++) {
      const x = buf[i]
      // Split so the two parts add back up to exactly what came in: low + hi = x.
      const low = this.lp.step(x)
      const hi = x - low
      if (!on || a === 0) continue
      this.hiEnv = this.envC * this.hiEnv + (1 - this.envC) * Math.abs(hi)
      this.allEnv = this.envC * this.allEnv + (1 - this.envC) * Math.abs(x)
      // Sibilance: the top band is most of the sound. The more of it, the further it's turned down
      // (up to about 12 dB at full amount).
      const share = this.allEnv > 1e-5 ? this.hiEnv / this.allEnv : 0
      const over = Math.max(0, share - (0.55 - 0.25 * a)) / 0.45
      const target = Math.max(dbToGain(-12 * a), 1 - over * (1 - dbToGain(-12 * a)) * 1.5)
      const c = target < this.gain ? this.attack : this.release
      this.gain = c * this.gain + (1 - c) * target
      // Keep the low part as it is; only the "s" band gets quieter.
      buf[i] = low + hi * this.gain
    }
  }
}
