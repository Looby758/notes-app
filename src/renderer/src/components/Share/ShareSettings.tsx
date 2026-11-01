import './share.css'
import { useEffect, useState } from 'react'
import { Laptop, Link2Off, Monitor, ShieldAlert } from 'lucide-react'
import type { ShareSide } from '@shared/mouseShare'
import type { ShareStatus } from '@shared/types'
import { IS_MAC } from '@shared/platform'
import { errorMessage } from '../../lib/paths'
import ScreenSettings from './ScreenSettings'

const BACK_KEYS = IS_MAC ? '⌃⌥Esc' : 'Ctrl+Alt+Esc'

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span className="switch-knob" />
    </button>
  )
}

function Row({ label, text, children }: { label: string; text?: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <label>{label}</label>
        {text && <p>{text}</p>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

const OsIcon = ({ os, size = 16 }: { os: 'mac' | 'win'; size?: number }) => (os === 'mac' ? <Laptop size={size} /> : <Monitor size={size} />)

/** Where the other computer sits: click a spot round this one. */
function Arrange({ status, set }: { status: ShareStatus; set: (side: ShareSide) => void }) {
  const other = status.paired!
  const slot = (side: ShareSide) => (
    <button
      key={side}
      className={`share-slot slot-${side} ${status.side === side ? 'selected' : ''}`}
      onClick={() => set(side)}
      title={`${other.name} is ${side === 'left' ? 'on the left' : side === 'right' ? 'on the right' : side}`}
    >
      {status.side === side ? (
        <>
          <OsIcon os={other.os} size={18} />
          <span>{other.name}</span>
        </>
      ) : (
        <span className="share-slot-empty">Here?</span>
      )}
    </button>
  )
  return (
    <div className="share-arrange">
      {slot('above')}
      {slot('left')}
      <div className="share-this">
        <OsIcon os={status.os} size={18} />
        <span>This {status.os === 'mac' ? 'Mac' : 'PC'}</span>
      </div>
      {slot('right')}
      {slot('below')}
    </div>
  )
}

/** Settings → Two computers: one mouse and keyboard for a Windows PC and a Mac, with shared copy and paste. */
export default function ShareSettings() {
  const [status, setStatus] = useState<ShareStatus | null>(null)
  const [error, setError] = useState('')
  const [host, setHost] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.api.shareStatus().then(setStatus)
    const off = window.api.onShareStatus(setStatus)
    // Computers come and go from the "nearby" list.
    const t = setInterval(() => void window.api.shareStatus().then(setStatus), 3000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [])

  if (!status) return null

  const run = async (job: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await job()
    } catch (err) {
      setError(errorMessage(err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setStatus(await window.api.shareStatus())
      setBusy(false)
    }
  }
  const set = (patch: Parameters<typeof window.api.shareSet>[0]): void => void run(() => window.api.shareSet(patch))
  const peer = status.paired
  const otherOs = peer?.os ?? (status.os === 'mac' ? 'win' : 'mac')
  const shownError = error || status.error

  return (
    <section className="settings-group share-settings" data-section="computers">
      <h3>One mouse, two computers</h3>
      <p className="cal-sources-intro">
        Use this computer’s mouse and keyboard on your other computer too (a Windows PC and a Mac, both running Orbit on the same
        Wi-Fi). Push the pointer off the edge of the screen and it carries on onto the other one. Copy on one, paste on the other.
        Drag a file to the edge and drop it on the strip that appears to send it over.
      </p>

      <Row label="Share mouse and keyboard" text="Turn this on on both computers.">
        <Switch on={status.enabled} label="Share mouse and keyboard" onChange={(enabled) => set({ enabled })} />
      </Row>

      {status.enabled && status.os === 'mac' && !status.accessibility && (
        <div className="share-warning">
          <ShieldAlert size={16} />
          <span>
            macOS needs to allow Orbit to move the pointer and type. Turn Orbit on in System Settings → Privacy &amp; Security →
            Accessibility (if it’s already there, turn it off and on again).
          </span>
          <button className="btn" onClick={() => void run(() => window.api.shareAskAccessibility())}>
            Open the setting
          </button>
        </div>
      )}

      {shownError && <p className="setting-warning">{shownError}</p>}

      {status.enabled && status.pairing && (
        <div className="share-pairing">
          <p>
            Check <strong>{status.pairing.name}</strong> shows the same code:
          </p>
          <div className="share-code">{status.pairing.code.replace(/(\d{3})(\d{3})/, '$1 $2')}</div>
          {status.pairing.weConfirmed ? (
            <p className="share-muted">Now press “They match” on {status.pairing.name} too…</p>
          ) : (
            <div className="share-actions">
              <button className="btn btn-primary" disabled={busy} onClick={() => void run(() => window.api.shareConfirmPairing())}>
                They match
              </button>
              <button className="btn" onClick={() => void run(() => window.api.shareCancelPairing())}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {status.enabled && !peer && !status.pairing && (
        <div className="share-find">
          <h4>Computers nearby</h4>
          {status.nearby.length === 0 ? (
            <p className="share-muted">
              Looking for Orbit on other computers on this Wi-Fi… Open Orbit on your {otherOs === 'mac' ? 'Mac' : 'PC'} and turn on
              “Share mouse and keyboard” there too.
            </p>
          ) : (
            <ul className="share-nearby">
              {status.nearby.map((n) => (
                <li key={n.id}>
                  <OsIcon os={n.os} size={15} />
                  <span>{n.name}</span>
                  <button className="btn btn-primary" disabled={busy} onClick={() => void run(() => window.api.sharePair({ id: n.id }))}>
                    Pair
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="share-manual">
            <span className="share-muted">Not showing up? Type its address (e.g. 192.168.1.20):</span>
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.20" spellCheck={false} />
            <button className="btn" disabled={busy || !host.trim()} onClick={() => void run(() => window.api.sharePair({ host }))}>
              Pair
            </button>
          </div>
        </div>
      )}

      {status.enabled && peer && (
        <>
          <div className="share-state">
            <span className={`cal-connected-dot ${status.connected ? '' : 'off'}`} />
            {status.connected
              ? status.using === 'there'
                ? `Your mouse is on ${peer.name} now. ${BACK_KEYS} brings it back.`
                : status.using === 'controlled'
                  ? `${peer.name}’s mouse and keyboard are working this computer.`
                  : `Connected to ${peer.name}.`
              : `Looking for ${peer.name}… (Orbit has to be open there, on the same Wi-Fi.)`}
          </div>

          <h4>Where is {peer.name}?</h4>
          <p className="share-muted">Pick where it sits next to this computer. The pointer goes across on that side.</p>
          <Arrange status={status} set={(side) => set({ side })} />

          <Row label="Keep the mouse on this computer" text="Pauses going across, e.g. while you play a game.">
            <Switch on={status.paused} label="Keep the mouse on this computer" onChange={(paused) => set({ paused })} />
          </Row>
          <Row label="Share copy and paste" text="Whatever you copied is ready to paste on the other computer when the mouse goes across. Passwords copied from the vault stay put.">
            <Switch on={status.shareClipboard} label="Share copy and paste" onChange={(shareClipboard) => set({ shareClipboard })} />
          </Row>
          <Row
            label={status.os === 'mac' ? 'Swap ⌘ and Ctrl' : 'Ctrl works as ⌘ on the Mac'}
            text={
              status.os === 'mac'
                ? 'The PC’s Ctrl key works as ⌘ here (so Ctrl+C copies), and ⌘ on this Mac works as Ctrl on the PC. Set this on the Mac.'
                : 'So Ctrl+C, Ctrl+V and Ctrl+Z work the same on both. This is set on the Mac, in its Orbit settings.'
            }
          >
            {status.os === 'mac' ? (
              <Switch on={status.swapCtrlCmd} label="Swap ⌘ and Ctrl" onChange={(swapCtrlCmd) => set({ swapCtrlCmd })} />
            ) : (
              <span className="share-muted">On the Mac</span>
            )}
          </Row>
          <Row label="Pointer speed on the other computer" text={`${Math.round(status.speed * 100)}%`}>
            <input
              type="range"
              min={0.25}
              max={3}
              step={0.05}
              value={status.speed}
              onChange={(e) => setStatus({ ...status, speed: Number(e.target.value) })}
              onMouseUp={(e) => set({ speed: Number((e.target as HTMLInputElement).value) })}
              onKeyUp={(e) => set({ speed: Number((e.target as HTMLInputElement).value) })}
            />
          </Row>

          {status.connected && <ScreenSettings peerName={peer.name} peerOs={peer.os} />}

          <div className="share-help">
            <h4>Good to know</h4>
            <ul>
              <li>
                <strong>{BACK_KEYS}</strong> brings the mouse straight back. So does touching {status.os === 'mac' ? 'the PC’s' : 'the Mac’s'}{' '}
                own mouse or trackpad.
              </li>
              <li>Drag a file or folder to the edge, then drop it on the strip that appears: it goes to the other computer’s Downloads.</li>
              <li>Or drag files over Orbit: {peer.name} (and your phone, if its Orbit page is open) pop up at the bottom to drop them on.</li>
              <li>
                {status.os === 'win'
                  ? 'The Windows key, Alt+Tab and Ctrl+Alt+Delete stay on the PC (pressing them brings the mouse back).'
                  : '⌘Tab, ⌘Space and Mission Control keys stay on the Mac (pressing them brings the mouse back).'}
              </li>
            </ul>
          </div>

          <div className="share-actions">
            <button className="btn" onClick={() => void run(() => window.api.shareUnpair())}>
              <Link2Off size={13} /> Forget {peer.name}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
