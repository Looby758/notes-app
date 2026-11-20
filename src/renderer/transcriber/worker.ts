import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import { piecesWords, SAMPLE_RATE, transcribeModelById } from '@shared/transcribe'

/**
 * The hidden transcriber page (see src/main/transcriber.ts). It's handed sound a few minutes at a
 * time, already read out of the recording at 16 kHz, and answers with the words and their times.
 * The model comes from Hugging Face the first time and is kept in this page's own cache.
 */

// The ONNX runtime comes with Orbit rather than from a CDN.
env.backends.onnx.wasm!.wasmPaths = { mjs: new URL(ortMjs, location.href).href, wasm: new URL(ortWasm, location.href).href }
env.allowLocalModels = false

type Request =
  | { type: 'load'; model: string }
  | { type: 'run'; id: number; samples: Float32Array; offset: number }
  | { type: 'gpu' }

let asr: AutomaticSpeechRecognitionPipeline | null = null
let loaded = ''
let device: 'webgpu' | 'wasm' | null = null

async function hasGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    return !!gpu && !!(await gpu.requestAdapter())
  } catch {
    return false
  }
}

async function load(port: MessagePort, id: string): Promise<void> {
  const model = transcribeModelById(id)
  if (!model) throw new Error('That transcript model isn’t one Orbit knows.')
  if (asr && loaded === id) return
  await asr?.dispose()
  asr = null
  device ??= (await hasGpu()) ? 'webgpu' : 'wasm'
  // How much of each file has come, so one bar covers them all.
  const files = new Map<string, { loaded: number; total: number }>()
  asr = (await pipeline('automatic-speech-recognition', model.repo, {
    device,
    dtype: model.dtype as never,
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file) return
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 })
      let got = 0
      let all = 0
      for (const f of files.values()) {
        got += f.loaded
        all += f.total
      }
      port.postMessage({ type: 'download', progress: all ? got / all : 0, bytes: all })
    }
  })) as AutomaticSpeechRecognitionPipeline
  loaded = id
}

async function run(samples: Float32Array, offset: number): Promise<ReturnType<typeof piecesWords>> {
  if (!asr) throw new Error('The transcript model isn’t loaded.')
  const out = (await asr(samples, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 })) as {
    chunks?: { text: string; timestamp: [number | null, number | null] }[]
  }
  return piecesWords(out.chunks ?? [], offset, samples.length / SAMPLE_RATE)
}

window.addEventListener('message', (e) => {
  if (e.data !== 'transcriber-port' || !e.ports[0]) return
  const port = e.ports[0]
  port.onmessage = async (m: MessageEvent<Request>) => {
    const req = m.data
    try {
      if (req.type === 'gpu') port.postMessage({ type: 'gpu', gpu: await hasGpu() })
      else if (req.type === 'load') {
        await load(port, req.model)
        port.postMessage({ type: 'loaded', device })
      } else if (req.type === 'run') port.postMessage({ type: 'words', id: req.id, words: await run(req.samples, req.offset) })
    } catch (err) {
      port.postMessage({ type: 'error', id: 'id' in req ? req.id : undefined, error: err instanceof Error ? err.message : String(err) })
    }
  }
  port.start()
  port.postMessage({ type: 'ready' })
})
