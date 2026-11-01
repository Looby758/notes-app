import { useEffect, useState } from 'react'
import { Cloud, Cpu, Download, Pause, Power, Trash2 } from 'lucide-react'
import { LOCAL_MODELS, localModelById } from '@shared/localAi'
import type { LocalAiState } from '@shared/types'
import { refreshAiStatus, setAiEngine, useAi } from '../../store/ai'
import { errorMessage } from '../../lib/paths'
import { notify } from '../../store/notify'

const ENGINE_NAMES: Record<NonNullable<LocalAiState['engine']>, string> = {
  cuda: 'NVIDIA CUDA',
  vulkan: 'Vulkan',
  metal: 'Apple Metal'
}

const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`

/** Keeps the AI status (and so this page) up to date while the offline AI downloads, loads and unloads. */
export function useLocalAiUpdates(): void {
  useEffect(() => window.api.onLocalAiState(() => void refreshAiStatus()), [])
}

/** Settings → AI helper: which AI the features use, and the offline AI (download, remove, games). */
export default function OfflineAiSettings() {
  const status = useAi((s) => s.status)
  const [model, setModel] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useLocalAiUpdates()

  if (!status) return null
  const s = status.offline
  const chosen = model ?? s.model ?? s.suggested
  const installed = localModelById(s.model)

  const act = async (job: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await job()
    } catch (err) {
      notify(errorMessage(err))
    } finally {
      await refreshAiStatus()
      setBusy(false)
    }
  }

  const install = (id: string): Promise<void> =>
    act(async () => {
      const done = await window.api.localAiInstall(id)
      // Once it's here, the AI features use it (unless you'd picked Claude before).
      if (done.state === 'ready' && !useAi.getState().status?.hasKey) await setAiEngine('offline')
    })

  const remove = (): Promise<void> =>
    act(async () => {
      const ok = await window.api.confirm({
        message: 'Remove the offline AI?',
        detail: 'Its files are deleted from this computer. You can download it again any time.',
        ok: 'Remove',
        type: 'warning'
      })
      if (!ok) return
      await window.api.localAiRemove()
      if (useAi.getState().status?.use === 'offline') await setAiEngine('online')
    })

  return (
    <section className="settings-group cal-sources ai-settings offline-ai" data-section="offline-ai" data-offline-ai={s.state}>
      <h3>Which AI to use</h3>
      <div className="offline-ai-engine" data-ai-engine={status.use}>
        <button className={`btn ${status.use === 'offline' ? 'selected' : ''}`} onClick={() => void act(() => setAiEngine('offline'))} disabled={busy} data-ai-use-offline>
          <Cpu size={13} /> Offline AI on this computer
        </button>
        <button className={`btn ${status.use === 'online' ? 'selected' : ''}`} onClick={() => void act(() => setAiEngine('online'))} disabled={busy} data-ai-use-online>
          <Cloud size={13} /> Claude online
        </button>
      </div>
      <p className="cal-sources-intro">
        {status.use === 'offline'
          ? 'Summaries, tidy-ups, Ask everything, the AI chat and Ctrl+K’s sentence reader run on this computer, free and private. When a question looks too hard for it, Orbit offers to ask Claude instead, and only does if you press the button.'
          : 'Summaries, tidy-ups, Ask everything, the AI chat and Ctrl+K’s sentence reader use Claude, with your Anthropic key below.'}
        {status.use === 'offline' && s.state !== 'ready' && ' Download the offline AI below first.'}
      </p>

      <h3>Offline AI</h3>
      <p className="cal-sources-intro">
        An AI that runs on your own graphics card, so it works without the internet and nothing you ask leaves this computer. It isn’t
        part of Orbit: it’s an optional download. It loads only when something asks it a question, and lets go of the graphics card
        again after 10 quiet minutes.
      </p>

      {s.state === 'unsupported' && <p className="setting-warning">The offline AI works on Windows PCs and Apple Silicon Macs (M1 and newer).</p>}

      {s.state === 'missing' && (
        <>
          <div className="offline-ai-models">
            {LOCAL_MODELS.map((m) => (
              <label key={m.id} className={`offline-ai-model ${chosen === m.id ? 'selected' : ''}`}>
                <input type="radio" name="offline-ai-model" checked={chosen === m.id} onChange={() => setModel(m.id)} />
                <span>
                  <strong>{m.name}</strong> · about {m.gb} GB{m.id === s.suggested && s.gpu ? ` · suggested for your ${s.gpu.name}` : ''}
                  <small>{m.blurb}</small>
                </span>
              </label>
            ))}
          </div>
          <div className="offline-ai-row">
            <button className="btn btn-primary" disabled={busy} onClick={() => void install(chosen)} data-offline-ai-get>
              <Download size={13} /> Download ({localModelById(chosen)?.gb ?? '?'} GB)
            </button>
            {s.gpu && <span className="money-hint">Graphics: {s.gpu.name}, {s.gpu.memoryGb} GB</span>}
          </div>
          {s.error && <p className="setting-warning">{s.error}</p>}
          <p className="cal-note">
            Downloads llama.cpp (the engine, from GitHub) and a Qwen3 model (from Hugging Face). Both are checked before they’re used. A
            stopped download carries on where it left off.
          </p>
        </>
      )}

      {s.state === 'downloading' && (
        <>
          <p>
            {s.stage === 'engine' ? 'Downloading the AI engine…' : `Downloading the ${localModelById(s.model)?.name ?? ''} model…`}{' '}
            {Math.round((s.progress ?? 0) * 100)}%{s.bytes ? ` of ${gb(s.bytes)}` : ''}
          </p>
          <div className="offline-ai-bar">
            <span style={{ width: `${Math.round((s.progress ?? 0) * 100)}%` }} />
          </div>
          <div className="offline-ai-row">
            <button className="btn" onClick={() => void window.api.localAiCancel()} data-offline-ai-pause>
              <Pause size={13} /> Pause
            </button>
            <span className="money-hint">You can keep using Orbit while it downloads.</span>
          </div>
        </>
      )}

      {s.state === 'ready' && (
        <>
          <div className="cal-connected">
            <span className="cal-connected-dot" />
            <span>
              {installed ? `${installed.name} model (${installed.blurb.split('.')[0]})` : 'Installed'}
              {s.engine ? `, running with ${ENGINE_NAMES[s.engine]}` : ''}.{' '}
              {s.gamePaused ? 'Switched off while a game runs.' : s.loading ? 'Loading…' : s.loaded ? 'Loaded in the graphics card.' : 'Not loaded (it loads when needed).'}
            </span>
          </div>
          <div className="offline-ai-row">
            {s.loaded && (
              <button className="btn" onClick={() => void act(() => window.api.localAiUnload())} disabled={busy} data-offline-ai-unload>
                <Power size={13} /> Unload now
              </button>
            )}
            <button className="btn" onClick={() => void remove()} disabled={busy} data-offline-ai-remove>
              <Trash2 size={13} /> Remove
            </button>
          </div>
          {s.error && <p className="setting-warning">{s.error}</p>}
        </>
      )}

      {s.state !== 'unsupported' && (
        <label className="offline-ai-row">
          <input
            type="checkbox"
            checked={s.unloadForGames}
            onChange={(e) => void act(() => window.api.localAiSetUnloadForGames(e.target.checked))}
            data-offline-ai-games
          />
          <span>Unload it while a game is running, so the game gets the whole graphics card</span>
        </label>
      )}
    </section>
  )
}
