import './soundPanel.css'
import { useEffect, useState } from 'react'
import { Copy, RefreshCw, RotateCcw, Smartphone, X } from 'lucide-react'
import { bandLabel, CROSSFADE_MAX, eqFromPreset, eqWithBand, EQ_BANDS, EQ_LIMIT, EQ_PRESETS, VISUALISER_STYLES, type MusicEq } from '@shared/musicSound'
import type { MusicRemoteStatus } from '@shared/types'
import { setPrefs, usePrefs } from '../../store/prefs'
import { Qr, cleanError } from '../Phone/Qr'
import { notify } from '../../store/notify'

/**
 * Sound for your own music, from the Music page's bar or the full-screen player: crossfade length,
 * the equaliser (presets or your own bands) and the visualiser's style.
 */
export function SoundPanel({ onClose }: { onClose: () => void }) {
  const prefs = usePrefs((s) => s.prefs)
  const eq = prefs.musicEq
  const set = (next: MusicEq): void => setPrefs({ musicEq: next })
  return (
    <div className="sound-panel" role="dialog" aria-label="Sound" data-sound-panel onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="sound-head">
        <h3>Sound</h3>
        <button className="icon-btn" onClick={onClose} title="Close">
          <X size={15} />
        </button>
      </div>

      <label className="sound-row">
        <span>Crossfade</span>
        <input
          type="range"
          min={0}
          max={CROSSFADE_MAX}
          step={1}
          value={prefs.musicCrossfade}
          onChange={(e) => setPrefs({ musicCrossfade: Number(e.target.value) })}
          style={{ '--fill': `${(prefs.musicCrossfade / CROSSFADE_MAX) * 100}%` } as React.CSSProperties}
          data-sound-crossfade
        />
        <em>{prefs.musicCrossfade ? `${prefs.musicCrossfade} s` : 'Off'}</em>
      </label>
      <p className="sound-note">Each song fades into the next. Skipping still changes straight away.</p>

      <div className="sound-eq-head">
        <label className="sound-switch">
          <input type="checkbox" checked={eq.on} onChange={(e) => set({ ...eq, on: e.target.checked })} data-eq-on />
          <span>Equaliser</span>
        </label>
        <select value={eq.preset} onChange={(e) => set(eqFromPreset(e.target.value))} data-eq-preset>
          {eq.preset === 'custom' && <option value="custom">Custom</option>}
          {EQ_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button className="icon-btn" onClick={() => set({ ...eqFromPreset('flat'), on: eq.on })} title="Back to flat" data-eq-reset>
          <RotateCcw size={13} />
        </button>
      </div>
      <div className={`sound-eq ${eq.on ? '' : 'off'}`} data-eq-bands>
        <Band label="Pre" value={eq.preamp} onChange={(v) => set({ ...eq, on: true, preamp: v })} title="Preamp: turns everything down to make room for boosts (or up)" />
        <span className="sound-eq-gap" />
        {EQ_BANDS.map((hz, i) => (
          <Band key={hz} label={bandLabel(hz)} value={eq.bands[i] ?? 0} onChange={(v) => set(eqWithBand(eq, i, v))} title={`${hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`}`} />
        ))}
      </div>
      <p className="sound-note">Drag a band to make your own. It’s saved with your settings, so your other computer gets it too.</p>

      <div className="sound-row">
        <span>Visualiser</span>
        <div className="sound-styles">
          {VISUALISER_STYLES.map((s) => (
            <button key={s.id} className={prefs.musicVisualiserStyle === s.id ? 'on' : ''} onClick={() => setPrefs({ musicVisualiserStyle: s.id, musicVisualiser: true })} data-visualiser-style={s.id}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function Band({ label, value, onChange, title }: { label: string; value: number; onChange: (v: number) => void; title: string }) {
  return (
    <label className="sound-band" title={`${title}: ${value > 0 ? '+' : ''}${value} dB`}>
      <em>{value > 0 ? `+${Math.round(value)}` : Math.round(value)}</em>
      <input
        type="range"
        min={-EQ_LIMIT}
        max={EQ_LIMIT}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(0)}
        aria-label={`${title} level`}
      />
      <span>{label}</span>
    </label>
  )
}

/** The phone remote: on or off, and the QR code a phone scans to open it. */
export function RemotePanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<MusicRemoteStatus | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void window.api.musicRemoteStatus().then(setStatus)
    const id = setInterval(() => void window.api.musicRemoteStatus().then(setStatus), 4000)
    return () => clearInterval(id)
  }, [])
  const set = async (on: boolean, fresh = false): Promise<void> => {
    setBusy(true)
    try {
      setStatus(await window.api.setMusicRemote(on, fresh))
    } catch (err) {
      setStatus({ on: false, url: null, connected: 0, error: cleanError(err) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="sound-panel remote-panel" role="dialog" aria-label="Phone remote" data-remote-panel onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="sound-head">
        <h3>
          <Smartphone size={15} /> Phone remote
        </h3>
        <button className="icon-btn" onClick={onClose} title="Close">
          <X size={15} />
        </button>
      </div>
      <label className="sound-switch">
        <input type="checkbox" checked={!!status?.on} disabled={busy || !status} onChange={(e) => void set(e.target.checked)} data-remote-on />
        <span>Control this music from your phone</span>
      </label>
      {status?.error && <p className="setting-warning">{status.error}</p>}
      {status?.on && status.url ? (
        <>
          <div className="remote-qr">
            <Qr text={status.url} />
            <div>
              <p>
                Scan with your phone’s camera, on the same Wi-Fi. Add the page to your home screen to keep it. In the <strong>Orbit Music</strong> app, it’s under <strong>Control my computer</strong>.
              </p>
              <p className="remote-url">
                <code data-remote-url>{status.url}</code>
                <button
                  className="icon-btn"
                  onClick={() => {
                    void navigator.clipboard.writeText(status.url!)
                    notify('Copied the remote’s address.', 'info')
                  }}
                  title="Copy"
                >
                  <Copy size={13} />
                </button>
              </p>
              <p className="sound-note" data-remote-connected>
                {status.connected ? `${status.connected} ${status.connected === 1 ? 'phone has' : 'phones have'} it open now.` : 'No phone has it open right now.'}
              </p>
            </div>
          </div>
          <button className="link-btn" disabled={busy} onClick={() => void set(true, true)} title="The old address stops working, for any phone that had it">
            <RefreshCw size={12} /> Make a new address
          </button>
        </>
      ) : (
        <p className="sound-note">Play, pause, skip, change the volume and pick from Up next on your phone. Only phones on your Wi-Fi with the address can use it.</p>
      )}
    </div>
  )
}
