import { useEffect, useState } from 'react'
import { Download, ExternalLink, KeyRound, Trash2 } from 'lucide-react'
import { LIVE_SERVICES, type LiveService, type LiveStatus } from '@shared/live'
import { errorMessage } from '../../lib/paths'

/** What the main process says about going live (ffmpeg, saved keys), kept up to date. */
export function useLiveStatus(): LiveStatus | null {
  const [status, setStatus] = useState<LiveStatus | null>(null)
  useEffect(() => {
    void window.api.liveStatus().then(setStatus)
    return window.api.onLiveStatus(setStatus)
  }, [])
  return status
}

/** ffmpeg: download it, see the progress, or remove it. Used in Settings → Studio and the Go live box. */
export function FfmpegSetup({ status, compact = false }: { status: LiveStatus; compact?: boolean }) {
  const [error, setError] = useState<string | null>(null)
  const f = status.ffmpeg
  const get = async (): Promise<void> => {
    setError(null)
    try {
      await window.api.liveGetFfmpeg()
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  return (
    <div className="live-ffmpeg" data-live-ffmpeg={f.state}>
      {f.state === 'ready' ? (
        <div className="cal-connected">
          <span className="cal-connected-dot" />
          <span>ffmpeg is installed.</span>
          {!compact && (
            <button
              className="btn"
              disabled={status.live}
              onClick={() => void window.api.liveRemoveFfmpeg().catch((err) => setError(errorMessage(err)))}
              title="Frees about 80 MB. You can download it again any time."
            >
              <Trash2 size={13} /> Remove
            </button>
          )}
        </div>
      ) : f.state === 'downloading' ? (
        <div className="live-progress">
          <span>Downloading ffmpeg… {Math.round((f.progress ?? 0) * 100)}%</span>
          <div className="studio-meter">
            <div style={{ transform: `scaleX(${f.progress ?? 0})` }} />
          </div>
        </div>
      ) : f.state === 'unsupported' ? (
        <p className="studio-hint">Going live isn’t available on this kind of computer yet. Recording still works.</p>
      ) : (
        <>
          <p className="cal-sources-intro">
            To go live, Orbit needs ffmpeg, a free tool that sends your video to Twitch or YouTube. It isn’t included with Orbit, so it’s
            a one-time download of about 30 MB (80 MB once unpacked). Recording works without it.
          </p>
          <button className="btn btn-primary" onClick={() => void get()} data-live-get-ffmpeg>
            <Download size={13} /> Download ffmpeg
          </button>
        </>
      )}
      {(error || f.error) && <p className="studio-problem">{error ?? f.error}</p>}
    </div>
  )
}

/** Pick a service and save its stream key (stored encrypted; Orbit never shows it again). */
export function StreamKeys({ status, service, onService }: { status: LiveStatus; service: LiveService; onService: (s: LiveService) => void }) {
  const [key, setKey] = useState('')
  const [url, setUrl] = useState(status.customUrl)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const info = LIVE_SERVICES.find((s) => s.id === service)!
  const saved = status.keys[service]

  useEffect(() => {
    setKey('')
    setEditing(false)
    setError(null)
  }, [service])

  const save = async (): Promise<void> => {
    setError(null)
    try {
      if (!key.trim() && !(service === 'custom' && saved)) throw new Error('Paste your stream key first.')
      await window.api.liveSetKey(service, key, service === 'custom' ? url : undefined)
      setKey('')
      setEditing(false)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="live-keys">
      <div className="live-services" role="radiogroup" aria-label="Where to stream">
        {LIVE_SERVICES.map((s) => (
          <button key={s.id} role="radio" aria-checked={service === s.id} className={`btn ${service === s.id ? 'active' : ''}`} onClick={() => onService(s.id)}>
            {s.label}
            {status.keys[s.id] && <span className="cal-connected-dot" title="Key saved" />}
          </button>
        ))}
      </div>
      {service === 'custom' && (
        <label className="live-field">
          Server address
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="rtmp://your-server/live" spellCheck={false} />
        </label>
      )}
      {saved && !editing ? (
        <div className="cal-connected">
          <span className="cal-connected-dot" />
          <span>Your {info.label} stream key is saved.</span>
          <button className="btn" onClick={() => setEditing(true)}>
            <KeyRound size={13} /> Change
          </button>
          <button className="btn" onClick={() => void window.api.liveClearKey(service)}>
            <Trash2 size={13} /> Remove
          </button>
        </div>
      ) : (
        <>
          <label className="live-field">
            Stream key
            <div className="studio-row">
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste it here" spellCheck={false} autoComplete="off" onKeyDown={(e) => e.key === 'Enter' && void save()} />
              <button className="btn btn-primary" onClick={() => void save()}>
                Save
              </button>
            </div>
          </label>
          <p className="studio-hint">
            Find it in {info.keyHelp}.{' '}
            {info.keyUrl && (
              <button className="link-btn" onClick={() => window.open(info.keyUrl)}>
                Open <ExternalLink size={11} />
              </button>
            )}{' '}
            Keep it secret: anyone with it can stream to your channel. Orbit stores it encrypted on this computer.
          </p>
        </>
      )}
      {!status.canEncrypt && <p className="studio-problem">This computer can’t store keys securely, so Orbit can’t save one.</p>}
      {error && <p className="studio-problem">{error}</p>}
    </div>
  )
}

/** Settings → Studio. */
export default function StudioSettings() {
  const status = useLiveStatus()
  const [service, setService] = useState<LiveService | null>(null)
  if (!status) return null
  const current = service ?? status.service
  return (
    <section className="settings-group cal-sources live-settings" data-section="studio">
      <h3>Going live</h3>
      <FfmpegSetup status={status} />
      <h3>Stream keys</h3>
      <StreamKeys
        status={status}
        service={current}
        onService={(s) => {
          setService(s)
          void window.api.liveSetService(s)
        }}
      />
    </section>
  )
}
