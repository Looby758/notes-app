/**
 * Runs inside the Studio's audio thread (an AudioWorklet): the noise gate and de-esser from
 * shared/voiceDsp on the mic, one copy per channel. lib/studio.ts loads it and sends new settings
 * through its port.
 */
import { DeEsser, Gate, type DeEssSettings, type GateSettings } from '@shared/voiceDsp'

declare const sampleRate: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

interface Settings {
  gate: GateSettings
  deess: DeEssSettings
}

class VoiceFx extends AudioWorkletProcessor {
  private settings: Settings = { gate: { on: false, threshold: -50, range: 20 }, deess: { on: false, amount: 0.4 } }
  private chains: { gate: Gate; deess: DeEsser }[] = []

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent<Settings>) => {
      this.settings = e.data
      for (const c of this.chains) {
        c.gate.set(this.settings.gate)
        c.deess.set(this.settings.deess)
      }
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || !input.length) return true
    for (let ch = 0; ch < output.length; ch++) {
      const src = input[Math.min(ch, input.length - 1)]
      const out = output[ch]
      out.set(src)
      this.chains[ch] ??= { gate: new Gate(this.settings.gate, sampleRate), deess: new DeEsser(this.settings.deess, sampleRate) }
      // De-ess first (it listens to the whole voice), then gate.
      this.chains[ch].deess.process(out)
      this.chains[ch].gate.process(out)
    }
    return true
  }
}

registerProcessor('orbit-voice-fx', VoiceFx)
